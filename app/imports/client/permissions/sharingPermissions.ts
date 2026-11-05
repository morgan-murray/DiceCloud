import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Roles } from 'meteor/roles';
import type { Shared } from '/imports/api/sharing/SharingSchema';
import type { TreeDoc } from '/imports/api/parenting/ChildSchema';

// UI visibility reads Minimongo synchronously to preserve Tracker dependencies.
// Every mutation still checks the authoritative async permissions on the server.
function loggedIn(userId: string | null | undefined): asserts userId is string {
  if (!userId || !Meteor.users.findOne(userId)) throw new Meteor.Error('permission-denied');
}
function exists<T>(doc: T | undefined): asserts doc is T {
  if (!doc) throw new Meteor.Error('not-found');
}
function root(doc: Shared | TreeDoc | undefined): Shared {
  exists(doc);
  if ('root' in doc) return Mongo.getCollection(doc.root.collection).findOne(doc.root.id) as Shared;
  return doc;
}
export function assertEditPermission(doc: Shared | undefined, userId: string | null | undefined) {
  exists(doc);
  loggedIn(userId);
  if (doc.owner === userId || doc.writers?.includes(userId) || Roles.userIsInRole(userId, 'admin')) return;
  throw new Meteor.Error('permission-denied');
}
export function assertCopyPermission(doc: Shared | undefined, userId: string | null | undefined) {
  exists(doc);
  loggedIn(userId);
  if (doc.owner === userId || doc.writers?.includes(userId) || Roles.userIsInRole(userId, 'admin')) return;
  if (doc.readersCanCopy && (doc.public || doc.readers?.includes(userId))) return;
  throw new Meteor.Error('permission-denied');
}
export function assertViewPermission(doc: Shared | undefined, userId: string | null | undefined) {
  exists(doc);
  if (doc.public) return;
  loggedIn(userId);
  if (doc.owner === userId || doc.writers?.includes(userId) || doc.readers?.includes(userId) || Roles.userIsInRole(userId, 'admin')) return;
  throw new Meteor.Error('permission-denied');
}
export function assertDocEditPermission(doc: Shared | TreeDoc | undefined, userId: string | null | undefined) {
  assertEditPermission(root(doc), userId);
}
export function assertDocCopyPermission(doc: Shared | TreeDoc | undefined, userId: string | null | undefined) {
  assertCopyPermission(root(doc), userId);
}
