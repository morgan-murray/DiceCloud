// 2014 SRD 5.1 class abilities. See reference/srd51/NOTICE.md.
export const abilities = [
  { name: 'Divine Smite', className: 'paladin', level: 2 },
  { name: 'Lay on Hands', className: 'paladin', level: 1 },
  { name: 'Cunning Action', className: 'rogue', level: 2 },
  { name: 'Sneak Attack', className: 'rogue', level: 1 },
  { name: 'Step of the Wind', className: 'monk', level: 2 },
  { name: 'Font of Magic', className: 'sorcerer', level: 2 },
  { name: 'Quickened Spell', className: 'sorcerer', points: 2 },
  { name: 'Heightened Spell', className: 'sorcerer', points: 3 },
  { name: 'Elemental Affinity', className: 'sorcerer', points: 1 },
  { name: 'Primeval Awareness', className: 'ranger', level: 3 },
  { name: 'Extra Attack', className: 'ranger', level: 5 },
  { name: 'Hide in Plain Sight', className: 'ranger', level: 10 },
  { name: 'Horde Breaker', className: 'ranger' },
  { name: 'Multiattack Defense', className: 'ranger' },
];
const key = text => String(text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function classLevel(sheet, props, name) {
  const current = sheet?.advancement;
  if (current?.className === name && Number.isInteger(current.level)) return current.level;
  const native = props.find(p => p.type === 'class' && [p.name, p.variableName].some(v => key(v) === name));
  if (Number.isInteger(native?.level)) return native.level;
  const record = props.find(p => p.type === 'note' && p.name === 'Aurora import record');
  const match = record?.description?.text?.split(/\r?\n/).map(s => /^(Paladin|Rogue|Monk|Sorcerer|Ranger) (\d{1,2})$/i.exec(s.trim()))
    .find(m => m && m[1].toLowerCase() === name);
  return match ? Number(match[2]) : undefined;
}

export function sheetAbilities(sheet, props) {
  const features = new Set(props.filter(p => p.type === 'feature').map(p => key(p.name)));
  return abilities.filter(a => {
    const level = classLevel(sheet, props, a.className);
    if (a.level && level >= a.level) return true;
    if (a.name === 'Extra Attack' && !level) return false; // Other classes have different attack progressions.
    return features.has(key(a.name));
  });
}

export function poolFor(ability, p) {
  if (p.type !== 'attribute' || p.removed || p.inactive || p.overridden || p.disabled) return false;
  if (ability === 'Primeval Awareness' && /pact/i.test([p.name, p.variableName, ...(p.tags || [])].join(' '))) return false;
  if (['Divine Smite', 'Primeval Awareness'].includes(ability)) return p.attributeType === 'spellSlot' && Number.isInteger(p.spellSlotLevel?.value) && p.spellSlotLevel.value >= 1 && p.spellSlotLevel.value <= 9;
  if (p.attributeType !== 'resource') return false;
  const names = [p.name, p.variableName, ...(p.tags || [])].map(key);
  if (ability === 'Font of Magic' || abilities.some(a => a.name === ability && a.points)) {
    return names.some(n => ['sorcerypoints','sorcerypoint','sorcery','fontofmagic'].includes(n));
  }
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
    (name === 'Lay on Hands' || (fixedCost(name) === amount));
}

export function fixedCost(name) {
  if (['Divine Smite','Step of the Wind','Primeval Awareness'].includes(name)) return 1;
  return abilities.find(a => a.name === name)?.points;
}

export const slotCosts = [0, 2, 3, 5, 6, 7];
export function affinityDamage(props) {
  const dragons = { red: 'fire', gold: 'fire', brass: 'fire', black: 'acid', copper: 'acid',
    silver: 'cold', white: 'cold', blue: 'lightning', bronze: 'lightning', green: 'poison' };
  for (const p of props) {
    if (p.type !== 'feature') continue;
    const color = /^([a-z]+) dragon$/i.exec(p.name)?.[1].toLowerCase();
    if (dragons[color]) return dragons[color];
  }
}
