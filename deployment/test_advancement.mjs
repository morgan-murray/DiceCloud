import test from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  planLevel,
  table,
  mod,
  castingDelta,
  catalog,
} from "../app/imports/api/advancement/rules.mjs";
const stats = {
  strength: 18,
  dexterity: 12,
  constitution: 16,
  intelligence: 10,
  wisdom: 14,
  charisma: 18,
};
function fixture(name = "paladin", level = 10) {
  const base = {
    creatureId: "fictional",
    level,
    abilities: stats,
    hp: 100,
    skills: [
      {
        id: "athletics",
        name: "athletics",
        variable: "athletics",
        ability: "strength",
        multiplier: 1,
      },
      {
        id: "wisdomSave",
        name: "wisdom save",
        variable: "wisdomSave",
        ability: "wisdom",
        multiplier: 1,
        save: true,
      },
    ],
    casting: [{ id: "casting", name: "Magic" }],
    hitDice: { variable: "dice", size: "d" + catalog.classes[name].hitDie },
    slots: table(name, level).slots.flatMap((n, i) =>
      n ? [{ variable: "slot" + i, level: i + 1, total: n }] : [],
    ),
    resources: [],
    spells: [],
    targets: [{ variable: "armor", name: "Armor Class" }],
  };
  const state = initialState(
    {
      className: name,
      subclass: "Any custom subclass",
      armorMode: "fixed",
      skills: base.skills,
      casting: [{ id: "casting", ability: "charisma" }],
    },
    base,
  );
  return { base, state };
}
let serial = 0;
const id = () => String(++serial);
const choice = {
  hpMode: "average",
  resourceSpent: 0,
  choices: "Chosen options checked with DM.",
  allowExtraSpells: true,
  spells: [],
  adjustments: [],
};
test("paladin 10→11: HP, third-level slot, hit die, Improved Divine Smite, preserved source", () => {
  const { base, state } = fixture(),
    saved = JSON.stringify(base);
  const plan = planLevel(state, choice, base, id);
  assert.equal(plan.summary.hpGain, 9);
  assert.deepEqual(plan.summary.slots, [4, 3, 3, 0, 0]);
  assert.ok(plan.features.includes("Improved Divine Smite"));
  assert.equal(plan.changes.find((x) => x.variable === "dice").delta, 1);
  assert.equal(
    plan.changes.find((x) => x.name === "Level 3 spell slots").delta,
    1,
  );
  assert.equal(
    plan.props.find((p) => p.variableName === "layOnHands").baseValue
      .calculation,
    "55",
  );
  assert.equal(JSON.stringify(base), saved);
  assert.ok(
    plan.props.every(
      (p) => p.advancementBundle === plan.state.activeBundles[0],
    ),
  );
});
test("Constitution ASI applies retroactively and spellcasting changes once", () => {
  const { base, state } = fixture("paladin", 11);
  const plan = planLevel(
    state,
    { ...choice, asiMode: "abilities", increases: { constitution: 2 } },
    base,
    id,
  );
  assert.equal(plan.summary.hpGain, 21);
  assert.equal(plan.summary.abilities.constitution, 18);
  assert.equal(castingDelta(plan.state, "casting"), 0);
});
test("proficiency 12→13 updates proficient skills, saves and casting", () => {
  const { base, state } = fixture("paladin", 12);
  const plan = planLevel(state, choice, base, id);
  assert.equal(plan.changes.find((x) => x.variable === "athletics").delta, 1);
  assert.equal(plan.changes.find((x) => x.variable === "wisdomSave").delta, 1);
  assert.equal(castingDelta(plan.state, "casting"), 1);
  assert.equal(castingDelta(plan.state, "another-list"), 0);
});
test("all five classes have 20 independently bounded advancement rows", () => {
  for (const name of ["paladin", "ranger", "sorcerer", "rogue", "monk"]) {
    assert.equal(table(name, 1).proficiency, 2);
    assert.equal(table(name, 5).proficiency, 3);
    assert.equal(table(name, 9).proficiency, 4);
    assert.equal(table(name, 13).proficiency, 5);
    assert.equal(table(name, 17).proficiency, 6);
    assert.throws(() => table(name, 21));
    const { base, state } = fixture(name, 10);
    const plan = planLevel(state, choice, base, id);
    assert.equal(plan.state.className, name);
    assert.equal(plan.state.subclass, "Any custom subclass");
    assert.equal(plan.state.level, 11);
  }
});
test("spell and resource progressions match selected published milestone values", () => {
  assert.deepEqual(table("ranger", 13).slots, [4, 3, 3, 1, 0]);
  assert.deepEqual(table("sorcerer", 20).slots, [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  assert.equal(table("sorcerer", 11).known, 12);
  assert.equal(table("ranger", 11).known, 7);
  assert.equal(catalog.spells.find((s) => s.name === "Aid").level, 2);
});
test("invalid choices cannot silently alter a character", () => {
  const { base, state } = fixture();
  assert.throws(() =>
    planLevel(state, { ...choice, hpMode: "roll", hpRoll: 11 }, base, id),
  );
  assert.throws(() =>
    planLevel(state, { ...choice, increases: { strength: 2 } }, base, id),
  );
  assert.throws(() =>
    planLevel(
      state,
      {
        ...choice,
        adjustments: [
          { name: "Bad target", variable: "anotherCharacter", delta: 1 },
        ],
      },
      base,
      id,
    ),
  );
  const next = fixture("paladin", 11);
  assert.throws(() =>
    planLevel(
      next.state,
      { ...choice, asiMode: "abilities", increases: { charisma: 3 } },
      next.base,
      id,
    ),
  );
});
test("minimum 1 HP applies after negative Constitution and custom feats stay available", () => {
  const { base, state } = fixture("rogue", 3);
  state.baseAbilities = { ...stats, constitution: 3 };
  base.abilities = { ...stats, constitution: 3 };
  const plan = planLevel(
    state,
    {
      ...choice,
      hpMode: "roll",
      hpRoll: 1,
      asiMode: "feat",
      feat: { name: "A custom table feat", description: "Approved by the DM." },
    },
    base,
    id,
  );
  assert.equal(plan.summary.hpGain, 1);
  assert.ok(plan.props.some((p) => p.name === "A custom table feat"));
});

test("monk unarmored speed changes at 6, 10, 14 and 18, not at 4", () => {
  for (const [from, expected] of [
    [3, 0],
    [5, 5],
    [9, 5],
    [13, 5],
    [17, 5],
  ]) {
    const { base, state } = fixture("monk", from);
    state.armorMode = "monk";
    const input = {
      ...choice,
      ...(from === 3
        ? { asiMode: "abilities", increases: { strength: 2 } }
        : {}),
    };
    const p = planLevel(state, input, base, id);
    assert.equal(
      p.changes.find((x) => x.variable === "speed")?.delta || 0,
      expected,
    );
  }
});
test("ranger 1→2 creates its first spell list and slots without an external builder", () => {
  const { base, state } = fixture("ranger", 1);
  base.casting = [];
  state.casting = [];
  const p = planLevel(
    state,
    {
      ...choice,
      allowExtraSpells: false,
      spells: ["Cure Wounds", "Hunter's Mark"],
    },
    base,
    id,
  );
  assert.equal(p.props.filter((x) => x.type === "spellList").length, 1);
  assert.equal(p.props.filter((x) => x.type === "spell").length, 2);
  assert.equal(
    p.props.find((x) => x.attributeType === "spellSlot").baseValue.calculation,
    "2",
  );
  assert.equal(castingDelta(p.state, p.state.casting[0].id), 0);
});

test("new expertise continues to scale at a later proficiency increase", () => {
  const { base, state } = fixture("ranger", 11);
  const first = planLevel(
    state,
    {
      ...choice,
      asiMode: "abilities",
      increases: { constitution: 2 },
      proficiencies: [{ id: "athletics", multiplier: 2 }],
    },
    base,
    id,
  );
  assert.equal(first.changes.find((x) => x.variable === "athletics").delta, 4);
  const second = planLevel(
    first.state,
    choice,
    {
      ...base,
      level: 12,
      slots: table("ranger", 12).slots.flatMap((n, i) =>
        n ? [{ variable: "slot" + i, level: i + 1, total: n }] : [],
      ),
    },
    id,
  );
  assert.equal(second.changes.find((x) => x.variable === "athletics").delta, 2);
});

test("an intervening ability edit is respected by the next ASI and casting delta", () => {
  const { base, state } = fixture("paladin", 11);
  base.abilities = { ...base.abilities, charisma: 19 };
  const p = planLevel(
    state,
    {
      ...choice,
      asiMode: "feat",
      increases: { charisma: 1 },
      feat: {
        name: "A chosen half feat",
        description: "One Charisma point, approved.",
      },
    },
    base,
    id,
  );
  assert.equal(p.summary.abilities.charisma, 20);
  assert.equal(castingDelta(p.state, "casting"), 1);
  base.abilities.charisma = 20;
  assert.throws(() =>
    planLevel(
      state,
      { ...choice, asiMode: "abilities", increases: { charisma: 2 } },
      base,
      id,
    ),
  );
});
