import { assert } from 'chai';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import sharp from 'sharp';
import Creatures from '/imports/api/creature/creatures/Creatures';
import '/imports/api/users/methods/deleteMyAccount';
import { Games, Revisions, Assets, Invites, createGame, listGames, state, getEntry, saveEntry, history, restoreRevision, trash, purge, invite, invitations, accept, revokeInvite, membership, configure, upload, image, updateAsset, removeAsset, destroy, maintenance } from './service';
async function denied(fn, code) { let error; try { await fn(); } catch (e) { error = e; } assert.exists(error, 'operation must be denied'); if (code) assert.equal(error.error, 'campaign-' + code); return error; }
describe('Campaign collaboration, atomic publishing, secrets and artwork', function () {
 this.timeout(120000);
 let owner, gm, player, second, outsider, game, other, pc, nativeId, protectedNativeId, png, hidden, city, tavern, mapAsset;
 const page = (type, title, extra = {}) => ({ campaignId: game, type, title, body: 'Shared journal text about the northern journey.', ...extra });
 async function edit(user, entryId, changes = {}, options) { const old = await getEntry(user, { campaignId: game, entryId }); return saveEntry(user, { ...page(old.type, old.title), entryId, revision: old.revision, body: old.body, kind: old.kind, tags: old.tags, parentId: old.parentId, relatedIds: old.relatedIds, assetIds: old.assetIds, visibility: old.visibility, playerId: old.playerId, ...changes }, options); }
 before(async () => {
  [owner, gm, player, second, outsider] = Array.from({ length: 5 }, () => Random.id());
  for (const user of [owner, gm, player, second, outsider]) await Meteor.users.insertAsync({ _id: user, username: 'camp-' + user, createdAt: new Date() });
  game = await createGame(owner, { name: 'The Northern Journey', description: 'Shared campaign test' }); other = await createGame(outsider, { name: 'Separate game' });
  for (const [userId, role] of [[gm, 'gm'], [player, 'player'], [second, 'player']]) { const inviteId = await invite(owner, { campaignId: game, username: 'camp-' + userId, role }); await accept(userId, { inviteId }); }
  nativeId = await Creatures.insertAsync({ name: 'Private native sheet', owner: player, readers: [], writers: [], public: false });
  protectedNativeId = await Creatures.insertAsync({ name: 'Owner sheet must survive deletion refusal', owner, readers: [], writers: [], public: false });
  png = (await sharp({ create: { width: 120, height: 80, channels: 3, background: '#8a4638' } }).png().toBuffer()).toString('base64');
 });
 after(async () => {
  for (const key of [game, other]) { const g = await Games.findOneAsync(key); if (g) { await configure(g.owner, { campaignId: key, version: g.version, name: g.name, description: g.description, archived: true }); await destroy(g.owner, { campaignId: key, confirm: g.name }); } }
  // Age only this suite's withdrawn records, then exercise actual garbage collection.
  await Assets.updateAsync({ campaignId: { $in: [game, other] } }, { $set: { createdAt: new Date(0) } }, { multi: true });
  await Revisions.updateAsync({ campaignId: { $in: [game, other] } }, { $set: { createdAt: new Date(0) } }, { multi: true });
  await maintenance(); await Creatures.removeAsync(nativeId); await Creatures.removeAsync(protectedNativeId); await Meteor.users.removeAsync({ _id: { $in: [owner, gm, player, second, outsider] } });
 });
 it('requires accepted, unexpired invitations and isolates two games', async () => {
  assert.lengthOf(await listGames(player), 1); assert.lengthOf(await listGames(outsider), 1);
  await denied(() => state(outsider, { campaignId: game }), 'access'); await denied(() => listGames(null), 'auth');
  const key = await invite(gm, { campaignId: game, username: 'camp-' + outsider, role: 'player' });
  await denied(() => accept(second, { inviteId: key }), 'access'); await revokeInvite(owner, { campaignId: game, inviteId: key }); await denied(() => accept(outsider, { inviteId: key }), 'access');
  const expired = await invite(owner, { campaignId: game, username: 'camp-' + outsider, role: 'player' }); await Invites.updateAsync(expired, { $set: { expiresAt: new Date(0) } }); await denied(() => accept(outsider, { inviteId: expired }), 'access'); assert.lengthOf(await invitations(outsider), 0);
  await denied(() => invite(player, { campaignId: game, username: 'camp-' + outsider }), 'permission');
 });
 it('shares profiles without granting native sheet access and protects another player’s profile', async () => {
  pc = (await saveEntry(player, page('pc', 'Ranger profile', { playerId: player, nativeCharacterId: nativeId })))._id;
  assert.equal((await getEntry(player, { campaignId: game, entryId: pc })).nativeCharacterId, nativeId);
  const shared = await getEntry(second, { campaignId: game, entryId: pc }); assert.isUndefined(shared.nativeCharacterId); assert.isTrue(shared.privateSheet);
  await denied(() => edit(second, pc, { body: 'Not my profile' }), 'permission');
  await edit(gm, pc, { body: 'GM-maintained biography' }); assert.equal((await getEntry(player, { campaignId: game, entryId: pc })).nativeCharacterId, nativeId);
  assert.equal((await Creatures.findOneAsync(nativeId)).owner, player);
 });
 it('stages failed saves privately, preserves committed acknowledgements and rejects stale edits', async () => {
  const before = await Games.findOneAsync(game), count = await Revisions.find({ campaignId: game }).countAsync();
  await denied(() => saveEntry(player, page('journal', 'Failed staging'), { fault: 'staging' }));
  assert.equal((await Games.findOneAsync(game)).version, before.version); assert.equal(await Revisions.find({ campaignId: game }).countAsync(), count);
  const first = await saveEntry(player, page('journal', 'Session One'), { fault: 'acknowledgement' });
  await edit(second, first._id, { body: 'Both players can edit shared notes.' });
  await denied(() => saveEntry(player, { ...page('journal', 'Session One'), entryId: first._id, revision: first.revision, body: 'Stale draft' }), 'conflict');
  assert.include((await getEntry(player, { campaignId: game, entryId: first._id })).body, 'Both players');
 });
 it('fences a prepared edit when membership changes before publication', async () => {
  const original = Revisions.insertAsync, target = (await saveEntry(player, page('journal', 'Race fixture')))._id;
  Revisions.insertAsync = async function (...args) { const key = await original.apply(this, args); await Games.updateAsync(game, { $inc: { version: 1 } }); return key; };
  try { await denied(() => edit(player, target, { body: 'Must never publish' }), 'conflict'); } finally { Revisions.insertAsync = original; }
  assert.notInclude((await getEntry(player, { campaignId: game, entryId: target })).body, 'Must never publish');
 });
 it('hides GM text, ancestry, snippets, relations and historical spoilers', async () => {
  hidden = (await saveEntry(gm, page('location', 'Secret fortress', { visibility: 'gm', body: 'The password is silver-moon.' })))._id;
  city = (await saveEntry(gm, page('location', 'Greyford', { parentId: hidden, body: 'A city under a hidden parent.' })))._id;
  tavern = (await saveEntry(gm, page('place', 'Red Stag Tavern', { parentId: city })))._id;
  await denied(() => getEntry(player, { campaignId: game, entryId: city }), 'access'); assert.equal((await state(player, { campaignId: game, query: 'silver-moon' })).total, 0);
  await edit(gm, pc, { relatedIds: [hidden] }); assert.notInclude((await getEntry(player, { campaignId: game, entryId: pc })).relatedIds, hidden);
  const proposal = await denied(() => edit(gm, hidden, { visibility: 'shared', body: 'The shared fortress description.' }), 'publish'); assert.include(JSON.parse(proposal.details).entries, 'Red Stag Tavern');
  await edit(gm, hidden, { visibility: 'shared', body: 'The shared fortress description.', confirmPublish: true });
  assert.equal((await getEntry(player, { campaignId: game, entryId: tavern })).title, 'Red Stag Tavern');
  assert.notInclude(JSON.stringify(await history(player, { campaignId: game, entryId: hidden })), 'silver-moon');
  const privateRevision = (await history(gm, { campaignId: game, entryId: hidden })).find(r => r.body.includes('silver-moon'));
  const e = await getEntry(gm, { campaignId: game, entryId: hidden }); await denied(() => restoreRevision(gm, { campaignId: game, entryId: hidden, revision: e.revision, historyId: privateRevision._id }), 'publish');
 });
 it('rejects hierarchy cycles and preserves independently trashed children', async () => {
  await denied(() => edit(gm, hidden, { parentId: tavern }), 'hierarchy');
  await denied(() => edit(player, city, { parentId: null }), 'permission');
  const e = await getEntry(gm, { campaignId: game, entryId: tavern }); await trash(gm, { campaignId: game, entryId: tavern, revision: e.revision, restore: false });
  let p = await getEntry(gm, { campaignId: game, entryId: city }); await trash(gm, { campaignId: game, entryId: city, revision: p.revision, restore: false });
  p = (await state(gm, { campaignId: game, trash: true })).entries.find(x => x._id === city); await trash(gm, { campaignId: game, entryId: city, revision: p.revision, restore: true });
  await denied(() => getEntry(player, { campaignId: game, entryId: tavern }), 'access');
  const discarded = (await state(gm, { campaignId: game, trash: true })).entries.find(x => x._id === tavern); await purge(gm, { campaignId: game, entryId: tavern, revision: discarded.revision, confirm: discarded.title });
 });
 it('validates images, hides private originals/previews and publishes media atomically', async () => {
  await denied(() => upload(player, { campaignId: game, name: 'bad.png', category: 'map', data: Buffer.from('<svg/>').toString('base64') }, { ignoreDiskReserve: true }), 'image');
  const secret = (await saveEntry(gm, page('npc', 'Secret patron', { visibility: 'gm' })))._id, e = await getEntry(gm, { campaignId: game, entryId: secret });
  mapAsset = (await upload(gm, { campaignId: game, entryId: secret, revision: e.revision, name: 'Secret-map.png', category: 'map', data: png, visibility: 'shared' }, { ignoreDiskReserve: true }))._id;
  assert.notInclude(JSON.stringify(await state(player, { campaignId: game })), 'Secret-map');
  for (const original of [true, false]) await denied(() => image(player, { campaignId: game, assetId: mapAsset, original }), 'access');
  const before = await Assets.find({ campaignId: game }).countAsync();
  await denied(() => upload(player, { campaignId: game, name: 'failed.png', category: 'portrait', data: png }, { ignoreDiskReserve: true, fault: 'staging' })); assert.equal(await Assets.find({ campaignId: game }).countAsync(), before);
  const readable = await image(gm, { campaignId: game, assetId: mapAsset, original: true }); assert.equal(readable.data, png);
  await denied(() => updateAsset(gm, { campaignId: game, assetId: mapAsset, visibility: 'shared' }), 'publish');
  mapAsset = (await updateAsset(gm, { campaignId: game, assetId: mapAsset, visibility: 'shared', confirmPublish: true, caption: 'Revealed map' }))._id;
  assert.equal((await image(player, { campaignId: game, assetId: mapAsset, original: true })).data, png);
 });
 it('rechecks media and data permissions after removal, preserving campaign-owned assets', async () => {
  await membership(gm, { campaignId: game, userId: second, action: 'remove' }); assert.lengthOf(await listGames(second), 0);
  await denied(() => image(second, { campaignId: game, assetId: mapAsset }), 'access'); await denied(() => state(second, { campaignId: game }), 'access');
  assert.equal((await image(player, { campaignId: game, assetId: mapAsset, original: true })).data, png);
 });
 it('withdraws GM text and history immediately after demotion', async () => {
  const secret = (await state(gm, { campaignId: game })).entries.find(e => e.title === 'Secret patron');
  await membership(owner, { campaignId: game, userId: player, action: 'role', role: 'gm' });
  assert.equal((await getEntry(player, { campaignId: game, entryId: secret._id })).title, 'Secret patron');
  await membership(owner, { campaignId: game, userId: player, action: 'role', role: 'player' });
  await denied(() => getEntry(player, { campaignId: game, entryId: secret._id }), 'access');
  await denied(() => history(player, { campaignId: game, entryId: secret._id }), 'access');
 });
 it('blocks native account deletion before touching sheets, supports transfer and archived read-only games', async () => {
  await denied(() => Meteor.users.deleteMyAccount._execute({ userId: owner }, null), 'ownership'); assert.exists(await Meteor.users.findOneAsync(owner)); assert.exists(await Creatures.findOneAsync(nativeId)); assert.exists(await Creatures.findOneAsync(protectedNativeId));
  await membership(owner, { campaignId: game, userId: gm, action: 'transfer' });
  const g = await Games.findOneAsync(game); await configure(gm, { campaignId: game, version: g.version, name: g.name, description: g.description, archived: true });
  await denied(() => saveEntry(player, page('journal', 'Archived edit')), 'archived'); assert.isAbove((await state(player, { campaignId: game })).entries.length, 0);
  assert.equal((await Creatures.findOneAsync(nativeId)).owner, player);
 });
});
