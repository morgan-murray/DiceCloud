import { castingDelta } from "/imports/api/advancement/rules.mjs";
export default function computeSpelllist(computation, node) {
  const prop = node.data;

  const state = computation.creature?.advancement;
  const delta = state ? castingDelta(state, prop._id) : 0;
  if (
    /^-?\d+$/.test(String(prop.dc?.calculation).trim()) &&
    Number.isFinite(prop.dc?.value)
  )
    prop.dc.value += delta;
  if (
    /^-?\d+$/.test(String(prop.attackRollBonus?.calculation).trim()) &&
    Number.isFinite(prop.attackRollBonus?.value)
  )
    prop.attackRollBonus.value += delta;

  const ability = computation.scope[prop.ability];
  if (Number.isFinite(ability?.modifier)) {
    prop.abilityMod = ability.modifier;
  } else if (Number.isFinite(ability?.value)) {
    prop.abilityMod = ability.value;
  }
}
