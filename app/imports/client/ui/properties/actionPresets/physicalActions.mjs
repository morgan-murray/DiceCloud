// Adapted from the SRD 5.1 combat and equipment chapters. See reference/srd51/NOTICE.md.
import { inertText } from '../../../../api/aurora/adapter.mjs';

export const commonActions = {
  Dash: 'Gain extra movement equal to your current speed for this turn.',
  Dodge: 'Until your next turn starts, attackers you can see have disadvantage against you, and you have advantage on Dexterity saves. These benefits end if you are incapacitated or your speed drops to zero.',
  Disengage: 'For the rest of this turn, your movement does not provoke opportunity attacks.',
  Help: 'Help an ally with a task to give advantage on their next check for it before your next turn. In combat, distract an enemy within 5 feet of you to give an ally advantage on their first attack against it before your next turn.',
  Hide: 'When the DM says hiding is possible, roll a d20 for Dexterity (Stealth).',
  Ready: 'Name a perceptible trigger and an action or movement. Before your next turn, you can use your reaction immediately after the trigger ends, or ignore it.',
  Search: 'Describe what you are looking for. If the DM calls for a check, roll a d20 for Wisdom (Perception) or Intelligence (Investigation).',
};

export function commonAction(name, vars = {}, trigger = '', response = '') {
  let summary = commonActions[name];
  if (!summary) return;
  const checks = { Hide: ['stealth'], Search: ['perception', 'investigation'] };
  for (const skill of checks[name] || []) {
    if (Number.isFinite(vars[skill]?.value)) summary += ' ' + skill[0].toUpperCase() + skill.slice(1) + ' modifier {' + skill + '}.';
  }
  if (name === 'Dash' && Number.isFinite(vars.speed?.value)) summary += ' Extra walking movement: {speed} ft.';
  if (name === 'Ready' && trigger.trim() && response.trim()) {
    summary += '\n\nWhen ' + inertText(trigger.trim()) + ', I will ' + inertText(response.trim()) + '.';
  }
  const action = { type: 'action', name, actionType: 'action', target: name === 'Help' ? 'singleTarget' : 'self', summary: { text: summary } };
  if (name === 'Ready') action.description = { text: 'To ready a spell, it must take one action to cast. Cast it now and maintain concentration until you release it. If concentration breaks, the spell is lost.' };
  return action;
}

export function weaponKey(name = '') {
  return name.toLowerCase().replace(/\s*\+\s*([123])\b/g, ' +$1').trim()
    .replace(/^(light|hand|heavy) crossbow\b/, 'crossbow, $1')
    .replace(/\b(short|long) (bow|sword)\b/g, '$1$2');
}

// Imported attacks are inert notes. Accept only the distinctive numeric attack line.
export function recordedAttack(note) {
  const [hit, damage, range] = (note.description?.text || '').split('\n');
  const bonus = /^\s*([+-]?\d{1,2})(?:\s+vs\.?\s+AC)?\s*$/i.exec(hit);
  if (!bonus || !damage?.trim() || !range?.trim()) return;
  return { id: note._id, name: note.name, bonus: Number(bonus[1]), damage: damage.trim(), range: range.trim() };
}

export function weaponProfile(name, catalog) {
  const key = weaponKey(name);
  const base = key.replace(/(?:^\+[123]\s+|\s+\+[123]$)/g, '');
  const profile = catalog[base];
  if (!profile) return;
  const magic = Number(key.match(/\+([123])/)?.[1] || 0);
  const { properties } = profile;
  const distance = properties.match(/range (\d+\/\d+)/i)?.[1];
  const reach = /\breach\b/i.test(properties) ? '10 ft' : '5 ft';
  return { ...profile, magic, base, versatile: properties.match(/versatile \((\dd\d+)\)/i)?.[1],
    range: profile.ranged ? distance + ' ft' : reach + (distance ? ' / thrown ' + distance + ' ft' : '') };
}

export function abilityFor(profile, vars) {
  if (!profile) return '';
  if (/finesse/i.test(profile.properties) && Number.isFinite(vars.strength?.modifier) && Number.isFinite(vars.dexterity?.modifier)) {
    return vars.dexterity.modifier > vars.strength.modifier ? 'dexterity' : 'strength';
  }
  return profile.ranged ? 'dexterity' : 'strength';
}

export function weaponProficiency(name, profile, skills) {
  const names = [weaponKey(name), profile?.base, profile && profile.group + ' weapons'];
  const known = skills.filter(p => names.includes(weaponKey(p.name))).map(p => p.proficiency);
  return known.some(n => n >= 1) ? true : null;
}

export function signed(value) {
  return value < 0 ? String(value) : '+' + value;
}

export function weaponNumbers(profile, ability, proficient, vars, twoHands) {
  const mod = vars[ability]?.modifier;
  const pb = vars.proficiencyBonus?.value;
  const bonus = Number.isFinite(mod) && typeof proficient === 'boolean' && (!proficient || Number.isFinite(pb))
    ? mod + (profile?.magic || 0) + (proficient ? pb : 0) : undefined;
  let damage = profile?.damage || '';
  if (twoHands && profile?.versatile) damage = damage.replace(/^\dd\d+/, profile.versatile);
  const damageMod = Number.isFinite(mod) ? mod + (profile?.magic || 0) : undefined;
  if (profile?.base === 'net') return { bonus, damage: 'restrain an eligible target (no damage)', range: profile.range };
  return { bonus, damage: damage && damageMod !== undefined ? damage.replace(/^(\d+d\d+|\d+)/, '$1' + signed(damageMod)) : '',
    range: profile?.range || '' };
}

export function weaponAction(item, bonus, damage, range) {
  return { type: 'action', name: item.name, actionType: 'attack', target: 'singleTarget',
    summary: { text: 'To hit: d20 ' + signed(bonus) + '. On a hit: ' + inertText(damage.trim()) + '. Range or reach: ' + inertText(range.trim()) + '.' },
    tags: ['weaponAttack-' + item._id] };
}

// Use sheet variables for standard bonuses so level-ups update the card. Hand-entered
// and imported totals stay fixed; they can contain bonuses the sheet cannot infer.
export function sheetWeaponAction(item, bonus, damage, range, profile, ability, proficient, vars, twoHands) {
  const action = weaponAction(item, bonus, damage, range);
  const expected = weaponNumbers(profile, ability, proficient, vars, twoHands);
  if (!['strength', 'dexterity'].includes(ability)) return action;
  const modifier = ability + '.modifier' + (profile?.magic ? ' + ' + profile.magic : '');
  const hit = expected.bonus === bonus ? 'd20, adding {' + modifier + (proficient ? ' + proficiencyBonus' : '') + '}' : 'd20 ' + signed(bonus);
  let damageRoll = inertText(damage.trim());
  if (profile?.damage && expected.damage && damage === expected.damage) {
    const base = twoHands && profile.versatile ? profile.damage.replace(/^\dd\d+/, profile.versatile) : profile.damage;
    damageRoll = base + ', adding {' + modifier + '}';
  }
  action.summary.text = 'To hit: ' + hit + '. On a hit: ' + damageRoll + '. Range or reach: ' + inertText(range.trim()) + '.';
  return action;
}
