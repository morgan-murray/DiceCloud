import { assert } from "chai";
import { Meteor } from "meteor/meteor";
import { Random } from "meteor/random";
import { api } from "./service";
import { mapSnapshot } from "/imports/api/aurora/adapter.mjs";
import Creatures from "/imports/api/creature/creatures/Creatures";
import CreatureProperties from "/imports/api/creature/creatureProperties/CreatureProperties";
import CreatureVariables from "/imports/api/creature/creatures/CreatureVariables";
import { buildComputationFromProps } from "/imports/api/engine/computation/buildCreatureComputation";
import computeCreatureComputation from "/imports/api/engine/computation/computeCreatureComputation";
import { castingDelta } from "/imports/api/advancement/rules.mjs";
const choices = {
  hpMode: "average",
  reviewed: true,
  resourceSpent: 0,
  choices: "Reviewed with DM.",
  spells: [],
  adjustments: [],
};
async function rejects(fn, code) {
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  assert.exists(error);
  if (code) assert.include(String(error.error || error.message), code);
}
async function computed(id) {
  const creature = await Creatures.findOneAsync(id),
    props = await CreatureProperties.find({
      "root.id": id,
      removed: { $ne: true },
    }).fetchAsync();
  const c = buildComputationFromProps(props, creature, { _creatureId: id });
  await computeCreatureComputation(c);
  assert.deepEqual(c.errors, []);
  return Object.fromEntries(
    c.props.filter((p) => p.variableName).map((p) => [p.variableName, p]),
  );
}
async function preview(user, id, extra = {}) {
  const { baseline, state } = await api.context(user, { creatureId: id });
  return api.preview(user, {
    creatureId: id,
    profile: {
      className: "paladin",
      subclass: "A custom oath",
      armorMode: "fixed",
      skills: baseline.skills.map((s) => ({
        ...s,
        multiplier: s.save
          ? ["wisdom", "charisma"].includes(s.ability)
            ? 1
            : 0
          : 1,
        reviewed: true,
      })),
      casting: baseline.casting.map((c) => ({ ...c, ability: "charisma" })),
    },
    choices: { ...choices, ...extra },
  });
}
describe("Native advancement: complete staged bundles, ownership and preservation", function () {
  this.timeout(30000);
  let owner, reader, flag;
  const ids = [];
  async function character(level = 10) {
    const id = Random.id();
    ids.push(id);
    const snapshot = {
      schemaVersion: 1,
      rulesVersion: "2014",
      identity: {
        name: "Fictional paladin",
        level,
        race: "Invented ancestry",
        classes: [{ name: "Paladin", level }],
      },
      abilities: {
        strength: 18,
        dexterity: 12,
        constitution: 16,
        intelligence: 10,
        wisdom: 14,
        charisma: 18,
      },
      armorClass: 18,
      initiative: 1,
      proficiency: level < 13 ? 4 : 5,
      movement: { walk: 30 },
      hitPoints: { maximum: 100 },
      hitDice: [{ name: "Paladin", count: level, size: "d10" }],
      saves: {
        strength: 8,
        dexterity: 5,
        constitution: 7,
        intelligence: 4,
        wisdom: 10,
        charisma: 12,
      },
      skills: { athletics: { bonus: 8, passive: 18 } },
      resources: [
        { name: "Spell slots", level: 1, total: 4, reset: "longRest" },
        { name: "Spell slots", level: 2, total: 3, reset: "longRest" },
        {
          name: "Spell slots",
          level: 3,
          total: level < 11 ? 2 : 3,
          reset: "longRest",
        },
      ],
      spellcasting: [{ name: "Paladin", attack: 8, dc: 16, spells: [] }],
      inventory: [
        {
          name: "Family keepsake",
          quantity: 1,
          equipped: false,
          attuned: false,
          description: "Keep this.",
          notes: "",
        },
      ],
      currency: { gp: 7 },
      attacks: [],
      features: [
        {
          name: "Existing oath feature",
          description: "Existing private explanation remains intact.",
        },
      ],
      notes: ["Personal session note"],
      diagnostics: [],
      provenance: { privateFiles: [] },
    };
    const mapped = mapSnapshot(snapshot, id, owner, () => Random.id());
    mapped.creature.readers = [reader];
    await Creatures.insertAsync(mapped.creature);
    for (const p of mapped.props) {
      if (p.variableName === "hitPoints") p.damage = 12;
      if (p.variableName === "auroraSlots2") p.damage = 1;
      await CreatureProperties.insertAsync(p);
    }
    return id;
  }
  before(async () => {
    flag = process.env.NATIVE_ADVANCEMENT_ENABLED;
    process.env.NATIVE_ADVANCEMENT_ENABLED = "true";
    owner = Random.id();
    reader = Random.id();
    for (const id of [owner, reader])
      await Meteor.users.insertAsync({
        _id: id,
        username: "advance-" + id,
        createdAt: new Date(),
      });
  });
  after(async () => {
    for (const id of ids) {
      await CreatureProperties.removeAsync({ "root.id": id });
      await CreatureVariables.removeAsync({ _creatureId: id });
      await Creatures.removeAsync(id);
    }
    await Mongo.getCollection("advancementPreviews").removeAsync({ owner });
    await Meteor.users.removeAsync({ _id: { $in: [owner, reader] } });
    if (flag === undefined) delete process.env.NATIVE_ADVANCEMENT_ENABLED;
    else process.env.NATIVE_ADVANCEMENT_ENABLED = flag;
  });
  it("previews and commits paladin 10→11 once; preserves identity, original text and usage; undo restores totals", async () => {
    const id = await character(),
      original = await CreatureProperties.find({ "root.id": id }).fetchAsync(),
      p = await preview(owner, id);
    assert.equal(p.totals.hp, 109);
    assert.equal((await computed(id)).level.total, 10);
    assert.equal(
      await CreatureProperties.find({ "root.id": id }).countAsync(),
      original.length,
    );
    const once = await api.commit(owner, {
        previewId: p.previewId,
        confirmed: true,
      }),
      twice = await api.commit(owner, {
        previewId: p.previewId,
        confirmed: true,
      });
    assert.deepEqual(once, twice);
    assert.equal(once.level, 11);
    const by = await computed(id);
    assert.equal(by.level.total, 11);
    assert.equal(by.hitPoints.total, 109);
    assert.equal(by.hitPoints.damage, 12);
    assert.equal(by.auroraSlots2.total, 3);
    assert.equal(by.auroraSlots2.damage, 1);
    assert.equal(by.auroraHitDice0.total, 11);
    assert.equal(by.layOnHands.total, 55);
    for (const prop of original)
      assert.deepEqual(await CreatureProperties.findOneAsync(prop._id), prop);
    const saved = await Creatures.findOneAsync(id);
    assert.equal(saved.owner, owner);
    assert.deepEqual(saved.readers, [reader]);
    await api.undo(owner, {
      creatureId: id,
      revision: saved.advancement.revision,
    });
    const undone = await computed(id);
    assert.equal(undone.level.total, 10);
    assert.equal(undone.hitPoints.total, 100);
    assert.equal(undone.auroraSlots2.total, 2);
  });
  it("denies readers and rejects a preview after an ordinary resource edit", async () => {
    const id = await character();
    await rejects(() => api.context(reader, { creatureId: id }), "permission");
    const p = await preview(owner, id),
      hp = await CreatureProperties.findOneAsync({
        "root.id": id,
        variableName: "hitPoints",
      });
    await CreatureProperties.updateAsync(
      hp._id,
      { $set: { damage: 13 } },
      { selector: { type: "attribute" } },
    );
    await rejects(
      () => api.commit(owner, { previewId: p.previewId, confirmed: true }),
      "stale",
    );
    assert.equal((await computed(id)).level.total, 10);
  });
  it("rolls back a fault before activation and preserves a committed level after a lost acknowledgement", async () => {
    const id = await character(),
      count = await CreatureProperties.find({ "root.id": id }).countAsync(),
      p = await preview(owner, id);
    await rejects(() =>
      api.commit(
        owner,
        { previewId: p.previewId, confirmed: true },
        (point) => {
          if (point === "staged") throw Error("Injected crash");
        },
      ),
    );
    assert.equal(
      await CreatureProperties.find({ "root.id": id }).countAsync(),
      count,
    );
    assert.equal((await computed(id)).level.total, 10);
    const q = await preview(owner, id);
    const result = await api.commit(
      owner,
      { previewId: q.previewId, confirmed: true },
      (point) => {
        if (point === "activated") throw Error("Lost acknowledgement");
      },
    );
    assert.equal(result.level, 11);
    assert.equal((await computed(id)).level.total, 11);
  });
  it("gates incomplete and abandoned bundles even before a creature has progression metadata", async () => {
    const id = await character();
    await CreatureProperties.insertAsync({
      _id: Random.id(),
      type: "effect",
      root: { collection: "creatures", id },
      advancementBundle: "abandoned",
      name: "Uncommitted HP",
      stats: ["hitPoints"],
      operation: "add",
      amount: { calculation: "999" },
    });
    assert.equal((await computed(id)).hitPoints.total, 100);
  });
  it("updates a saved casting DC once when proficiency changes, without rewriting its baseline formula", async () => {
    const id = await character(12),
      p = await preview(owner, id);
    await api.commit(owner, { previewId: p.previewId, confirmed: true });
    const creature = await Creatures.findOneAsync(id),
      props = await CreatureProperties.find({ "root.id": id }).fetchAsync();
    const c = buildComputationFromProps(props, creature, { _creatureId: id });
    await computeCreatureComputation(c);
    const caster = c.props.find((p) => p.type === "spellList");
    assert.equal(castingDelta(creature.advancement, caster._id), 1);
    assert.equal(caster.dc.value, 17);
    assert.equal(caster.attackRollBonus.value, 9);
    assert.equal(caster.dc.calculation, "16");
  });
  it("does not undo into a smaller spell pool by discarding spent slots", async () => {
    const id = await character(),
      p = await preview(owner, id);
    await api.commit(owner, { previewId: p.previewId, confirmed: true });
    const pool = await CreatureProperties.findOneAsync({
      "root.id": id,
      variableName: "auroraSlots2",
    });
    await CreatureProperties.updateAsync(
      pool._id,
      { $set: { damage: 3 } },
      { selector: { type: "attribute" } },
    );
    const state = (await Creatures.findOneAsync(id)).advancement;
    await rejects(
      () => api.undo(owner, { creatureId: id, revision: state.revision }),
      "used",
    );
    assert.equal((await computed(id)).level.total, 11);
    assert.equal((await CreatureProperties.findOneAsync(pool._id)).damage, 3);
  });

  it("keeps unprepared spells in the existing-spell catalog", async () => {
    const id = await character(),
      caster = await CreatureProperties.findOneAsync({
        "root.id": id,
        type: "spellList",
      });
    await CreatureProperties.insertAsync({
      _id: Random.id(),
      root: { collection: "creatures", id },
      parentId: caster._id,
      type: "spell",
      name: "Aid",
      level: 2,
      prepared: false,
    });
    const result = await api.context(owner, { creatureId: id });
    assert.isTrue(result.baseline.spells.some((s) => s.name === "Aid"));
  });
  it("does not invalidate a preview when only calculation caches change", async () => {
    const id = await character(),
      p = await preview(owner, id);
    const hp = await CreatureProperties.findOneAsync({
      "root.id": id,
      variableName: "hitPoints",
    });
    await CreatureProperties.updateAsync(
      hp._id,
      { $set: { "baseValue.hash": 12345, "baseValue.value": 999 } },
      { selector: { type: "attribute" } },
    );
    const result = await api.commit(owner, {
      previewId: p.previewId,
      confirmed: true,
    });
    assert.equal(result.level, 11);
    assert.equal((await computed(id)).hitPoints.total, 109);
  });
});
