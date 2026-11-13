const categories = [
  { key: 'armor', title: 'Armor proficiencies', icon: 'mdi-shield-outline' },
  { key: 'weapons', title: 'Weapon proficiencies', icon: 'mdi-sword' },
  { key: 'languages', title: 'Languages', icon: 'mdi-translate' },
];
const armor = /^(?:armor|armour)\s+proficienc(?:y|ies)(?:\s*[:(]|\s*$)/i;
const weapons = /^weapon\s+proficienc(?:y|ies)(?:\s*[:(]|\s*$)/i;
const language = /^languages?(?:\s*[:(]|\s*$)/i;
// Exact names only: features such as "Language of the Woods" remain separate.
const languages = new Set(['Common', 'Dwarvish', 'Elvish', 'Giant', 'Gnomish', 'Goblin', 'Halfling', 'Orc', 'Abyssal', 'Celestial', 'Draconic', 'Deep Speech', 'Infernal', 'Primordial', 'Sylvan', 'Undercommon', 'Aquan', 'Auran', 'Ignan', 'Terran', 'Druidic', "Thieves' Cant"].map(n => n.toLowerCase()));
export function featureCategory(feature) {
  const name = String(feature.name || '').trim().replace(/’/g, "'");
  const tags = new Set((Array.isArray(feature.tags) ? feature.tags : []).filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()));
  if (armor.test(name) || tags.has('armor-proficiency') || tags.has('armour-proficiency')) return 'armor';
  if (weapons.test(name) || tags.has('weapon-proficiency')) return 'weapons';
  if (language.test(name) || languages.has(name.toLowerCase()) || tags.has('language') || tags.has('languages')) return 'languages';
  return null;
}
export function featureLabel(feature, category) {
  const name = String(feature.name || 'Unnamed feature').trim();
  const prefix = category === 'armor' ? armor : category === 'weapons' ? weapons : language;
  const match = name.match(prefix);
  if (!match) return name;
  const rest = name.slice(match[0].length).trim();
  return (match[0].trim().endsWith('(') ? rest.replace(/\)\s*$/, '').trim() : rest) || name;
}
export function partitionFeatures(features) {
  const groups = categories.map(c => ({ ...c, features: [] })), remaining = [];
  for (const feature of features) {
    const category = featureCategory(feature);
    if (category) groups.find(g => g.key === category).features.push(feature);
    else remaining.push(feature);
  }
  for (const group of groups) group.features.sort((a, b) => featureLabel(a, group.key).localeCompare(featureLabel(b, group.key), 'en', { sensitivity: 'base' }));
  return { groups: groups.filter(g => g.features.length), remaining };
}
