// D&D 2014 SRD 5.1. Attribution and provenance: advancement/README.md.
import catalog from "./catalog.mjs";
export { catalog };
export const abilities = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
];
export const skillAbilities = {
  acrobatics: "dexterity",
  "animal handling": "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "intelligence",
  "sleight of hand": "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
};
export const mod = (score) => Math.floor((score - 10) / 2);
export const proficiency = (level) => 2 + Math.floor((level - 1) / 4);
export class AdvancementRuleError extends Error {}
const fail = (message) => {
  throw new AdvancementRuleError(message);
};
const integer = (n, min, max, label) => {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    fail("Invalid " + label + ".");
  return n;
};
const label = (s, max = 160) => {
  if (typeof s !== "string" || !s.trim() || s.length > max)
    fail("Choose a valid name.");
  return s.trim();
};
const field = (n) => ({ calculation: String(n) });
export function table(name, level) {
  const c = Object.hasOwn(catalog.classes, name) ? catalog.classes[name] : null;
  if (!c) fail("Choose a supported class.");
  return c.levels[integer(level, 1, 20, "level") - 1];
}
export function isAsi(name, level) {
  return [4, 8, 12, 16, 19, ...(name === "rogue" ? [10] : [])].includes(level);
}
export function scores(state) {
  const result = { ...state.baseAbilities };
  for (const step of state.history)
    for (const [a, n] of Object.entries(step.increases || {})) result[a] += n;
  return result;
}
export function castingDelta(state, spellListId) {
  const caster = state.casting.find((x) => x.id === spellListId);
  if (!caster) return 0;
  const ability = caster.ability,
    baseLevel = caster.baseLevel ?? state.baseLevel;
  let priorScore = state.baseAbilities[ability],
    abilityGain = 0;
  for (const step of state.history) {
    const before = step.abilityBefore?.[ability] ?? priorScore;
    const after = before + (step.increases?.[ability] || 0);
    if (step.level > baseLevel) abilityGain += mod(after) - mod(before);
    priorScore = after;
  }
  return proficiency(state.level) - proficiency(baseLevel) + abilityGain;
}
export function initialState(input, baseline) {
  const className = label(input.className).toLowerCase();
  const current = table(className, baseline.level);
  for (let i = 0; i < current.slots.length; i++) {
    const pool = baseline.slots.find((s) => s.level === i + 1);
    if ((pool?.total || 0) !== current.slots[i])
      fail(
        "The current spell-slot totals do not match this single-class progression. Review the class or slot pools first.",
      );
  }
  const subclass =
    typeof input.subclass === "string" ? input.subclass.trim() : "";
  if (subclass.length > 160) fail("Subclass name is too long.");
  const skills = baseline.skills.map((s) => {
    const chosen = input.skills?.find((x) => x.id === s.id);
    if (
      !chosen ||
      !abilities.includes(chosen.ability) ||
      ![0, 0.5, 1, 2].includes(chosen.multiplier)
    )
      fail("Review every skill and saving throw.");
    return { ...s, ability: chosen.ability, multiplier: chosen.multiplier };
  });
  const casting = baseline.casting.map((s) => {
    const chosen = input.casting?.find((x) => x.id === s.id);
    if (!chosen || !abilities.includes(chosen.ability))
      fail("Review each spellcasting ability.");
    return { id: s.id, ability: chosen.ability };
  });
  if (!["fixed", "dex", "medium", "monk"].includes(input.armorMode))
    fail("Choose how armor responds to ability changes.");
  return {
    version: 1,
    revision: 0,
    className,
    subclass,
    baseLevel: baseline.level,
    level: baseline.level,
    baseAbilities: baseline.abilities,
    skills,
    casting,
    armorMode: input.armorMode,
    history: [],
    activeBundles: [],
    retiredSpells: [],
  };
}
export function planLevel(state, input, baseline, makeId) {
  if (state.version !== 1 || state.level >= 20)
    fail("This character cannot advance further.");
  const c = catalog.classes[state.className],
    from = table(state.className, state.level),
    to = table(state.className, state.level + 1),
    before = { ...baseline.abilities },
    increases = {};
  const asi = isAsi(state.className, to.level);
  let feat = null;
  if (asi) {
    if (input.asiMode === "feat") {
      feat = {
        name: label(input.feat?.name),
        description: label(input.feat?.description, 8000),
      };
    } else if (input.asiMode !== "abilities")
      fail("Choose an ability improvement or feat.");
    for (const [a, n] of Object.entries(input.increases || {})) {
      if (!abilities.includes(a)) fail("Unknown ability.");
      integer(n, 0, 2, "ability increase");
      if (n) increases[a] = n;
    }
    const count = Object.values(increases).reduce((a, b) => a + b, 0);
    if (input.asiMode === "abilities" && count !== 2)
      fail("Allocate exactly two ability points.");
    if (input.asiMode === "feat" && count > 1)
      fail(
        "A feat can grant at most one ability point here. Record other approved changes separately.",
      );
  } else if (Object.values(input.increases || {}).some((n) => n) || input.feat)
    fail("This level does not grant an ability improvement.");
  const after = { ...before };
  for (const [a, n] of Object.entries(increases)) {
    after[a] += n;
    if (after[a] > 20)
      fail("An ability improvement cannot raise a score above 20.");
  }
  const die =
    input.hpMode === "average"
      ? c.hitDie / 2 + 1
      : input.hpMode === "roll"
        ? integer(input.hpRoll, 1, c.hitDie, "hit-point roll")
        : fail("Choose average or rolled hit points.");
  const hpGain =
    Math.max(1, die + mod(after.constitution)) +
    state.level * (mod(after.constitution) - mod(before.constitution));
  const bundleId = makeId(),
    root = baseline.creatureId,
    props = [],
    changes = [];
  const add = (type, values, parentId) => {
    const p = {
      _id: makeId(),
      type,
      root: { collection: "creatures", id: root },
      tags: [],
      ...values,
      ...(parentId ? { parentId } : {}),
    };
    props.push(p);
    return p._id;
  };
  const folder = add("folder", {
    groupStats: true,
    tab: "features",
    location: "start",
    name: `${c.name} level ${to.level}`,
    advancementBundle: bundleId,
    description: {
      text: `Native level-up: ${state.level} → ${to.level}. ${state.subclass || "Subclass not specified"}.`,
    },
  });
  const effect = (name, variable, amount) => {
    if (!amount) return;
    add(
      "effect",
      { name, operation: "add", amount: field(amount), stats: [variable] },
      folder,
    );
    changes.push({ name, variable, delta: amount });
  };
  effect("Character level", "level", 1);
  effect("Maximum hit points", "hitPoints", hpGain);
  effect(
    "Proficiency bonus",
    "proficiencyBonus",
    to.proficiency - from.proficiency,
  );
  for (const [a, n] of Object.entries(increases)) effect(a, a, n);
  effect(
    "Initiative",
    "initiative",
    mod(after.dexterity) - mod(before.dexterity),
  );
  const dex = (s) =>
    state.armorMode === "fixed"
      ? 0
      : state.armorMode === "medium"
        ? Math.min(2, mod(s.dexterity))
        : mod(s.dexterity);
  effect(
    "Armor Class",
    "armor",
    dex(after) -
      dex(before) +
      (state.armorMode === "monk" ? mod(after.wisdom) - mod(before.wisdom) : 0),
  );
  const proficiencyChoices = input.proficiencies || [];
  if (
    !Array.isArray(proficiencyChoices) ||
    proficiencyChoices.length > state.skills.length ||
    new Set(proficiencyChoices.map((s) => s.id)).size !==
      proficiencyChoices.length
  )
    fail("Invalid proficiency choices.");
  for (const choice of proficiencyChoices) {
    const existing = state.skills.find((s) => s.id === choice.id);
    if (
      !existing ||
      ![0, 0.5, 1, 2].includes(choice.multiplier) ||
      choice.multiplier < existing.multiplier
    )
      fail("Choose a valid new proficiency or expertise.");
  }
  const nextMultiplier = (s) => {
    let value =
      proficiencyChoices.find((choice) => choice.id === s.id)?.multiplier ??
      s.multiplier;
    if (
      s.save &&
      ((state.className === "monk" && to.level === 14) ||
        (state.className === "rogue" &&
          to.level === 15 &&
          s.ability === "wisdom"))
    )
      value = Math.max(1, value);
    return value;
  };
  for (const s of state.skills) {
    let n =
      mod(after[s.ability]) -
      mod(before[s.ability]) +
      Math.floor(to.proficiency * nextMultiplier(s)) -
      Math.floor(from.proficiency * s.multiplier);
    if (s.save && state.className === "paladin")
      n +=
        (to.level >= 6 ? Math.max(1, mod(after.charisma)) : 0) -
        (from.level >= 6 ? Math.max(1, mod(before.charisma)) : 0);
    effect(s.name, s.variable, n);
  }
  const hd = baseline.hitDice;
  if (!hd || hd.size !== "d" + c.hitDie)
    fail("Review the character’s hit-dice pool before advancing.");
  effect("Hit dice", hd.variable, 1);
  for (let index = 0; index < to.slots.length; index++) {
    const n = to.slots[index] - (from.slots[index] || 0);
    if (!n) continue;
    const pool = baseline.slots.find((x) => x.level === index + 1);
    if (pool) effect(`Level ${index + 1} spell slots`, pool.variable, n);
    else {
      const variable = "advanceSlots" + (index + 1);
      add(
        "attribute",
        {
          name: `Level ${index + 1} spell slots`,
          variableName: variable,
          attributeType: "spellSlot",
          baseValue: field(n),
          spellSlotLevel: field(index + 1),
          damage: 0,
          reset: "longRest",
        },
        folder,
      );
      changes.push({
        name: `Level ${index + 1} spell slots`,
        variable,
        delta: n,
      });
    }
  }
  const newScores = { ...after };
  const counters =
    state.className === "paladin"
      ? [
          {
            key: "layOnHands",
            name: "Lay on Hands",
            max: to.level * 5,
            old: state.level * 5,
            reset: "longRest",
          },
        ]
      : state.className === "monk"
        ? [
            {
              key: "kiPoints",
              name: "Ki points",
              max: to.level,
              old: state.level < 2 ? 0 : state.level,
              reset: "shortRest",
            },
          ]
        : state.className === "sorcerer"
          ? [
              {
                key: "sorceryPoints",
                name: "Sorcery points",
                max: to.level,
                old: state.level < 2 ? 0 : state.level,
                reset: "longRest",
              },
            ]
          : [];
  for (const counter of counters) {
    const pool = baseline.resources.find(
      (x) =>
        x.variable === counter.key ||
        x.name.toLowerCase() === counter.name.toLowerCase(),
    );
    if (pool) effect(counter.name, pool.variable, counter.max - counter.old);
    else {
      const spent = integer(
        input.resourceSpent ?? 0,
        0,
        counter.max,
        "spent class resource",
      );
      add(
        "attribute",
        {
          name: counter.name,
          variableName: counter.key,
          attributeType: "resource",
          baseValue: field(counter.max),
          damage: spent,
          reset: counter.reset,
        },
        folder,
      );
      changes.push({
        name: counter.name,
        variable: counter.key,
        delta: counter.max,
        newCounter: true,
      });
    }
  }
  if (state.className === "monk") {
    const speed = (n) => (n < 2 ? 0 : 10 + 5 * Math.floor((n - 2) / 4));
    if (state.armorMode === "monk")
      effect(
        "Unarmored movement",
        "speed",
        speed(to.level) - speed(from.level),
      );
  }
  const gainedFeatures = to.features.filter(
    (n) => n !== "Ability Score Improvement",
  );
  for (const name of gainedFeatures)
    add(
      "feature",
      {
        name,
        description: {
          text:
            c.descriptions[name] ||
            "Review this class or subclass choice in your rules source and record the selected option below. Conditional effects require manual resolution.",
        },
      },
      folder,
    );
  if (state.className === "paladin" && to.level === 11) {
    /* The SRD description above includes the extra 1d8 radiant melee-weapon damage. */
  }
  if (state.className === "rogue")
    add(
      "feature",
      {
        name: `Sneak Attack (${Math.ceil(to.level / 2)}d6)`,
        description: {
          text: `Your current Sneak Attack damage is ${Math.ceil(to.level / 2)}d6. Resolve the qualifying attack and damage manually; existing attacks are preserved.`,
        },
      },
      folder,
    );
  if (state.className === "monk")
    add(
      "feature",
      {
        name: `Martial Arts (d${to.level < 5 ? 4 : to.level < 11 ? 6 : to.level < 17 ? 8 : 10})`,
        description: {
          text: "Use this die for eligible Martial Arts attacks. Existing descriptive attacks are preserved.",
        },
      },
      folder,
    );
  if (feat)
    add(
      "feature",
      { name: feat.name, description: { text: feat.description } },
      folder,
    );
  const choices = typeof input.choices === "string" ? input.choices.trim() : "";
  if (choices.length > 8000) fail("Choice notes are too long.");
  if (
    to.features.some((n) =>
      /Oath|Archetype|Origin|Tradition|Metamagic|Fighting Style|Expertise|Favored Enemy|Natural Explorer/.test(
        n,
      ),
    ) &&
    !choices
  )
    fail("Record the class/subclass choices for this level.");
  if (choices)
    add(
      "feature",
      { name: `Level ${to.level} choices`, description: { text: choices } },
      folder,
    );
  if (!Array.isArray(input.spells || []) || (input.spells || []).length > 20)
    fail("Too many spell choices.");
  const replaced = input.replaceSpells || [];
  if (
    !Array.isArray(replaced) ||
    replaced.length > 1 ||
    replaced.some(
      (id) => !baseline.spells.some((s) => s.id === id && s.level > 0),
    )
  )
    fail("Choose at most one known spell to replace.");
  if (replaced.length && !["ranger", "sorcerer"].includes(state.className))
    fail("Only ranger and sorcerer spell replacement is handled here.");
  const selected = (input.spells || []).map((name) =>
    catalog.spells.find((s) => s.name === name),
  );
  if (new Set(input.spells || []).size !== (input.spells || []).length)
    fail("A spell can only be added once.");
  if (
    !input.allowExtraSpells &&
    ["ranger", "sorcerer"].includes(state.className)
  ) {
    if (
      selected.filter((s) => s && s.level > 0).length !==
        (to.known || 0) - (from.known || 0) + replaced.length ||
      selected.filter((s) => s && s.level === 0).length !==
        (to.cantrips || 0) - (from.cantrips || 0)
    )
      fail(
        "Choose the new spells and cantrips granted by this level, or explicitly enable additional subclass/feat spells.",
      );
  }
  const maxSpellLevel = to.slots.reduce(
    (n, count, i) => (count ? i + 1 : n),
    0,
  );
  let newCaster = null;
  if (c.castingAbility && baseline.casting.length === 0 && maxSpellLevel > 0) {
    const ability = c.castingAbility;
    const id = add(
      "spellList",
      {
        name: c.name + " spells",
        attackRollBonus: field(to.proficiency + mod(after[ability])),
        dc: field(8 + to.proficiency + mod(after[ability])),
      },
      folder,
    );
    newCaster = { id, ability, baseLevel: to.level, baseScore: after[ability] };
  }
  for (const choice of input.spells || []) {
    const spell = catalog.spells.find((s) => s.name === choice);
    if (
      !spell ||
      spell.level > maxSpellLevel ||
      (!input.allowExtraSpells && !spell.classes.includes(state.className))
    )
      fail("Choose a spell available at this level.");
    if (
      baseline.spells.some(
        (s) => s.name.toLowerCase() === spell.name.toLowerCase(),
      )
    )
      fail("This spell is already on the character.");
    const caster = baseline.casting[0] || newCaster;
    if (!caster) fail("Add a native spell list before choosing spells.");
    add(
      "spell",
      {
        name: spell.name,
        level: spell.level,
        prepared: true,
        description: { text: spell.description },
        summary: { text: "Resolve spell effects manually." },
      },
      caster.id,
    );
  }
  // All new children, including spells under an existing spell list, are gated.
  for (const p of props) p.advancementBundle = bundleId;
  const extra = input.adjustments || [];
  if (!Array.isArray(extra) || extra.length > 20)
    fail("Too many custom adjustments.");
  for (const a of extra) {
    const target = baseline.targets.find((t) => t.variable === a.variable);
    if (
      !target ||
      [...abilities, "level", "proficiencyBonus"].includes(a.variable)
    )
      fail(
        "Use the ability choices above for ability increases; select another statistic for this benefit.",
      );
    integer(a.delta, -100, 100, "custom adjustment");
    effect(label(a.name), a.variable, a.delta);
  }
  const step = {
    bundleId,
    abilityBefore: before,
    priorRetiredSpells: state.retiredSpells || [],
    priorSkills: state.skills,
    priorCasting: state.casting,
    priorSubclass: state.subclass,
    initialDamage: Object.fromEntries(
      props
        .filter((p) => p.type === "attribute")
        .map((p) => [p._id, p.damage || 0]),
    ),
    level: to.level,
    increases,
    hpGain,
    hpMode: input.hpMode,
    hpRoll: die,
    choices,
    feat,
    spells: input.spells || [],
    proficiencies: proficiencyChoices,
    createdAt: new Date().toISOString(),
    propertyIds: props.map((p) => p._id),
  };
  const nextSkills = state.skills.map((s) => ({
    ...s,
    multiplier: nextMultiplier(s),
  }));
  const next = {
    ...state,
    retiredSpells: [...(state.retiredSpells || []), ...replaced],
    skills: nextSkills,
    casting: newCaster ? [...state.casting, newCaster] : state.casting,
    subclass:
      typeof input.subclass === "string"
        ? input.subclass.trim().slice(0, 160)
        : state.subclass,
    revision: state.revision + 1,
    level: to.level,
    history: [...state.history, step],
    activeBundles: [...state.activeBundles, bundleId],
  };
  return {
    state: next,
    props,
    changes,
    features: gainedFeatures,
    summary: {
      from: state.level,
      to: to.level,
      hpGain,
      proficiency: to.proficiency,
      abilities: newScores,
      slots: to.slots,
      known: to.known,
      cantrips: to.cantrips,
    },
    requiresManualReview: true,
  };
}
