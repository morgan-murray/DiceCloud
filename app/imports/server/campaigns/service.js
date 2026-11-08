import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import Creatures from '/imports/api/creature/creatures/Creatures';
import Tabletops from '/imports/api/tabletop/Tabletops';
import { assertViewPermission } from '/imports/api/sharing/sharingPermissions';

export const Games = new Mongo.Collection('campaigns');
export const Revisions = new Mongo.Collection('campaignRevisions');
export const Invites = new Mongo.Collection('campaignInvites');
export const Assets = new Mongo.Collection('campaignAssets');
const TYPES = ['pc', 'npc', 'location', 'place', 'journal'];
const MANAGERS = ['owner', 'gm'];
const MEDIA_LIMIT = 25 * 1024 ** 2, TOTAL_MEDIA_LIMIT = 150 * 1024 ** 2;
const TEXT_LIMIT = 4 * 1024 ** 2, HISTORY_LIMIT = 32 * 1024 ** 2;
const running = new Set();
function tabletopView(tabletop, user) { if (!tabletop || ![tabletop.owner, ...(tabletop.players || []), ...(tabletop.gameMasters || []), ...(tabletop.spectators || [])].includes(user)) fail('access', 'Native tabletop access is required.'); }
const mediaRoot = () => path.join(process.env.DICECLOUD_STORAGE_PATH || '/tmp/dicecloud-campaign-test', 'campaigns');
function fail(code, message, details) { throw new Meteor.Error('campaign-' + code, message, details && JSON.stringify(details)); }
function auth(user) { if (!user) fail('auth', 'Sign in to use Campaigns.'); return user; }
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value)) fail('request', 'Invalid identifier.'); return value; }
function fields(arg, allowed) { if (!arg || typeof arg !== 'object' || Array.isArray(arg) || Object.keys(arg).some(k => !allowed.includes(k))) fail('request', 'Invalid campaign request.'); }
function text(value, max, required = false) { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('request', 'Text is missing or too long.'); return value.trim(); }
function markdown(value,max){text(value,max);return value;}
function bool(value) { if (typeof value !== 'boolean') fail('request', 'Invalid option.'); return value; }
function strings(value, max, length) { if (!Array.isArray(value) || value.length > max) fail('request', 'Too many values.'); return [...new Set(value.map(v => text(v, length, true)))]; }
function ids(value, max = 30) { if (!Array.isArray(value) || value.length > max) fail('request', 'Too many links.'); return [...new Set(value.map(id))]; }
function userRole(game, user) { return game.members.find(m => m.userId === user)?.role; }
const manager = role => MANAGERS.includes(role);
function refs(game) { return new Set(Object.values(game.history).flat()); }
export async function access(user, gameId, manage = false, write = false) {
 auth(user); if (!await Meteor.users.findOneAsync(user,{fields:{_id:1}})) fail('auth','Your account is no longer available.'); const game = await Games.findOneAsync(id(gameId)); const role = game && userRole(game, user);
 if (!role) fail('access', 'Campaign not found or your access has ended.');
 if (manage && !manager(role)) fail('permission', 'An owner or GM must do this.');
 if (write && game.archived) fail('archived', 'Restore this archived campaign before editing.');
 return { game, role, user };
}
async function locked(key, fn) {
 // Process mutex limits duplicate work on the deployed single app. The root CAS below
 // is the correctness boundary, including when another process changes membership.
 if (running.has(key)) fail('busy', 'Another save is finishing. Your draft is safe; please retry.');
 running.add(key); try { return await fn(); } finally { running.delete(key); }
}
function restricted(entry, map, includeTrash = false) {
 let p = entry; const seen = new Set(); let gm = false;
 while (p) {
  if (seen.has(p._id) || seen.size >= 8 || (p.deleted && !includeTrash)) return 'missing';
  seen.add(p._id); if (p.visibility === 'gm') gm = true;
  if (!p.parentId) return gm ? 'gm' : 'shared';
  p = map.get(p.parentId);
 }
 return 'missing';
}
async function contextFrom(a, includeTrash = false) {
 const snapshots = await Revisions.find({ _id: { $in: Object.values(a.game.heads) } }).fetchAsync();
 const rows = snapshots.map(r => r.page), map = new Map(rows.map(e => [e._id, e]));
 const visible = e => Boolean(e && restricted(e, map, includeTrash) !== 'missing' && (manager(a.role) || restricted(e, map, includeTrash) === 'shared'));
 return { ...a, rows, map, visible };
}
async function consistent(c) {
 const current = await access(c.user, c.game._id);
 if (current.game.version !== c.game.version) fail('refresh', 'The campaign changed during this read. Please retry.');
}
async function context(user, gameId, includeTrash = false) { return contextFrom(await access(user, gameId), includeTrash); }
function descendants(key, rows) { const out = new Set([key]); let changed = true; while (changed) { changed = false; for (const e of rows) if (e.parentId && out.has(e.parentId) && !out.has(e._id)) { out.add(e._id); changed = true; } } return out; }
function canEdit(e, c) { return !c.game.archived && (manager(c.role) || (c.visible(e) && (e.type !== 'pc' || e.playerId === c.user))); }
function revision(e, n) { if (!Number.isInteger(n) || n !== e.revision) fail('conflict', 'Someone saved a newer revision. Your draft has been kept. Compare it with the current page before saving again.', { revision: e.revision }); }
function assetVisible(a, c) { return manager(c.role) || (a.visibility === 'shared' && (a.standalone || c.rows.some(e => !e.deleted && e.assetIds.includes(a._id) && c.visible(e)))); }
async function assetRows(c) { return Assets.find({ _id: { $in: c.game.assetIds } }).fetchAsync(); }
function pageMeta(e, c, assets) {
 return { _id: e._id, title: e.title, type: e.type, kind: e.kind, tags: e.tags, date: e.date, parentId: e.parentId, visibility: e.visibility, restricted: restricted(e, c.map, true) === 'gm', revision: e.revision, updatedAt: e.updatedAt, updatedBy: e.updatedBy, playerId: e.playerId, deleted: e.deleted, canEdit: canEdit(e, c), assetIds: e.assetIds.filter(key => assets.some(a => a._id === key && assetVisible(a, c))), relatedIds: e.relatedIds.filter(key => c.visible(c.map.get(key))) };
}
async function stagePage(tx, page) {
 const copy = { ...page, revision: page.revision + 1, updatedAt: new Date(), updatedBy: tx.user };
 const record = { _id: Random.id(), campaignId: tx.game._id, entryId: copy._id, revision: copy.revision, epoch: copy.epoch, createdAt: new Date(), bytes: Buffer.byteLength(JSON.stringify(copy)), page: copy };
 await Revisions.insertAsync(record); tx.staged.push(['revision', record._id]);
 tx.game.heads[copy._id] = record._id;
 tx.game.history[copy._id] = [record._id, ...(tx.game.history[copy._id] || [])].slice(0, 50);
 tx.map.set(copy._id, copy); return copy;
}
async function trimHistory(tx) {
 const liveBytes = [...tx.map.values()].reduce((sum, p) => sum + Buffer.byteLength(p.body), 0);
 if (liveBytes > TEXT_LIMIT) fail('quota', 'Campaign notes have reached the 4 MiB text limit. Purge unwanted trash or shorten large pages.');
 const records = await Revisions.find({ _id: { $in: [...refs(tx.game)] } }, { fields: { bytes: 1, createdAt: 1, entryId: 1 }, sort: { createdAt: 1 } }).fetchAsync();
 let bytes = records.reduce((sum, r) => sum + r.bytes, 0), count = records.length; const heads = new Set(Object.values(tx.game.heads));
 for (const r of records) { if (bytes <= HISTORY_LIMIT && count <= 4000) break; if (heads.has(r._id)) continue; tx.game.history[r.entryId] = tx.game.history[r.entryId].filter(key => key !== r._id); bytes -= r.bytes; count--; }
}
async function cleanupStaged(staged) {
 for (const [kind, key] of staged) {
  if (kind === 'revision') {
   const r = await Revisions.findOneAsync(key), game = r && await Games.findOneAsync(r.campaignId);
   if (game && refs(game).has(key)) continue;
   await Revisions.removeAsync(key);
  } else {
   if (await Games.findOneAsync({ assetIds: key })) continue;
   const asset = await Assets.findOneAsync(key), blob = asset?.blobId || key;
   await Assets.removeAsync(key);
   if (!await Assets.findOneAsync({ blobId: blob })) {
    await fs.rm(path.join(mediaRoot(), blob + '.original'), { force: true });
    await fs.rm(path.join(mediaRoot(), blob + '.jpg'), { force: true });
   }
  }
 }
}
async function mutate(user, gameId, manage, action, options = {}) {
 return locked(id(gameId), async () => {
  const a = await access(user, gameId, manage, !options.allowArchive), c = await contextFrom(a, true);
  const version = a.game.version, tx = { ...c, game: structuredClone(a.game), staged: [] };
  let result, committed = false;
  try {
   result = await action(tx);
   await trimHistory(tx);
   if (options.fault === 'staging') throw new Error('Injected staging failure');
   // All changed pages/history/media already exist. One document publishes the full
   // revision, and CAS also fences edits prepared before a membership change.
   tx.game.version = version + 1; tx.game.updatedAt = new Date();
   const { _id, ...next } = tx.game;
   if (!await Games.updateAsync({ _id, version }, { $set: next })) fail('conflict', 'The campaign changed while saving. Your draft is safe; reload and retry.');
   committed = true;
   if (options.fault === 'acknowledgement') throw new Error('Injected acknowledgement loss');
   return result;
  } catch (e) { if (committed) return result; throw e; }
  finally { await cleanupStaged(tx.staged); }
 });
}
export async function createGame(user, arg) {
 auth(user); fields(arg, ['name', 'description']); return locked('create-' + user, async () => {
  if (await Games.find({ owner: user }).countAsync() >= 5) fail('quota', 'You can own up to five campaigns.');
  return Games.insertAsync({ name: text(arg.name, 100, true), description: markdown(arg.description || '', 12000), owner: user, members: [{ userId: user, role: 'owner' }], archived: false, version: 1, heads: {}, history: {}, assetIds: [], inviteIds: [], tabletopIds: [], coverAssetId: null, createdAt: new Date(), updatedAt: new Date() });
 });
}
export async function listGames(user) {
 auth(user); return (await Games.find({ 'members.userId': user }, { sort: { updatedAt: -1 } }).fetchAsync()).map(g => ({ _id: g._id, name: g.name, description: g.description.slice(0, 250), archived: g.archived, updatedAt: g.updatedAt, role: userRole(g, user), coverAssetId: g.coverAssetId, version: g.version }));
}
export async function state(user, arg) {
 fields(arg, ['campaignId', 'query', 'type', 'page', 'trash']); if (arg.trash !== undefined) bool(arg.trash);
 const c = await context(user, arg.campaignId, Boolean(arg.trash)); if (arg.trash && !manager(c.role)) fail('permission', 'Only GMs can see trash.');
 const rows = c.rows.filter(e => c.visible(e) && e.deleted === Boolean(arg.trash));
 const query = text(arg.query || '', 120), filter = { _id: { $in: rows.map(e => c.game.heads[e._id]) } };
 if (query) filter.$text = { $search: query };
 if (arg.type) { if (!TYPES.includes(arg.type)) fail('request', 'Invalid section.'); filter['page.type'] = arg.type; }
 const page = arg.page || 0; if (!Number.isInteger(page) || page < 0 || page > 100) fail('request', 'Invalid result page.');
 const matches = await Revisions.find(filter, { sort: query ? { score: { $meta: 'textScore' } } : { 'page.title': 1 }, limit: 25, skip: page * 25 }).fetchAsync();
 const assets = (await assetRows(c)).filter(a => assetVisible(a, c));
 const users = await Meteor.users.find({ _id: { $in: c.game.members.map(m => m.userId) } }, { fields: { username: 1 } }).fetchAsync();
 const tabletops = []; for (const key of c.game.tabletopIds) { const t = await Tabletops.findOneAsync(key); try { tabletopView(t, user); tabletops.push({ _id: key, name: t.name }); } catch { /* Native rights stay independent. */ } }
 const result = { campaign: { _id: c.game._id, name: c.game.name, description: c.game.description, version: c.game.version, archived: c.game.archived, role: c.role, manager: manager(c.role), owner: c.game.owner, coverAssetId: assets.some(a => a._id === c.game.coverAssetId) ? c.game.coverAssetId : null, storageUsed: assets.reduce((sum, a) => sum + a.bytes, 0), storageLimit: MEDIA_LIMIT, members: c.game.members.map(m => ({ ...m, username: users.find(u => u._id === m.userId)?.username || 'Former member' })), tabletops }, entries: rows.map(e => pageMeta(e, c, assets)), results: matches.map(r => ({ ...pageMeta(r.page, c, assets), snippet: r.page.body.replace(/[#*_`|]/g, '').slice(0, 180) })), total: await Revisions.find(filter).countAsync(), assets: assets.map(({ _id, name, category, caption, alt, credits, visibility, width, height, uploader, bytes, standalone }) => ({ _id, name, category, caption, alt, credits, visibility, width, height, uploader, bytes, standalone })), recent: rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10).map(e => ({ _id: e._id, title: e.title, updatedAt: e.updatedAt })) };
 await consistent(c); return result;
}
export async function getEntry(user, arg) {
 fields(arg, ['campaignId', 'entryId']); const c = await context(user, arg.campaignId), e = c.map.get(id(arg.entryId)); if (!c.visible(e)) fail('access', 'Page not found or your access has ended.');
 const page = { ...pageMeta(e, c, await assetRows(c)), body: e.body };
 if (e.nativeCharacterId) { try { const sheet=await Creatures.findOneAsync(e.nativeCharacterId);await assertViewPermission(sheet, user); page.nativeCharacterId = e.nativeCharacterId;page.nativeCharacterName=sheet.name; } catch { page.privateSheet = true; } }
 await consistent(c); return page;
}
async function validatePage(tx, arg, old) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'type', 'title', 'body', 'tags', 'kind', 'parentId', 'relatedIds', 'assetIds', 'playerId', 'nativeCharacterId', 'visibility', 'date', 'confirmPublish']);
 const p = { _id: old?._id || Random.id(), type: old?.type || arg.type, title: text(arg.title, 160, true), body: markdown(arg.body || '', 48000), kind: text(arg.kind || '', 60), tags: strings(arg.tags || [], 20, 40), relatedIds: ids(arg.relatedIds || []), assetIds: ids(arg.assetIds || [], 20), parentId: arg.parentId ? id(arg.parentId) : null, visibility: arg.visibility || 'shared', playerId: arg.playerId || null, date: text(arg.date || '', 40), nativeCharacterId: Object.prototype.hasOwnProperty.call(arg, 'nativeCharacterId') ? arg.nativeCharacterId || null : old?.nativeCharacterId || null, revision: old?.revision || 0, epoch: old?.epoch || Random.id(), deleted: false };
 if (!TYPES.includes(p.type) || !['shared', 'gm'].includes(p.visibility)) fail('request', 'Invalid page type or audience.');
 if (!manager(tx.role) && (p.visibility !== 'shared' || (old && old.parentId !== p.parentId))) fail('permission', 'Only GMs can change page audiences or move existing places.');
 if (p.type === 'pc') { if ((!tx.game.members.some(m => m.userId === p.playerId) && !(old && manager(tx.role) && old.playerId === p.playerId)) || (!manager(tx.role) && p.playerId !== tx.user)) fail('permission', 'Choose your own member profile, or ask a GM to assign it.'); } else p.playerId = null;
 if (p.nativeCharacterId && p.nativeCharacterId !== old?.nativeCharacterId) { if (!['pc', 'npc'].includes(p.type)) fail('request', 'Only characters can link a native sheet.'); await assertViewPermission(await Creatures.findOneAsync(id(p.nativeCharacterId)), tx.user); }
 if (p.parentId && !['location', 'place'].includes(p.type)) fail('hierarchy', 'Only locations and places can have a parent.');
 const map = new Map(tx.map); map.set(p._id, p);
 if (p.parentId) { const parent = map.get(p.parentId); if (!parent || parent.deleted || !['location', 'place'].includes(parent.type) || (!manager(tx.role) && restricted(parent, map) !== 'shared')) fail('hierarchy', 'Choose a visible location in this campaign.'); }
 for (const key of descendants(p._id, [...map.values()])) if (restricted(map.get(key), map, true) === 'missing') fail('hierarchy', 'This move creates a cycle, an orphan or more than eight location levels.');
 if (p.relatedIds.some(key => !tx.visible(tx.map.get(key)) || tx.map.get(key).deleted)) fail('request', 'Related entries must be visible pages in this campaign.');
 const assets = await assetRows(tx); if (p.assetIds.some(key => !assets.some(a => a._id === key && assetVisible(a, tx)))) fail('request', 'Choose visible artwork from this campaign.');
 if (old && !manager(tx.role)) { p.relatedIds = [...new Set([...p.relatedIds, ...old.relatedIds.filter(key => !tx.visible(tx.map.get(key)))])]; p.assetIds = [...new Set([...p.assetIds, ...old.assetIds.filter(key => assets.some(a => a._id === key && !assetVisible(a, tx)))])]; }
 return p;
}
export async function saveEntry(user, arg, options = {}) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'type', 'title', 'body', 'tags', 'kind', 'parentId', 'relatedIds', 'assetIds', 'playerId', 'nativeCharacterId', 'visibility', 'date', 'confirmPublish']);
 return mutate(user, arg.campaignId, false, async tx => {
  const old = arg.entryId ? tx.map.get(id(arg.entryId)) : null;
  if (arg.entryId && (!tx.visible(old) || old.deleted || !canEdit(old, tx))) fail('permission', 'You cannot edit this page.');
  if (old) revision(old, arg.revision); else if (tx.map.size >= 1000) fail('quota', 'This campaign has reached its 1,000-page limit, including trash.');
  const p = await validatePage(tx, arg, old), proposed = new Map(tx.map); proposed.set(p._id, p);
  const expanding = old ? [...descendants(old._id, [...tx.map.values()])].filter(key => restricted(tx.map.get(key), tx.map) === 'gm' && restricted(proposed.get(key), proposed) === 'shared') : [];
  if (expanding.length && arg.confirmPublish !== true) {
   const before = { ...tx, role: 'player', rows: [...tx.map.values()], visible: e => e && restricted(e, tx.map) === 'shared' };
   const after = { ...tx, role: 'player', rows: [...proposed.values()], visible: e => e && restricted(e, proposed) === 'shared' };
   const revealedArtwork = (await assetRows(tx)).filter(a => !assetVisible(a, before) && assetVisible(a, after)).map(a => a.name);
   fail('publish', 'Review the pages and artwork that will become shared, then explicitly publish.', { entries: expanding.map(key => tx.map.get(key).title), artwork: revealedArtwork, artworkKeepsItsAudience: true });
  }
  // New epochs prevent old private history leaking after publishing a branch.
  for (const key of expanding) { if (key === p._id) p.epoch = Random.id(); else await stagePage(tx, { ...tx.map.get(key), epoch: Random.id() }); }
  const saved = await stagePage(tx, p); return { _id: saved._id, revision: saved.revision };
 }, options);
}
export async function history(user, arg) {
 fields(arg, ['campaignId', 'entryId']); const c = await context(user, arg.campaignId), e = c.map.get(id(arg.entryId)); if (!c.visible(e)) fail('access', 'Page not found.');
 const result = (await Revisions.find({ _id: { $in: c.game.history[e._id] || [] }, ...(manager(c.role) ? {} : { epoch: e.epoch, 'page.visibility': 'shared' }) }, { sort: { revision: -1 } }).fetchAsync()).map(r => ({ _id: r._id, revision: r.revision, savedAt: r.createdAt, savedBy: r.page.updatedBy, title: r.page.title, body: r.page.body }));
 await consistent(c); return result;
}
export async function restoreRevision(user, arg) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'historyId', 'confirmPublish']); const c = await context(user, arg.campaignId), e = c.map.get(id(arg.entryId)); if (!c.visible(e) || !canEdit(e, c)) fail('permission', 'You cannot restore this page.');
 const key = id(arg.historyId); if (!(c.game.history[e._id] || []).includes(key)) fail('access', 'Revision not found.'); const h = await Revisions.findOneAsync(key);
 if (!manager(c.role) && (h.epoch !== e.epoch || h.page.visibility !== 'shared')) fail('access', 'Revision not found.');
 if ((h.epoch !== e.epoch || h.page.visibility === 'gm') && restricted(e, c.map) === 'shared' && arg.confirmPublish !== true) fail('publish', 'This historical text had a different audience. Explicitly publish it before restoring to a shared page.');
 return saveEntry(user, { campaignId: c.game._id, entryId: e._id, revision: arg.revision, type: e.type, title: h.page.title, body: h.page.body, tags: h.page.tags, kind: e.kind, parentId: e.parentId, relatedIds: e.relatedIds.filter(k => c.visible(c.map.get(k))), assetIds: pageMeta(e, c, await assetRows(c)).assetIds, playerId: e.playerId, visibility: e.visibility, date: h.page.date });
}
export async function trash(user, arg) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'restore']); bool(arg.restore);
 return mutate(user, arg.campaignId, true, async tx => {
  const e = tx.map.get(id(arg.entryId)); if (!e) fail('access', 'Page not found.'); revision(e, arg.revision);
  if (arg.restore && e.parentId && tx.map.get(e.parentId)?.deleted) fail('hierarchy', 'Restore the parent first.');
  const batch = arg.restore ? e.trashBatch : Random.id(); let count = 0;
  for (const key of descendants(e._id, [...tx.map.values()])) { const row = tx.map.get(key); if (arg.restore ? row.deleted && row.trashBatch === batch : !row.deleted) { await stagePage(tx, { ...row, deleted: !arg.restore, trashBatch: arg.restore ? null : batch }); count++; } }
  return { count };
 });
}
export async function purge(user, arg) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'confirm']); return mutate(user, arg.campaignId, true, async tx => {
  const e = tx.map.get(id(arg.entryId)); if (!e?.deleted || arg.confirm !== e.title) fail('request', 'Confirm the trashed page title before permanent deletion.'); revision(e, arg.revision);
  const branch = descendants(e._id, [...tx.map.values()]);
  for (const key of branch) { tx.map.delete(key); delete tx.game.heads[key]; delete tx.game.history[key]; }
  for (const row of [...tx.map.values()]) if (row.relatedIds.some(k => branch.has(k))) await stagePage(tx, { ...row, relatedIds: row.relatedIds.filter(k => !branch.has(k)) });
  return { count: branch.size };
 });
}
export async function invite(user, arg) {
 fields(arg, ['campaignId', 'username', 'role']); return mutate(user, arg.campaignId, true, async tx => {
  const r = arg.role || 'player'; if (!['player', 'gm'].includes(r) || (r === 'gm' && tx.role !== 'owner')) fail('permission', 'Only the owner can appoint GMs.');
  const target = await Meteor.users.findOneAsync({ username: text(arg.username, 30, true) }); if (!target || userRole(tx.game, target._id)) fail('request', 'Choose an existing account that is not a member.');
  const old = await Invites.find({ _id: { $in: tx.game.inviteIds }, userId: target._id }).fetchAsync(); tx.game.inviteIds = tx.game.inviteIds.filter(key => !old.some(i => i._id === key));
  if (tx.game.inviteIds.length >= 30) fail('quota', 'At most 30 pending invitations are allowed.');
  const key = await Invites.insertAsync({ campaignId: tx.game._id, userId: target._id, role: r, invitedBy: user, expiresAt: new Date(Date.now() + 7 * 86400000) }); tx.game.inviteIds.push(key); return key;
 });
}
export async function invitations(user, arg = {}) {
 auth(user); fields(arg, ['campaignId']); if (arg.campaignId) await access(user, arg.campaignId, true);
 const rows = await Invites.find(arg.campaignId ? { campaignId: arg.campaignId } : { userId: user, expiresAt: { $gt: new Date() } }).fetchAsync(), out = [];
 for (const i of rows) { const g = await Games.findOneAsync({ _id: i.campaignId, inviteIds: i._id }), u = await Meteor.users.findOneAsync(i.userId, { fields: { username: 1 } }); if (g) out.push({ _id: i._id, campaignId: g._id, campaignName: g.name, username: u?.username || 'Former account', role: i.role, expiresAt: i.expiresAt }); } return out;
}
export async function accept(user, arg) {
 fields(arg, ['inviteId']); auth(user); const i = await Invites.findOneAsync({ _id: id(arg.inviteId), userId: user, expiresAt: { $gt: new Date() } }); if (!i) fail('access', 'Invitation expired or was revoked.');
 return locked(i.campaignId, async () => {
  const g = await Games.findOneAsync({ _id: i.campaignId, inviteIds: i._id }); if (!g || g.archived || i.expiresAt <= new Date()) fail('access', 'Invitation expired or was revoked.'); if (g.members.length >= 30) fail('quota', 'This game has reached its 30-member limit.');
  if (!userRole(g, user)) g.members.push({ userId: user, role: i.role });
  if (!await Games.updateAsync({ _id: g._id, version: g.version, inviteIds: i._id }, { $set: { members: g.members, inviteIds: g.inviteIds.filter(k => k !== i._id) }, $inc: { version: 1 } })) fail('conflict', 'The invitation changed. Please retry.');
  return g._id;
 });
}
export async function revokeInvite(user, arg) { fields(arg, ['campaignId', 'inviteId']); return mutate(user, arg.campaignId, true, tx => { tx.game.inviteIds = tx.game.inviteIds.filter(key => key !== id(arg.inviteId)); }, { allowArchive: true }); }
export async function membership(user, arg) {
 fields(arg, ['campaignId', 'userId', 'action', 'role']); return mutate(user, arg.campaignId, false, tx => {
  const target = tx.game.members.find(m => m.userId === id(arg.userId)); if (!target) fail('request', 'Member not found.');
  if (arg.action === 'transfer') { if (tx.role !== 'owner' || target.userId === user) fail('permission', 'Only the owner transfers to another member.'); tx.game.owner = target.userId; tx.game.members = tx.game.members.map(m => ({ ...m, role: m.userId === target.userId ? 'owner' : m.userId === user ? 'gm' : m.role })); return; }
  if (arg.action === 'role') { if (tx.role !== 'owner' || target.role === 'owner' || !['player', 'gm'].includes(arg.role)) fail('permission', 'Only the owner appoints or demotes GMs.'); target.role = arg.role; return; }
  if (arg.action === 'leave') { if (target.userId !== user || tx.role === 'owner') fail('permission', 'Transfer ownership before leaving.'); }
  else if (arg.action !== 'remove' || !manager(tx.role) || target.role === 'owner' || (target.role === 'gm' && tx.role !== 'owner')) fail('permission', 'You cannot remove that member.');
  tx.game.members = tx.game.members.filter(m => m.userId !== target.userId);
 }, { allowArchive: true });
}
export async function configure(user, arg) {
 fields(arg, ['campaignId', 'version', 'name', 'description', 'archived', 'coverAssetId', 'tabletopIds']); return mutate(user, arg.campaignId, true, async tx => {
  if (arg.version !== tx.game.version) fail('conflict', 'The campaign changed. Reload settings before saving.');
  tx.game.name = text(arg.name, 100, true); tx.game.description = markdown(arg.description || '', 12000); tx.game.archived = bool(arg.archived);
  if (arg.tabletopIds !== undefined) { tx.game.tabletopIds = ids(arg.tabletopIds, 10); for (const key of tx.game.tabletopIds) tabletopView(await Tabletops.findOneAsync(key), user); }
  const cover = arg.coverAssetId ? await Assets.findOneAsync({ _id: id(arg.coverAssetId), visibility: 'shared' }) : null; if (arg.coverAssetId && (!cover || !tx.game.assetIds.includes(cover._id) || !cover.standalone)) fail('request', 'Choose shared gallery artwork as the cover.'); tx.game.coverAssetId = cover?._id || null;
 }, { allowArchive: true });
}
export async function upload(user, arg, options = {}) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'name', 'data', 'category', 'caption', 'alt', 'credits', 'visibility']);
 return locked('media', () => mutate(user, arg.campaignId, false, async tx => {
  if (!['portrait', 'map', 'illustration'].includes(arg.category)) fail('request', 'Choose a portrait, map or illustration.');
  const e = arg.entryId ? tx.map.get(id(arg.entryId)) : null; if (arg.entryId && (!tx.visible(e) || e.deleted || !canEdit(e, tx))) fail('permission', 'You cannot attach artwork here.'); if (e) { revision(e, arg.revision); if (e.assetIds.length >= 20) fail('quota', 'A page can have up to 20 attachments.'); }
  const visibility = e && restricted(e, tx.map) === 'gm' ? 'gm' : arg.visibility || 'shared'; if (!['shared', 'gm'].includes(visibility) || (visibility === 'gm' && !manager(tx.role))) fail('permission', 'Only GMs upload private GM artwork.');
  if (typeof arg.data !== 'string' || arg.data.length > 5592410 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(arg.data)) fail('image', 'Choose JPEG, PNG or WebP up to 4 MiB.');
  const input = Buffer.from(arg.data, 'base64'); if (!input.length || input.length > 4 * 1024 ** 2) fail('image', 'Images must be between 1 byte and 4 MiB.');
  let metadata, preview;
  try { const pipeline = sharp(input, { limitInputPixels: 24000000, failOn: 'warning' }); metadata = await pipeline.metadata(); if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.pages > 1 || !metadata.width || !metadata.height || metadata.width > 12000 || metadata.height > 12000) throw new Error('Invalid image'); preview = await pipeline.rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).timeout({ seconds: 10 }).toBuffer(); } catch { fail('image', 'Use a valid, non-animated JPEG, PNG or WebP below 24 megapixels and 12,000 pixels per side.'); }
  if (preview.length > 512 * 1024) fail('image', 'Please resize this image to make its preview smaller.');
  const all = await Assets.find({}, { fields: { bytes: 1, blobId: 1 } }).fetchAsync(), existing = await assetRows(tx), bytes = input.length + preview.length;
  if (existing.length >= 200 || existing.reduce((sum, a) => sum + a.bytes, 0) + bytes > MEDIA_LIMIT || [...new Map(all.map(a => [a.blobId, a])).values()].reduce((sum, a) => sum + a.bytes, 0) + bytes > TOTAL_MEDIA_LIMIT) fail('quota', 'Artwork storage is full (25 MiB per game; 150 MiB for this installation).');
  await fs.mkdir(mediaRoot(), { recursive: true, mode: 0o700 }); const disk = await fs.statfs(mediaRoot()); if (!options.ignoreDiskReserve && disk.bavail * disk.bsize - bytes < 3 * 1024 ** 3) fail('storage', 'Uploads are paused to preserve room for backups and releases.');
  const key = Random.id(); tx.staged.push(['asset', key]);
  await fs.writeFile(path.join(mediaRoot(), key + '.original'), input, { flag: 'wx', mode: 0o600 }); await fs.writeFile(path.join(mediaRoot(), key + '.jpg'), preview, { flag: 'wx', mode: 0o600 });
  await Assets.insertAsync({ _id: key, blobId: key, campaignId: tx.game._id, name: text(arg.name, 160, true), category: arg.category, caption: text(arg.caption || '', 1000), alt: text(arg.alt || '', 1000), credits: text(arg.credits || '', 1000), visibility, standalone: !e, width: metadata.width, height: metadata.height, format: metadata.format, uploader: user, bytes, createdAt: new Date() });
  tx.game.assetIds.push(key); if (e) await stagePage(tx, { ...e, assetIds: [...e.assetIds, key] }); return { _id: key };
 }, options));
}
export async function image(user, arg) {
 fields(arg, ['campaignId', 'assetId', 'original']); if (arg.original !== undefined) bool(arg.original);
 let c = await context(user, arg.campaignId), a = c.game.assetIds.includes(id(arg.assetId)) && await Assets.findOneAsync(arg.assetId); if (!a || !assetVisible(a, c)) fail('access', 'Artwork not found or access has ended.');
 const buffer = await fs.readFile(path.join(mediaRoot(), a.blobId + (arg.original ? '.original' : '.jpg')));
 c = await context(user, arg.campaignId); a = c.game.assetIds.includes(arg.assetId) && await Assets.findOneAsync(arg.assetId); if (!a || !assetVisible(a, c)) fail('access', 'Artwork access has ended.');
 return { data: buffer.toString('base64'), mime: arg.original ? 'image/' + a.format : 'image/jpeg' };
}
export async function updateAsset(user, arg) {
 fields(arg, ['campaignId', 'assetId', 'visibility', 'confirmPublish', 'caption', 'alt', 'credits']); return mutate(user, arg.campaignId, false, async tx => {
  const old = tx.game.assetIds.includes(id(arg.assetId)) && await Assets.findOneAsync(arg.assetId); if (!old || !assetVisible(old, tx)) fail('access', 'Artwork not found.');
  const visibility = arg.visibility || old.visibility; if (!['shared', 'gm'].includes(visibility) || (visibility !== old.visibility && !manager(tx.role))) fail('permission', 'Only GMs change artwork audiences.'); if (old.visibility === 'gm' && visibility === 'shared' && arg.confirmPublish !== true) fail('publish', 'Explicitly publish this artwork to the shared gallery.');
  // Metadata is immutable too: attachments switch with the same campaign CAS.
  const key = Random.id(); tx.staged.push(['asset', key]);
  await Assets.insertAsync({ ...old, _id: key, visibility, standalone: old.standalone || visibility !== old.visibility || arg.confirmPublish === true, caption: text(arg.caption || '', 1000), alt: text(arg.alt || '', 1000), credits: text(arg.credits || '', 1000), createdAt: new Date() });
  tx.game.assetIds = tx.game.assetIds.map(k => k === old._id ? key : k); if (tx.game.coverAssetId === old._id) tx.game.coverAssetId = visibility === 'shared' ? key : null;
  for (const e of [...tx.map.values()]) if (e.assetIds.includes(old._id)) await stagePage(tx, { ...e, assetIds: e.assetIds.map(k => k === old._id ? key : k) });
  return { _id: key };
 });
}
export async function removeAsset(user, arg) {
 fields(arg, ['campaignId', 'assetId']); return mutate(user, arg.campaignId, true, tx => {
  const key = id(arg.assetId); if (!tx.game.assetIds.includes(key)) fail('access', 'Artwork not found.');
  if (tx.game.coverAssetId === key || [...tx.map.values()].some(e => e.assetIds.includes(key))) fail('attached', 'Detach this artwork from pages, trash and the cover first.'); tx.game.assetIds = tx.game.assetIds.filter(k => k !== key);
 });
}
export async function destroy(user, arg) {
 fields(arg, ['campaignId', 'confirm']); return locked(id(arg.campaignId), async () => { const c = await access(user, arg.campaignId, true); if (c.role !== 'owner' || !c.game.archived || arg.confirm !== c.game.name) fail('permission', 'Only the owner permanently deletes an archived campaign after confirming its name.'); if (!await Games.removeAsync({ _id: c.game._id, version: c.game.version })) fail('conflict', 'The campaign changed. Retry deletion.');
  // Root withdrawal revokes every request before physical reclamation. In-flight
  // image responses recheck membership after reading their file.
  await Revisions.removeAsync({campaignId:c.game._id}); await Invites.removeAsync({campaignId:c.game._id});
  await cleanupStaged((await Assets.find({campaignId:c.game._id}).fetchAsync()).map(a=>['asset',a._id]));
 });
}
export async function assertAccountDeletion(user) { if (await Games.find({ owner: user }).countAsync()) fail('ownership', 'Transfer or permanently delete your campaigns before deleting your account, so the group keeps its notebook.'); }
Meteor.users.assertCampaignAccountDeletion = assertAccountDeletion;
export async function maintenance() {
 // Withdrawn revisions and artwork get a one-hour grace period for in-flight reads.
 const games = await Games.find().fetchAsync(), revisionIds = new Set(games.flatMap(g => [...refs(g)])), assets = new Set(games.flatMap(g => g.assetIds)), invites = new Set(games.flatMap(g => g.inviteIds));
 for (const r of await Revisions.find({ createdAt: { $lt: new Date(Date.now() - 3600000) } }, { fields: { _id: 1 } }).fetchAsync()) if (!revisionIds.has(r._id)) await Revisions.removeAsync(r._id);
 for (const a of await Assets.find({ createdAt: { $lt: new Date(Date.now() - 3600000) } }).fetchAsync()) if (!assets.has(a._id)) await cleanupStaged([['asset', a._id]]);
 for (const i of await Invites.find().fetchAsync()) if (!invites.has(i._id) || i.expiresAt < new Date()) await Invites.removeAsync(i._id);
 for (const filename of await fs.readdir(mediaRoot()).catch(() => [])) { if (!/^[a-zA-Z0-9]+\.(original|jpg)$/.test(filename)) continue; const file = path.join(mediaRoot(), filename), stat = await fs.stat(file); if (Date.now() - stat.mtimeMs > 3600000 && !await Assets.findOneAsync({ blobId: filename.split('.')[0] })) await fs.rm(file, { force: true }); }
 // Remove departed non-owner accounts without overwriting concurrent membership edits.
 for (const g of games) { const members = []; for (const m of g.members) if (await Meteor.users.findOneAsync(m.userId, { fields: { _id: 1 } })) members.push(m); if (members.length !== g.members.length && members.some(m => m.role === 'owner')) await Games.updateAsync({ _id: g._id, version: g.version }, { $set: { members }, $inc: { version: 1 } }); }
}
const methods = { create: createGame, list: listGames, state, entry: getEntry, save: saveEntry, history, restoreRevision, trash, purge, invite, accept, invitations, membership, configure, revokeInvite, upload: (u, a) => upload(u, a), image, updateAsset, removeAsset, destroy };
for (const [name, fn] of Object.entries(methods)) Meteor.methods({ ['campaigns.' + name]: async function (arg) { const user=auth(this.userId); if(!await Meteor.users.findOneAsync(user,{fields:{_id:1}})) fail('auth','Your account is no longer available.'); return fn(user, arg); } });
DDPRateLimiter.addRule({ name: name => typeof name === 'string' && name.startsWith('campaigns.'), connectionId: () => true }, 180, 10000);
DDPRateLimiter.addRule({ name: 'campaigns.upload', userId: user => Boolean(user) }, 6, 60000);
Meteor.publish('campaigns.signals', async function () {
 if (!this.userId) return this.ready(); const sub = this;
 const observer = await Games.find({ 'members.userId': this.userId }, { fields: { version: 1, archived: 1, members: 1 } }).observeChangesAsync({ added(key, values) { const {members,...safe}=values; sub.added('campaignSignals', key, {...safe,role:members.find(m=>m.userId===sub.userId)?.role}); }, changed(key, values) { const {members,...safe}=values; sub.changed('campaignSignals', key, {...safe,...(members?{role:members.find(m=>m.userId===sub.userId)?.role}:{})}); }, removed(key) { sub.removed('campaignSignals', key); } });
 // Recipient gets only an invitation-change signal, never a nonmember's campaign data.
 const invitations = await Invites.find({ userId: this.userId }, { fields: { expiresAt: 1 } }).observeChangesAsync({ added(key) { sub.added('campaignInviteSignals', key, {}); }, changed(key) { sub.changed('campaignInviteSignals', key, { changed: Random.id() }); }, removed(key) { sub.removed('campaignInviteSignals', key); } });
 sub.onStop(() => { observer.stop(); invitations.stop(); }); sub.ready();
});
Meteor.startup(async () => {
 await Revisions.createIndexAsync({ 'page.title': 'text', 'page.tags': 'text', 'page.body': 'text' }, { weights: { 'page.title': 15, 'page.tags': 4, 'page.body': 1 }, name: 'campaign_text' });
 await Revisions.createIndexAsync({ campaignId: 1 }); await Assets.createIndexAsync({ campaignId: 1 });
 Meteor.setInterval(() => { maintenance().catch(e => console.error('Campaign maintenance failed', e.message)); }, 60000);
});
