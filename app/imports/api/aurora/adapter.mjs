export const ADAPTER_VERSION = '1.0.0';
// Avoid Markdown links/HTML and the engine's inline calculation delimiters.
export function inertText(value = '') {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[{}]/g, c => c === '{' ? '&#123;' : '&#125;')
    .replace(/[\\`*_\[\]()!#|~]/g, c => '\\' + c);
}
const field = value => ({ calculation: String(value) });
export function mapSnapshot(snapshot, creatureId, owner, makeId) {
  if (snapshot.schemaVersion !== 1 || snapshot.rulesVersion !== '2014') throw new Error('Unsupported snapshot');
  const props = [];
  function add(type, values, parentId) {
    const prop = { _id: makeId(), type, root: { collection: 'creatures', id: creatureId }, tags: [], ...values };
    if (parentId) prop.parentId = parentId;
    props.push(prop); return prop._id;
  }
  function attribute(name, variableName, value, attributeType = 'stat', extra = {}) {
    if (!Number.isSafeInteger(value)) throw new Error('Invalid snapshot number');
    return add('attribute', { name, variableName, attributeType, baseValue: field(value), ...extra });
  }
  for (const [name, score] of Object.entries(snapshot.abilities)) attribute(name, name, score, 'ability');
  attribute('Level', 'level', snapshot.identity.level);
  attribute('Armor Class', 'armor', snapshot.armorClass);
  attribute('Initiative', 'initiative', snapshot.initiative, 'modifier', { ignoreLowerLimit: true });
  attribute('Proficiency Bonus', 'proficiencyBonus', snapshot.proficiency, 'modifier');
  for (const [mode, value] of Object.entries(snapshot.movement)) attribute(mode + ' speed (feet)', mode === 'walk' ? 'speed' : mode + 'Speed', value);
  attribute('Hit Points', 'hitPoints', snapshot.hitPoints.maximum, 'healthBar', { damage: 0, reset: 'longRest' });
  attribute('Temporary Hit Points', 'temporaryHitPoints', 0, 'healthBar', { damage: 0, ignoreUpperLimit: true, reset: 'longRest' });
  for (const [index, dice] of snapshot.hitDice.entries()) attribute(dice.name + ' hit dice', 'auroraHitDice' + index, dice.count, 'hitDice', { damage: 0, hitDiceSize: dice.size, reset: 'longRest' });
  for (const [name, bonus] of Object.entries(snapshot.saves)) add('skill', { name: name + ' save', skillType: 'save', variableName: name + 'Save', baseValue: field(bonus) });
  for (const [name, values] of Object.entries(snapshot.skills)) {
    add('skill', { name, variableName: name.replace(/ /g, ''), skillType: 'skill', baseValue: field(values.bonus), description: { text: 'Imported passive total: ' + values.passive + '. Review conditional bonuses manually.' } });
    if (values.passive !== 10 + values.bonus) add('effect', { name: name + ' passive adjustment', operation: 'passiveAdd', amount: field(values.passive - 10 - values.bonus), stats: [name.replace(/ /g, '')] });
  }
  for (const [index, resource] of snapshot.resources.entries()) attribute(resource.name, 'auroraSlots' + index, resource.total, 'spellSlot', { damage: 0, reset: resource.reset, spellSlotLevel: field(resource.level) });
  for (const caster of snapshot.spellcasting) {
    const parent = add('spellList', { name: caster.name, attackRollBonus: field(caster.attack), dc: field(caster.dc), description: { text: 'Fixed Aurora casting totals. Spell effects and preparation require manual review.' } });
    for (const spell of caster.spells) add('spell', { name: spell.name, level: spell.level, school: spell.school, prepared: spell.prepared === true || spell.alwaysPrepared === true, alwaysPrepared: spell.alwaysPrepared === true, description: { text: inertText(spell.description) + '\n\nKnown in source: ' + String(spell.known) }, summary: { text: 'Imported spell; resolve its effects manually.' } }, parent);
  }
  for (const item of snapshot.inventory) add('item', { name: item.name, quantity: item.quantity, equipped: item.equipped, attuned: item.attuned, description: { text: inertText(item.description + '\n' + item.notes) } });
  for (const [name, amount] of Object.entries(snapshot.currency)) if (amount) attribute(name + ' pieces', 'aurora' + name, amount, 'resource');
  for (const attack of snapshot.attacks) add('note', { name: attack.name, description: { text: inertText([attack.attack, attack.damage, attack.range, attack.description].join('\n')) } });
  for (const feature of snapshot.features) add('feature', { name: feature.name, description: { text: inertText(feature.description) } });
  for (const [index, note] of snapshot.notes.entries()) add('note', { name: 'Aurora note ' + (index + 1), description: { text: inertText(note) } });
  const provenance = { ...snapshot.provenance, adapterVersion: ADAPTER_VERSION,
    privateFiles: snapshot.provenance.privateFiles.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })) };
  // Complete hashes/versions survive reload, source deletion and archive/restore.
  const history = ['One-way 2014 current-sheet snapshot. Review totals after any build or equipment change.',
    'Level: ' + snapshot.identity.level + '; race: ' + snapshot.identity.race,
    ...snapshot.identity.classes.map(c => c.name + ' ' + c.level),
    ...snapshot.diagnostics.map(d => d.code + ': ' + d.message),
    'Provenance: ' + JSON.stringify({ ...provenance, contributions: undefined }),
    'SRD attribution: This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.'];
  add('note', { name: 'Aurora import record', description: { text: inertText(history.join('\n\n')) } });
  if (props.length > 1000) throw new Error('Import exceeds the 1,000 property limit');
  // The importer never subscribes this creature to a live ruleset/library.
  const creature = { _id: creatureId, owner, name: snapshot.identity.name, type: 'pc', public: false,
    readers: [], writers: [], allowedLibraries: [], allowedLibraryCollections: [], settings: {},
    propCount: props.length, denormalizedStats: { xp: 0, milestoneLevels: snapshot.identity.level } };
  return { creature, props, provenance };
}
