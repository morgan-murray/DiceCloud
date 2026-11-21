import { assert } from 'chai';
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { createHash } from 'node:crypto';
import { api, PlayerInvitations } from './service';
import '/imports/api/users/Users';
const digest = value => ({ digest: createHash('sha256').update(value).digest('hex'), algorithm: 'sha-256' });
const token = result => new URL(result.url).pathname.split('/').pop();
async function denied(fn) { let error; try { await fn(); } catch (e) { error = e; } assert.exists(error, 'request must be rejected'); }

describe('Private player invitations', function () {
  let managerId, otherId, oldSettings;
  const users = [];
  const identity = () => { const id = Random.id(); return { username: 'invite-' + id, email: id + '@example.invalid' }; };
  beforeEach(async function () {
    oldSettings = Meteor.settings.private;
    managerId = await Accounts.createUserAsync({ username: 'manager-' + Random.id(), password: Random.secret() });
    otherId = await Accounts.createUserAsync({ username: 'other-' + Random.id(), password: Random.secret() });
    users.push(managerId, otherId);
    Meteor.settings.private = { ...oldSettings, allowRegistration: false, playerInvitationManagers: [managerId] };
  });
  afterEach(async function () {
    for (const row of await PlayerInvitations.find({ inviterId: managerId }).fetchAsync()) if (row.userId) users.push(row.userId);
    await PlayerInvitations.removeAsync({ inviterId: managerId });
    for (const id of users.splice(0)) await Meteor.users.removeAsync(id);
    Meteor.settings.private = oldSettings;
  });
  it('denies anonymous/ordinary users and does not trust supplied authority', async function () {
    assert.isFalse((await api.status(null)).canInvite);
    assert.isFalse((await api.status(otherId)).canInvite);
    for (const id of [null, otherId]) {
      await denied(() => api.create(id, identity()));
      await denied(() => api.list(id));
      await denied(() => api.replace(id, { id: 'unknown' }));
      await denied(() => api.revoke(id, { id: 'unknown' }));
    }
    await denied(() => api.create(managerId, { ...identity(), inviterId: otherId }));
    const issued = await api.create(managerId, identity());
    Meteor.settings.private.playerInvitationManagers.push(otherId);
    assert.lengthOf(await api.list(otherId), 0);
    await denied(() => api.replace(otherId, { id: issued.id }));
    await denied(() => api.revoke(otherId, { id: issued.id }));
    Meteor.settings.private.playerInvitationManagers = [];
    await denied(() => api.create(managerId, identity()));
    await denied(() => api.preview(null, { token: token(issued) }));
    await denied(() => api.accept(null, { token: token(issued), password: digest('private test password') }));
  });
  it('creates no account until acceptance, stores only a token hash, and grants no inviter permission', async function () {
    const person = identity(), issued = await api.create(managerId, person);
    assert.notExists(await Accounts.findUserByUsername(person.username));
    const row = await PlayerInvitations.findOneAsync(issued.id);
    assert.notInclude(JSON.stringify(row), token(issued));
    assert.lengthOf(row.tokenHash, 64);
    assert.notProperty((await api.list(managerId))[0], 'tokenHash');
    const password = digest('a private test password');
    await denied(() => api.accept(otherId, { token: token(issued), password }));
    const accepted = await api.accept(null, { token: token(issued), password });
    const user = await Accounts.findUserByUsername(accepted.username);
    const checked = await Accounts._checkPasswordAsync(user, password);
    assert.notExists(checked.error);
    assert.equal(checked.userId, user._id);
    assert.isFalse((await api.status(user._id)).canInvite);
    assert.notInclude(user.roles || [], 'admin');
    assert.isFalse(Meteor.settings.private.allowRegistration);
    await denied(() => api.accept(null, { token: token(issued), password }));
    await denied(() => api.preview(null, { token: token(issued) }));
  });
  it('expires, replaces and revokes links without creating or changing accounts', async function () {
    const person = identity(), first = await api.create(managerId, person);
    await PlayerInvitations.updateAsync(first.id, { $set: { expiresAt: new Date(Date.now() - 1) } });
    await denied(() => api.preview(null, { token: token(first) }));
    await denied(() => api.accept(null, { token: token(first), password: digest('private test password') }));
    const fresh = await api.replace(managerId, { id: first.id });
    assert.notEqual(token(fresh), token(first));
    await denied(() => api.preview(null, { token: token(first) }));
    assert.equal((await api.preview(null, { token: token(fresh) })).username, person.username);
    await api.revoke(managerId, { id: first.id });
    await denied(() => api.accept(null, { token: token(fresh), password: digest('private test password') }));
    assert.notExists(await Accounts.findUserByUsername(person.username));
    const again = await api.create(managerId, person);
    const existing = await Accounts.createUserAsync({ ...person, password: 'an existing password' }); users.push(existing);
    await denied(() => api.accept(null, { token: token(again), password: digest('a different password') }));
    assert.notExists((await Accounts._checkPasswordAsync(await Meteor.users.findOneAsync(existing), 'an existing password')).error);
    assert.exists((await Accounts._checkPasswordAsync(await Meteor.users.findOneAsync(existing), 'a different password')).error);
    await denied(() => api.create(managerId, { ...person, username: person.username.toUpperCase() }));
    await denied(() => api.replace(managerId, { id: again.id }));
  });
  it('allows only one concurrent claim and rejects malformed or extra credential fields', async function () {
    const issued = await api.create(managerId, identity()), request = { token: token(issued), password: digest('private test password') };
    await denied(() => api.accept(null, { ...request, roles: ['admin'] }));
    await denied(() => api.accept(null, { ...request, password: { digest: 'bad', algorithm: 'sha-256' } }));
    const results = await Promise.allSettled([api.accept(null, request), api.accept(null, request)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await api.list(managerId))[0].state, 'accepted');
  });
});
