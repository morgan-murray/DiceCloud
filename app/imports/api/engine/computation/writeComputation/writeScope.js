import CreatureVariables from '/imports/api/creature/creatures/CreatureVariables';
import Creatures from '/imports/api/creature/creatures/Creatures';
import { EJSON } from 'meteor/ejson';
import { setVariables } from '/imports/api/engine/loadCreatures';

export default async function writeScope(creatureId, computation) {
  if (!creatureId) throw new Error('creatureId is required');
  const scope = EJSON.clone(computation.scope);
  const previous = await CreatureVariables.findOneAsync({ _creatureId: creatureId }) || {};
  const next = { _creatureId: creatureId };
  const $set = {};
  const $unset = {};
  for (const [key, value] of Object.entries(scope)) {
    if (key.startsWith('$') || key.startsWith('_')) continue;
    delete value.parent;
    for (const subKey of Object.keys(value)) {
      if (value[subKey] === undefined) delete value[subKey];
    }
    if (!Object.keys(value).length) continue;
    next[key] = value._id && value.type ? { _propId: value._id } : value;
    if (!EJSON.equals(previous[key], next[key])) $set[key] = next[key];
  }
  for (const key of Object.keys(previous)) {
    if (!key.startsWith('_') && !(key in next)) $unset[key] = 1;
  }
  const modifier = { $setOnInsert: { _creatureId: creatureId } };
  if (Object.keys($set).length) modifier.$set = $set;
  if (Object.keys($unset).length) modifier.$unset = $unset;
  await CreatureVariables.upsertAsync({ _creatureId: creatureId }, modifier);
  setVariables(creatureId, next);
  if (computation.creature?.dirty) {
    await Creatures.updateAsync(creatureId, { $unset: { dirty: 1 } });
  }
}
