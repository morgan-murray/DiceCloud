// 2014 SRD 5.1, Classes: Paladin, Rogue and Monk. See reference/srd51/NOTICE.md.
export const abilities = [
  { name: 'Divine Smite', className: 'paladin', level: 2 },
  { name: 'Lay on Hands', className: 'paladin', level: 1 },
  { name: 'Cunning Action', className: 'rogue', level: 2 },
  { name: 'Sneak Attack', className: 'rogue', level: 1 },
  { name: 'Step of the Wind', className: 'monk', level: 2 },
];
const key = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function classLevel(sheet, props, name) {
  const current = sheet?.advancement;
  if (current?.className === name && Number.isInteger(current.level)) return current.level;
  const native = props.find(p => p.type === 'class' && [p.name, p.variableName].some(v => key(v) === name));
  if (Number.isInteger(native?.level)) return native.level;
  const record = props.find(p => p.type === 'note' && p.name === 'Aurora import record');
  const match = record?.description?.text?.split(/\r?\n/).map(s => /^(Paladin|Rogue|Monk) (\d{1,2})$/i.exec(s.trim()))
    .find(m => m && m[1].toLowerCase() === name);
  return match ? Number(match[2]) : undefined;
}

export function sheetAbilities(sheet, props) {
  const features = new Set(props.filter(p => p.type === 'feature').map(p => key(p.name)));
  return abilities.filter(a => features.has(key(a.name)) || classLevel(sheet, props, a.className) >= a.level);
}

export function poolFor(ability, p) {
  if (p.type !== 'attribute' || p.removed || p.inactive || p.overridden || p.disabled) return false;
  if (ability === 'Divine Smite') return p.attributeType === 'spellSlot' && Number.isInteger(p.spellSlotLevel?.value) && p.spellSlotLevel.value >= 1 && p.spellSlotLevel.value <= 9;
  if (p.attributeType !== 'resource') return false;
  const names = [p.name, p.variableName, ...(p.tags || [])].map(key);
  if (ability === 'Lay on Hands') return names.some(n => ['layonhands','layonhandspool','layonhandspoints'].includes(n));
  if (ability === 'Step of the Wind') return names.some(n => ['ki','kipoints','kipool','monkki'].includes(n));
  return false;
}

export function smiteDice(slotLevel, undeadOrFiend, critical) {
  const dice = Math.min(5, slotLevel + 1) + Number(undeadOrFiend);
  return (critical ? 2 : 1) * dice;
}
export function sneakDice(rogueLevel, critical) {
  return Number.isInteger(rogueLevel) && rogueLevel >= 1 && rogueLevel <= 20
    ? Math.ceil(rogueLevel / 2) * (critical ? 2 : 1) : undefined;
}
export function validCost(name, amount, available) {
  return Number.isSafeInteger(available) && Number.isSafeInteger(amount) && amount > 0 && amount <= available &&
    (name === 'Lay on Hands' || (['Divine Smite','Step of the Wind'].includes(name) && amount === 1));
}
