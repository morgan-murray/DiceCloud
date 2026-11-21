import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { check, Match } from 'meteor/check';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { createHash } from 'node:crypto';
import SimpleSchema from '/imports/api/utility/SimpleSchema';

// Server-only: never publish invitation secrets or define collection mutations.
export const PlayerInvitations = new Mongo.Collection('playerInvitations', { defineMutationMethods: false });
const lifetime = 7 * 24 * 60 * 60 * 1000;
const hash = token => createHash('sha256').update(token).digest('hex');
const fail = (code, message) => { throw new Meteor.Error('player-invitations.' + code, message); };
const invalid = () => fail('invalid', 'This invitation is invalid, expired or already used. Ask for a new link.');
const tokenType = Match.Where(value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value));
export async function canInvite(userId) {
  const managers = Meteor.settings.private?.playerInvitationManagers;
  return Boolean(userId && Array.isArray(managers) && managers.includes(userId) && await Meteor.users.findOneAsync(userId, { fields: { _id: 1 } }));
}
async function manager(userId) {
  if (!await canInvite(userId)) fail('denied', 'You do not have permission to invite players.');
}
async function unusedIdentity(username, email) {
  if (await Accounts.findUserByUsername(username) || await Accounts.findUserByEmail(email)) {
    fail('exists', 'That username or email already has an account. Existing accounts are not changed.');
  }
}
function link(token, record) {
  return { id: record._id, url: Meteor.absoluteUrl('accept-invite/' + encodeURIComponent(token)), expiresAt: record.expiresAt };
}
export const api = {
  async status(userId) {
    return { canInvite: await canInvite(userId), publicRegistrationOpen: Meteor.settings.private?.allowRegistration === true };
  },
  async list(userId) {
    await manager(userId);
    const rows = await PlayerInvitations.find({ inviterId: userId }, {
      fields: { username: 1, email: 1, createdAt: 1, expiresAt: 1, state: 1 }, sort: { createdAt: -1 }, limit: 50,
    }).fetchAsync();
    return rows.map(row => ({ ...row, state: row.state === 'pending' && row.expiresAt <= new Date() ? 'expired' : row.state }));
  },
  async create(userId, request) {
    await manager(userId);
    check(request, { username: String, email: String });
    const username = request.username.trim(), email = request.email.trim();
    if (!/^[^\s@]{3,30}$/.test(username)) fail('username', 'Use a username of 3–30 characters without spaces or @.');
    if (email.length > 254 || !SimpleSchema.RegEx.Email.test(email)) fail('email', 'Enter a valid email address.');
    await unusedIdentity(username, email);
    const now = new Date();
    if (await PlayerInvitations.findOneAsync({ state: { $in: ['pending', 'claiming'] }, expiresAt: { $gt: now }, $or: [{ usernameKey: username.toLowerCase() }, { emailKey: email.toLowerCase() }] })) {
      fail('pending', 'An unused invitation already exists for that username or email.');
    }
    if (await PlayerInvitations.find({ inviterId: userId, state: 'pending', expiresAt: { $gt: now } }).countAsync() >= 25) {
      fail('limit', 'You already have 25 unused invitations. Revoke one before creating another.');
    }
    const token = Random.secret(43);
    const record = { _id: Random.id(), inviterId: userId, username, email, usernameKey: username.toLowerCase(), emailKey: email.toLowerCase(), tokenHash: hash(token), createdAt: now, expiresAt: new Date(now.getTime() + lifetime), state: 'pending' };
    await PlayerInvitations.insertAsync(record);
    return link(token, record);
  },
  async replace(userId, request) {
    await manager(userId); check(request, { id: String });
    const record = await PlayerInvitations.findOneAsync({ _id: request.id, inviterId: userId, state: 'pending' });
    if (!record) fail('unavailable', 'Only an unused invitation can have its link replaced.');
    await unusedIdentity(record.username, record.email);
    const token = Random.secret(43), expiresAt = new Date(Date.now() + lifetime);
    const changed = await PlayerInvitations.updateAsync({ _id: record._id, inviterId: userId, state: 'pending', tokenHash: record.tokenHash }, { $set: { tokenHash: hash(token), expiresAt } });
    if (changed !== 1) fail('changed', 'This invitation changed. Refresh and try again.');
    return link(token, { ...record, expiresAt });
  },
  async revoke(userId, request) {
    await manager(userId); check(request, { id: String });
    const changed = await PlayerInvitations.updateAsync({ _id: request.id, inviterId: userId, state: 'pending' }, { $set: { state: 'revoked' }, $unset: { tokenHash: 1 } });
    if (changed !== 1) fail('unavailable', 'This invitation has already been used, revoked or is being accepted.');
    return true;
  },
  async preview(_userId, request) {
    check(request, { token: tokenType });
    const row = await PlayerInvitations.findOneAsync({ tokenHash: hash(request.token), state: 'pending', expiresAt: { $gt: new Date() } });
    if (!row || !await canInvite(row.inviterId)) invalid();
    return { username: row.username, expiresAt: row.expiresAt };
  },
  async accept(userId, request) {
    if (userId) fail('signed-in', 'Sign out before accepting an invitation for a new account.');
    check(request, { token: tokenType, password: { digest: Match.Where(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)), algorithm: Match.Where(value => value === 'sha-256') } });
    const tokenHash = hash(request.token), claim = Random.id();
    // The claim and revocation compete on the same pending state. Only one wins.
    const changed = await PlayerInvitations.updateAsync({ tokenHash, state: 'pending', expiresAt: { $gt: new Date() } }, { $set: { state: 'claiming', claim } });
    if (changed !== 1) invalid();
    const row = await PlayerInvitations.findOneAsync({ tokenHash, state: 'claiming', claim });
    let newUserId;
    try {
      if (!await canInvite(row.inviterId)) invalid();
      await unusedIdentity(row.username, row.email);
      // Native Accounts validates the digest and stores its normal salted hash.
      newUserId = await Accounts.createUserAsync({ username: row.username, email: row.email, password: request.password });
    } catch (error) {
      await PlayerInvitations.updateAsync({ _id: row._id, state: 'claiming', claim }, { $set: { state: 'pending' }, $unset: { claim: 1 } });
      throw error;
    }
    // Never reopen a consumed invitation, even if bookkeeping fails after creation.
    await PlayerInvitations.updateAsync({ _id: row._id, state: 'claiming', claim }, { $set: { state: 'accepted', userId: newUserId, acceptedAt: new Date() }, $unset: { tokenHash: 1, claim: 1 } });
    return { username: row.username };
  },
};
const prefix = 'playerInvitations.';
Meteor.methods(Object.fromEntries(Object.entries(api).map(([name, handler]) => [prefix + name, async function (request) { return handler(this.userId, request); }])));
DDPRateLimiter.addRule({ type: 'method', name: name => [prefix + 'create', prefix + 'replace'].includes(name), userId: id => Boolean(id) }, 5, 60000);
DDPRateLimiter.addRule({ type: 'method', name: name => [prefix + 'preview', prefix + 'accept'].includes(name), connectionId: () => true }, 10, 60000);
Meteor.startup(async () => {
  await PlayerInvitations.createIndexAsync({ tokenHash: 1 }, { unique: true, sparse: true });
  await PlayerInvitations.createIndexAsync({ inviterId: 1, createdAt: -1 });
});
