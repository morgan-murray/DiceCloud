import { Mongo } from 'meteor/mongo';
import type { Creature } from '/imports/api/creature/creatures/Creatures';
import { assertEditPermission as editPermission, assertViewPermission as viewPermission } from './sharingPermissions';

function resolve(creature: Creature | string | undefined) {
  return typeof creature === 'string' ? Mongo.getCollection('creatures').findOne(creature) as Creature | undefined : creature;
}
export function assertEditPermission(creature: Creature | string | undefined, userId: string | null | undefined) {
  editPermission(resolve(creature), userId);
}
export function assertViewPermission(creature: Creature | string | undefined, userId: string | null | undefined) {
  viewPermission(resolve(creature), userId);
}
