import { createHash } from 'node:crypto';
import { rebuildNestedSets } from '/imports/api/parenting/parentingFunctions';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import Creatures from '/imports/api/creature/creatures/Creatures';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import { assertEditPermission } from '/imports/api/sharing/sharingPermissions';
import { classLevel, poolFor, sheetAbilities, validCost } from '/imports/api/classAbilities/physical.mjs';

async function createClassPool(userId, className, args) {
  check(args, { creatureId: String, remaining: Number });
  const { creatureId, remaining } = args;
  const isKi = className === 'monk';
  const ability = isKi ? 'Step of the Wind' : 'Font of Magic';
  const name = isKi ? 'Ki points' : 'Sorcery points';
  const sheet = await Creatures.findOneAsync(creatureId);
  await assertEditPermission(sheet, userId);
  const root = { collection: 'creatures', id: creatureId };
  const props = await CreatureProperties.find({ 'root.id': creatureId, removed: { $ne: true } }).fetchAsync();
  const level = classLevel(sheet, props.filter(p => !p.inactive && !p.disabled), className);
  if (!Number.isInteger(level) || level < 2 || level > 20 || !Number.isInteger(remaining) || remaining < 0 || remaining > level) {
    throw new Meteor.Error(isKi ? 'ki-balance' : 'sorcery-balance', 'Enter the current balance for this class level.');
  }
  if (props.some(p => poolFor(ability, { ...p, disabled: false, inactive: false, overridden: false }))) {
    throw new Meteor.Error('existing-pool', 'This resource already exists on the sheet. Check it under Stats.');
  }
  // Stable ID makes simultaneous initialisation safe without resetting a pool.
  const id = createHash('sha256').update((isKi ? 'class-ki/' : 'class-sorcery/') + creatureId).digest('hex').slice(0, 24);
  await CreatureProperties.insertAsync({ _id: id, root, type: 'attribute', name,
    variableName: isKi ? 'kiPoints' : 'sorceryPoints', attributeType: 'resource', baseValue: { calculation: String(level) },
    damage: level - remaining, reset: isKi ? 'shortRest' : 'longRest', dirty: true });
  await rebuildNestedSets(CreatureProperties, creatureId);
}

Meteor.methods({
  'classAbilities.createKiPool'(args) { return createClassPool(this.userId, 'monk', args); },
  'classAbilities.createSorceryPool'(args) { return createClassPool(this.userId, 'sorcerer', args); },
  async 'classAbilities.spend'(args) {
    check(args, { creatureId: String, poolId: String, ability: String, amount: Number, remaining: Number });
    const { creatureId, poolId, ability, amount, remaining } = args;
    const sheet = await Creatures.findOneAsync(creatureId);
    await assertEditPermission(sheet, this.userId);
    const active = { 'root.id': creatureId, removed: { $ne: true }, inactive: { $ne: true }, disabled: { $ne: true } };
    const pool = await CreatureProperties.findOneAsync({ ...active, _id: poolId });
    if (!pool || !poolFor(ability, pool) || !validCost(ability, amount, remaining)) {
      throw new Meteor.Error('invalid-pool', 'Choose an available counter and a valid amount.');
    }
    const features = await CreatureProperties.find({ ...active, $or: [
      { type: { $in: ['feature','class'] } }, { type: 'note', name: 'Aurora import record' },
    ] }, { fields: { type: 1, name: 1, level: 1, variableName: 1, 'description.text': 1 } }).fetchAsync();
    if (!sheetAbilities(sheet, features).some(a => a.name === ability)) throw new Meteor.Error('missing-feature', 'This ability is unavailable on this sheet.');
    // Compare both the displayed balance and the underlying spent points. A stale
    // tab or repeat submission cannot spend the same last point or slot twice.
    const updated = await CreatureProperties.updateAsync({
      ...active, _id: poolId, type: 'attribute', attributeType: pool.attributeType,
      overridden: { $ne: true }, value: remaining, total: pool.total, damage: pool.damage ?? null,
      $expr: { $eq: [{ $subtract: ['$total', { $ifNull: ['$damage', 0] }] }, remaining] },
    }, { $inc: { damage: amount, value: -amount }, $set: { dirty: true } }, { bypassCollection2: true });
    if (!updated) throw new Meteor.Error('balance-changed', 'The counter changed. Check its balance and try again.');
    return remaining - amount;
  },
});
