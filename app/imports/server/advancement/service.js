import { Meteor } from "meteor/meteor";
import { Mongo } from "meteor/mongo";
import { Random } from "meteor/random";
import { EJSON } from "meteor/ejson";
import { DDPRateLimiter } from "meteor/ddp-rate-limiter";
import { createHash } from "node:crypto";
import Creatures from "/imports/api/creature/creatures/Creatures";
import CreatureProperties from "/imports/api/creature/creatureProperties/CreatureProperties";
import { assertEditPermission } from "/imports/api/sharing/sharingPermissions";
import { buildComputationFromProps } from "/imports/api/engine/computation/buildCreatureComputation";
import computeCreatureComputation from "/imports/api/engine/computation/computeCreatureComputation";
import computedOnlySchemas from "/imports/api/properties/computedOnlyPropertySchemasIndex";
import removeSchemaFields from "/imports/api/engine/computation/buildComputation/removeSchemaFields";
import { DenormalisedOnlyCreaturePropertySchema } from "/imports/api/creature/creatureProperties/CreatureProperties";
import {
  AdvancementRuleError,
  initialState,
  planLevel,
  catalog,
  skillAbilities,
  abilities,
  proficiency,
  mod,
} from "/imports/api/advancement/rules.mjs";
const Previews = new Mongo.Collection("advancementPreviews");
const enabled = () => process.env.NATIVE_ADVANCEMENT_ENABLED === "true";
const fail = (code, message) => {
  throw new Meteor.Error("advancement-" + code, message);
};
const work = new Set();
async function exclusive(creatureId, fn) {
  if (work.has(creatureId)) fail("busy", "Another level-up is in progress.");
  work.add(creatureId);
  try {
    return await fn();
  } finally {
    work.delete(creatureId);
  }
}
function identifier(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(id))
    fail("request", "Invalid character or preview.");
  return id;
}
function fingerprint(creature, props) {
  const inputs = props
    .map((p) => {
      const copy = EJSON.clone(p);
      removeSchemaFields(
        [computedOnlySchemas[p.type], DenormalisedOnlyCreaturePropertySchema],
        copy,
      );
      for (const key of ["left", "right", "dirty"]) delete copy[key];
      return copy;
    })
    .sort((a, b) => a._id.localeCompare(b._id));
  return createHash("sha256")
    .update(
      EJSON.stringify({
        owner: creature.owner,
        writers: creature.writers,
        libraries: creature.allowedLibraries,
        collections: creature.allowedLibraryCollections,
        advancement: creature.advancement,
        inputs,
      }),
    )
    .digest("hex");
}
async function load(userId, creatureId) {
  if (!enabled())
    fail(
      "disabled",
      "Character level-ups are not enabled on this installation yet.",
    );
  const creature = await Creatures.findOneAsync(identifier(creatureId));
  await assertEditPermission(creature, userId);
  const all = await CreatureProperties.find({
    "root.id": creatureId,
    removed: { $ne: true },
  }).fetchAsync();
  const active = new Set(creature.advancement?.activeBundles || []);
  for (const step of creature.advancement?.history || [])
    if (step.propertyIds.some((id) => !all.some((p) => p._id === id)))
      fail(
        "build",
        "A level-up property was removed. Restore it before advancing again.",
      );
  const props = all.filter(
    (p) => !p.advancementBundle || active.has(p.advancementBundle),
  );
  const computation = buildComputationFromProps(
    EJSON.clone(props),
    EJSON.clone(creature),
    { _creatureId: creatureId },
  );
  await computeCreatureComputation(computation);
  if (computation.errors.length)
    fail(
      "computation",
      "Resolve the character’s calculation errors before leveling up.",
    );
  return {
    creature,
    props,
    computed: computation.props,
    fingerprint: fingerprint(creature, props),
    all,
  };
}
function baseline(doc) {
  const props = doc.computed.filter((p) => !p.inactive),
    by = Object.fromEntries(
      props.filter((p) => p.variableName).map((p) => [p.variableName, p]),
    );
  if (
    props.some((p) => p.type === "class") ||
    (doc.creature.allowedLibraries || []).length ||
    (doc.creature.allowedLibraryCollections || []).length
  )
    fail(
      "build",
      "This guided workflow supports fixed-value characters. Use the existing Build tab for characters already connected to a live class library.",
    );
  if (props.some((p) => p.type === "skill" && (p.ability || p.baseProficiency)))
    fail(
      "build",
      "This character already computes skill bonuses from live abilities or proficiencies. Use its Build tab instead of adding fixed-value progression.",
    );
  const level = by.level?.total;
  if (
    !Number.isSafeInteger(level) ||
    level < 1 ||
    level > 20 ||
    !by.hitPoints ||
    !by.proficiencyBonus
  )
    fail(
      "build",
      "This character needs a level, hit points and proficiency bonus before leveling up.",
    );
  const values = Object.fromEntries(abilities.map((a) => [a, by[a]?.total]));
  if (
    Object.values(values).some(
      (n) => !Number.isSafeInteger(n) || n < 1 || n > 30,
    )
  )
    fail("build", "Review all six ability scores first.");
  if (by.proficiencyBonus.total !== proficiency(level))
    fail(
      "build",
      "The proficiency bonus does not match 2014 progression. Review the sheet before leveling up.",
    );
  const attrs = props.filter((p) => p.type === "attribute");
  const dice = attrs.filter((p) => p.attributeType === "hitDice");
  if (dice.length !== 1)
    fail(
      "build",
      "This workflow currently supports one class and one hit-dice pool.",
    );
  const skills = props
    .filter((p) => p.type === "skill")
    .map((p) => {
      if (!p.variableName)
        fail(
          "build",
          "Each skill or saving throw needs its own variable name.",
        );
      const save = p.skillType === "save",
        name = (p.name || "").toLowerCase();
      const ability = save
        ? abilities.find((a) => name.startsWith(a))
        : skillAbilities[name] || p.ability;
      if (!ability) fail("build", "Review the ability used by " + p.name + ".");
      return {
        id: p._id,
        name: p.name,
        variable: p.variableName,
        save,
        ability,
        value: p.value,
        multiplier: save
          ? 0
          : Math.min(
              2,
              Math.max(
                0,
                Math.round(
                  (p.value - mod(values[ability])) / proficiency(level),
                ),
              ),
            ),
      };
    });
  const slots = attrs
    .filter((p) => p.attributeType === "spellSlot")
    .map((p) => ({
      id: p._id,
      variable: p.variableName,
      level: p.spellSlotLevel?.value,
      total: p.total,
    }));
  if (
    slots.some((p) => !p.variable || !Number.isSafeInteger(p.level)) ||
    new Set(slots.map((p) => p.level)).size !== slots.length
  )
    fail("build", "Review duplicate or ambiguous spell-slot pools first.");
  return {
    targets: props
      .filter((p) => p.variableName && ["attribute", "skill"].includes(p.type))
      .map((p) => ({ variable: p.variableName, name: p.name })),
    creatureId: doc.creature._id,
    level,
    abilities: values,
    hp: by.hitPoints.total,
    skills,
    slots,
    hitDice: { variable: dice[0].variableName, size: dice[0].hitDiceSize },
    casting: props
      .filter((p) => p.type === "spellList")
      .map((p) => ({
        id: p._id,
        name: p.name,
        ability: p.ability || "charisma",
        attack: p.attackRollBonus?.value,
        dc: p.dc?.value,
      })),
    spells: doc.computed
      .filter(
        (p) => p.type === "spell" && !p.disabled && !p.deactivatedByAncestor,
      )
      .map((p) => ({ id: p._id, name: p.name, level: p.level })),
    resources: attrs
      .filter((p) => p.attributeType === "resource")
      .map((p) => ({
        id: p._id,
        name: p.name,
        variable: p.variableName,
        total: p.total,
      })),
  };
}
function cleanProps(props) {
  return props.map((p) => {
    const schema = CreatureProperties.simpleSchema(p),
      clean = schema.clean(p);
    schema.validate(clean);
    return clean;
  });
}
async function verifyCandidate(doc, state, props) {
  const c = buildComputationFromProps(
    EJSON.clone([...doc.props, ...props]),
    { ...EJSON.clone(doc.creature), advancement: state },
    { _creatureId: doc.creature._id },
  );
  await computeCreatureComputation(c);
  if (c.errors.length)
    fail("computation", "The proposed level-up cannot be computed safely.");
  for (const prop of c.props) {
    const original = doc.props.find((p) => p._id === prop._id);
    if (
      original &&
      prop.type === "attribute" &&
      (prop.damage || 0) !== (original.damage || 0)
    )
      fail(
        "used",
        "This change would discard current damage or resource usage. Adjust the choices before applying.",
      );
  }
  const by = Object.fromEntries(
    c.props.filter((p) => p.variableName).map((p) => [p.variableName, p]),
  );
  if (by.level?.total !== state.level)
    fail("computation", "The computed level does not match the preview.");
  return {
    hp: by.hitPoints.total,
    level: by.level.total,
    proficiency: by.proficiencyBonus.total,
  };
}
export const api = {
  async context(userId, { creatureId }) {
    const doc = await load(userId, creatureId),
      base = baseline(doc);
    return {
      baseline: base,
      state: doc.creature.advancement || null,
      classes: Object.keys(catalog.classes),
      spells: catalog.spells.map(({ name, level, classes }) => ({
        name,
        level,
        classes,
      })),
    };
  },
  async preview(userId, { creatureId, profile, choices }) {
    return exclusive(creatureId, async () => {
      const doc = await load(userId, creatureId),
        base = baseline(doc);
      let state = doc.creature.advancement;
      if (!state) {
        state = initialState(profile, base);
        for (const s of state.skills)
          if (s.save && !profile.skills?.find((x) => x.id === s.id)?.reviewed)
            fail("review", "Confirm each saving throw proficiency.");
      }
      if (!choices || choices.reviewed !== true)
        fail(
          "review",
          "Review the current build, class choices and resource usage before previewing.",
        );
      const plan = planLevel(state, choices, base, () => Random.id());
      plan.props = cleanProps(plan.props);
      if (doc.all.length + plan.props.length > 1000)
        fail("limit", "This level-up would exceed 1,000 character properties.");
      const totals = await verifyCandidate(doc, plan.state, plan.props),
        expiresAt = new Date(Date.now() + 15 * 60000);
      await Previews.removeAsync({
        creatureId,
        owner: userId,
        state: "preview",
      });
      const previewId = await Previews.insertAsync({
        owner: userId,
        creatureId,
        fingerprint: doc.fingerprint,
        beforeRevision: doc.creature.advancement?.revision ?? null,
        plan,
        state: "preview",
        createdAt: new Date(),
        expiresAt,
      });
      return {
        previewId,
        summary: plan.summary,
        changes: plan.changes,
        features: plan.features,
        totals,
        expiresAt,
      };
    });
  },
  async commit(userId, { previewId, confirmed }, fault = () => {}) {
    identifier(previewId);
    const preview = await Previews.findOneAsync({
      _id: previewId,
      owner: userId,
    });
    if (!preview) fail("not-found", "Preview not found.");
    return exclusive(preview.creatureId, async () => {
      const doc = await load(userId, preview.creatureId);
      // A lost acknowledgement must return success without applying a second level.
      if (
        doc.creature.advancement?.activeBundles.includes(
          preview.plan.state.history.at(-1).bundleId,
        )
      )
        return {
          creatureId: preview.creatureId,
          level: preview.plan.state.level,
        };
      if (
        preview.state !== "preview" ||
        preview.expiresAt < new Date() ||
        confirmed !== true
      )
        fail(
          "expired",
          "Review a fresh preview before applying this level-up.",
        );
      if (doc.fingerprint !== preview.fingerprint)
        fail(
          "stale",
          "The character changed after this preview. Preview the level-up again.",
        );
      const props = preview.plan.props,
        inserted = [];
      try {
        // Staged properties are inactive until the ONE atomic creature update below.
        for (const p of props) {
          await CreatureProperties.insertAsync(p);
          inserted.push(p._id);
        }
        await fault("staged");
        const current = await load(userId, preview.creatureId);
        if (current.fingerprint !== preview.fingerprint)
          fail(
            "stale",
            "The character changed while applying this level-up. Preview again.",
          );
        const selector = {
          _id: preview.creatureId,
          owner: doc.creature.owner,
          writers: doc.creature.writers || [],
          ...(preview.beforeRevision === null
            ? { advancement: { $exists: false } }
            : { "advancement.revision": preview.beforeRevision }),
        };
        const count = await Creatures.updateAsync(selector, {
          $set: { advancement: preview.plan.state, dirty: true },
        });
        if (!count)
          fail(
            "stale",
            "Another level-up changed the character. Preview again.",
          );
        await fault("activated");
      } catch (e) {
        const saved = await Creatures.findOneAsync(preview.creatureId);
        if (
          !saved?.advancement?.activeBundles.includes(
            preview.plan.state.history.at(-1).bundleId,
          )
        ) {
          await CreatureProperties.removeAsync({
            _id: { $in: inserted },
            "root.id": preview.creatureId,
          });
          throw e;
        }
      }
      await Previews.updateAsync(previewId, { $set: { state: "complete" } });
      return {
        creatureId: preview.creatureId,
        level: preview.plan.state.level,
      };
    });
  },
  async undo(userId, { creatureId, revision }) {
    return exclusive(creatureId, async () => {
      const doc = await load(userId, creatureId),
        state = doc.creature.advancement;
      if (!state || state.revision !== revision || !state.history.length)
        fail(
          "stale",
          "Refresh the character before undoing its latest level-up.",
        );
      const latest = state.history.at(-1),
        own = doc.props.filter((p) => p.advancementBundle === latest.bundleId);
      if (
        own.some(
          (p) =>
            p.type === "attribute" &&
            (p.damage || 0) !== (latest.initialDamage?.[p._id] || 0),
        )
      )
        fail(
          "used",
          "A new resource’s usage changed. Resolve it before undoing this level.",
        );
      const next = {
        ...state,
        retiredSpells: latest.priorRetiredSpells || [],
        skills: latest.priorSkills,
        casting: latest.priorCasting,
        subclass: latest.priorSubclass,
        revision: state.revision + 1,
        level: state.level - 1,
        history: state.history.slice(0, -1),
        activeBundles: state.activeBundles.filter(
          (id) => id !== latest.bundleId,
        ),
      };
      const computation = buildComputationFromProps(
        EJSON.clone(doc.props),
        { ...EJSON.clone(doc.creature), advancement: next },
        { _creatureId: creatureId },
      );
      await computeCreatureComputation(computation);
      if (computation.errors.length)
        fail("computation", "The previous level cannot be restored safely.");
      for (const prop of computation.props) {
        const original = doc.props.find((p) => p._id === prop._id);
        if (
          prop.type === "attribute" &&
          !latest.propertyIds.includes(prop._id) &&
          (prop.damage || 0) !== (original?.damage || 0)
        )
          fail(
            "used",
            "Current damage or resource usage exceeds the previous level’s capacity. Resolve that usage before undoing.",
          );
      }
      const changed = await Creatures.updateAsync(
        { _id: creatureId, "advancement.revision": revision },
        { $set: { advancement: next, dirty: true } },
      );
      if (!changed)
        fail("stale", "The character changed. Refresh before undoing.");
      return { level: next.level };
    });
  },
};
Meteor.methods(
  Object.fromEntries(
    Object.entries(api).map(([name, handler]) => [
      "advancement." + name,
      async function (request) {
        if (!this.userId) fail("auth", "Sign in to level up a character.");
        if (!request || typeof request !== "object")
          fail("request", "Invalid level-up request.");
        try {
          return await handler(this.userId, request);
        } catch (e) {
          if (e instanceof AdvancementRuleError) fail("choice", e.message);
          throw e;
        }
      },
    ]),
  ),
);
DDPRateLimiter.addRule(
  {
    type: "method",
    name: (name) => typeof name === "string" && name.startsWith("advancement."),
  },
  20,
  10000,
);
Meteor.startup(async () => {
  await Previews.rawCollection().createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0 },
  );
});
