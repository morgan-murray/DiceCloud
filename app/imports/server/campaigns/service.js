import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import Creatures from '/imports/api/creature/creatures/Creatures';
import { assertViewPermission } from '/imports/api/sharing/sharingPermissions';

// Only the version signal is published. Content and images always pass current permissions.
export const Games = new Mongo.Collection('campaigns');
export const Entries = new Mongo.Collection('campaignEntries');
export const Revisions = new Mongo.Collection('campaignRevisions');
export const Invites = new Mongo.Collection('campaignInvites');
export const Assets = new Mongo.Collection('campaignAssets');
const Locks = new Mongo.Collection('campaignLocks');
const TYPES = ['pc', 'npc', 'location', 'place', 'journal'];
const LIMIT = 25 * 1024 ** 2, GLOBAL_LIMIT = 150 * 1024 ** 2;
const mediaRoot = () => path.join(process.env.DICECLOUD_STORAGE_PATH || '/tmp/dicecloud-campaign-test', 'campaigns');
function fail(code, message, details) { throw new Meteor.Error('campaign-' + code, message, details && JSON.stringify(details)); }
function auth(user) { if (!user) fail('auth', 'Sign in to use Campaigns.'); return user; }
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value)) fail('request', 'Invalid identifier.'); return value; }
function fields(arg, allowed) { if (!arg || typeof arg !== 'object' || Array.isArray(arg) || Object.keys(arg).some(k => !allowed.includes(k))) fail('request', 'Invalid campaign request.'); }
function text(value, max, required = false) { if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail('request', 'Text is missing or too long.'); return value.trim(); }
function ids(value, max = 30) { if (!Array.isArray(value) || value.length > max) fail('request', 'Too many linked entries.'); return [...new Set(value.map(id))]; }
function role(game, user) { return game.members.find(m => m.userId === user)?.role; }
const manages = r => r === 'owner' || r === 'gm';
export async function access(user, gameId, manager = false, writable = false) {
 auth(user); const game = await Games.findOneAsync(id(gameId)); const r = game && role(game, user);
 if (!r) fail('access', 'Campaign not found or access has ended.');
 if (manager && !manages(r)) fail('permission', 'An owner or GM must do this.');
 if (writable && game.archived) fail('archived', 'Restore this archived campaign before editing.');
 return { game, role: r };
}
async function locked(key, fn) {
 const token = Random.id(); await Locks.removeAsync({ _id: key, expiresAt: { $lt: new Date() } });
 try { await Locks.insertAsync({ _id: key, token, expiresAt: new Date(Date.now() + 120000) }); } catch { fail('busy', 'Another save is finishing. Your draft is safe; try again.'); }
 try { return await fn(); } finally { await Locks.removeAsync({ _id: key, token }); }
}
async function mutate(user, gameId, manager, fn, allowArchive = false) {
 return locked(id(gameId), async () => { const a = await access(user, gameId, manager, !allowArchive); const result = await fn(a.game, a.role); await Games.updateAsync(gameId, { $inc: { version: 1 }, $set: { updatedAt: new Date() } }); return result; });
}
async function context(user, gameId, includeTrash = false) {
 const a = await access(user, gameId); const rows = await Entries.find({ campaignId: gameId }).fetchAsync(); const map = new Map(rows.map(e => [e._id, e]));
 const visible = e => {
  if (!e || (e.deleted && !includeTrash)) return false;
  const seen = new Set(); let p = e;
  while (p) { if (seen.has(p._id) || seen.size > 8 || (p.deleted && !includeTrash) || (p.visibility === 'gm' && !manages(a.role))) return false; seen.add(p._id); p = p.parentId ? map.get(p.parentId) : null; if (p === undefined) return false; }
  return true;
 };
 return { ...a, rows, map, visible };
}
function effectiveGM(e, map) { let p = e; const seen = new Set(); while (p) { if (p.visibility === 'gm' || seen.has(p._id)) return true; seen.add(p._id); p = p.parentId ? map.get(p.parentId) : null; } return false; }
function descendants(entryId, rows) { const found = new Set([entryId]); let changed = true; while (changed) { changed = false; for (const e of rows) if (e.parentId && found.has(e.parentId) && !found.has(e._id)) { found.add(e._id); changed = true; } } return found; }
function canEdit(e, r, user) { return manages(r) || (e.visibility === 'shared' && (e.type !== 'pc' || e.playerId === user)); }
function checkRevision(e, revision) { if (!Number.isInteger(revision) || revision !== e.revision) fail('conflict', 'Someone saved a newer revision. Your draft has been kept. Compare it with the current page before saving again.', { revision: e.revision }); }
async function snapshot(e) {
 await Revisions.insertAsync({ _id: Random.id(), campaignId: e.campaignId, entryId: e._id, revision: e.revision, epoch: e.epoch, savedAt: e.updatedAt, savedBy: e.updatedBy, page: e });
 const old = await Revisions.find({ entryId: e._id }, { sort: { revision: -1 }, skip: 50, fields: { _id: 1 } }).fetchAsync();
 if (old.length) await Revisions.removeAsync({ _id: { $in: old.map(r => r._id) } });
}
function assetVisible(asset, c) {
 if (manages(c.role)) return true;
 if (asset.visibility !== 'shared') return false;
 return asset.standalone || c.rows.some(e => !e.deleted && (e.assetIds || []).includes(asset._id) && c.visible(e));
}
async function publicPage(e, c, full = false) {
 const assets = await Assets.find({ campaignId: c.game._id, _id: { $in: e.assetIds || [] } }).fetchAsync();
 const page = { _id: e._id, type: e.type, title: e.title, kind: e.kind, tags: e.tags, parentId: e.parentId, visibility: e.visibility, restricted: effectiveGM(e, c.map), revision: e.revision, updatedAt: e.updatedAt, updatedBy: e.updatedBy, playerId: e.playerId, deleted: e.deleted, canEdit: !c.game.archived && canEdit(e, c.role, c.user), date: e.date, assetIds: assets.filter(a => assetVisible(a, c)).map(a => a._id), relatedIds: (e.relatedIds || []).filter(key => c.visible(c.map.get(key))) };
 if (full) {
  page.body = e.body;
  if (e.nativeCharacterId) { try { await assertViewPermission(await Creatures.findOneAsync(e.nativeCharacterId), c.user); page.nativeCharacterId = e.nativeCharacterId; } catch { page.privateSheet = true; } }
 }
 return page;
}
export async function createGame(user, arg) {
 auth(user); fields(arg, ['name', 'description']);
 return locked('create-' + user, async () => {
  if (await Games.find({ owner: user }).countAsync() >= 5) fail('quota', 'You can own up to five campaigns.');
  const _id = Random.id(); await Games.insertAsync({ _id, name: text(arg.name, 100, true), description: text(arg.description || '', 12000), owner: user, members: [{ userId: user, role: 'owner' }], archived: false, version: 1, createdAt: new Date(), updatedAt: new Date() }); return _id;
 });
}
export async function listGames(user) {
 auth(user); return (await Games.find({ 'members.userId': user }, { sort: { updatedAt: -1 } }).fetchAsync()).map(g => ({ _id: g._id, name: g.name, description: g.description.slice(0, 250), archived: g.archived, updatedAt: g.updatedAt, role: role(g, user), coverAssetId: g.coverAssetId }));
}
export async function state(user, arg) {
 fields(arg, ['campaignId', 'query', 'type', 'page', 'trash']); const c = await context(user, arg.campaignId, Boolean(arg.trash)); c.user = user;
 if (arg.trash && !manages(c.role)) fail('permission', 'Only GMs can see the trash.');
 const visible = c.rows.filter(e => c.visible(e) && Boolean(e.deleted) === Boolean(arg.trash));
 const query = text(arg.query || '', 120), filter = { _id: { $in: visible.map(e => e._id) } }; if (query) filter.$text = { $search: query }; if (arg.type) { if (!TYPES.includes(arg.type)) fail('request', 'Invalid section.'); filter.type = arg.type; }
 const page = arg.page || 0; if (!Number.isInteger(page) || page < 0 || page > 100) fail('request', 'Invalid page.');
 const matches = await Entries.find(filter, { sort: query ? { score: { $meta: 'textScore' } } : { title: 1 }, fields: query ? { score: { $meta: 'textScore' } } : {}, limit: 25, skip: page * 25 }).fetchAsync();
 const users = await Meteor.users.find({ _id: { $in: c.game.members.map(m => m.userId) } }, { fields: { username: 1 } }).fetchAsync();
 const assets = (await Assets.find({ campaignId: c.game._id }, { sort: { createdAt: -1 } }).fetchAsync()).filter(a => assetVisible(a, c));
 return { campaign: { _id: c.game._id, name: c.game.name, description: c.game.description, archived: c.game.archived, version: c.game.version, coverAssetId: assets.some(a => a._id === c.game.coverAssetId) ? c.game.coverAssetId : null, role: c.role, manager: manages(c.role), owner: c.game.owner, members: c.game.members.map(m => ({ ...m, username: users.find(u => u._id === m.userId)?.username || 'Former member' })), storageUsed: assets.reduce((sum, a) => sum + a.bytes, 0), storageLimit: LIMIT }, entries: await Promise.all(visible.map(e => publicPage(e, c))), results: await Promise.all(matches.map(async e => ({ ...(await publicPage(e, c)), snippet: e.body.replace(/[#*_`|]/g, '').slice(0, 180) }))), total: await Entries.find(filter).countAsync(), assets: assets.map(({ _id, name, category, caption, alt, credits, visibility, width, height, uploader, bytes }) => ({ _id, name, category, caption, alt, credits, visibility, width, height, uploader, bytes })), recent: visible.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10).map(e => ({ _id: e._id, title: e.title, updatedAt: e.updatedAt })) };
}
export async function getEntry(user, arg) {
 fields(arg, ['campaignId', 'entryId']); const c = await context(user, arg.campaignId); c.user = user; const e = c.map.get(id(arg.entryId)); if (!c.visible(e)) fail('access', 'Page not found or access has ended.'); return publicPage(e, c, true);
}
async function validatePage(user, game, r, arg, current, rows) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'type', 'title', 'body', 'tags', 'kind', 'parentId', 'relatedIds', 'assetIds', 'playerId', 'nativeCharacterId', 'visibility', 'date', 'confirmPublish']);
 const map = new Map(rows.map(e => [e._id, e]));
 const next = { type: current?.type || arg.type, title: text(arg.title, 160, true), body: text(arg.body || '', 48000), kind: text(arg.kind || '', 60), tags: (arg.tags || []).map(t => text(t, 40)), relatedIds: ids(arg.relatedIds || []), assetIds: ids(arg.assetIds || [], 20), parentId: arg.parentId ? id(arg.parentId) : null, visibility: arg.visibility || 'shared', playerId: arg.playerId || null, nativeCharacterId: arg.nativeCharacterId || null, date: text(arg.date || '', 40) };
 if (!TYPES.includes(next.type) || !['shared', 'gm'].includes(next.visibility) || next.tags.length > 20) fail('request', 'Invalid page type, audience or tags.');
 if (!manages(r) && next.visibility !== 'shared') fail('permission', 'Only GMs can create private GM pages.');
 if (current && !manages(r) && current.parentId !== next.parentId) fail('permission', 'Ask a GM to move this page.');
 if (next.type === 'pc') { if (!game.members.some(m => m.userId === next.playerId)) fail('request', 'Choose a campaign member for this character profile.'); if (!manages(r) && next.playerId !== user) fail('permission', 'Players maintain their own character profiles.'); } else next.playerId = null;
 if (current && !Object.prototype.hasOwnProperty.call(arg, 'nativeCharacterId')) next.nativeCharacterId = current.nativeCharacterId;
 if (next.nativeCharacterId) { id(next.nativeCharacterId); if (!['pc', 'npc'].includes(next.type)) fail('request', 'Only character profiles can link a native sheet.'); if (next.nativeCharacterId !== current?.nativeCharacterId) await assertViewPermission(await Creatures.findOneAsync(next.nativeCharacterId), user); } else next.nativeCharacterId = null;
 if (next.parentId) {
  if (!['location', 'place'].includes(next.type)) fail('request', 'Only locations and places can be nested.');
  let p = map.get(next.parentId); const seen = new Set(current ? [current._id] : []);
  while (p) { if (p.deleted || !['location', 'place'].includes(p.type) || seen.has(p._id) || seen.size >= 8 || (!manages(r) && effectiveGM(p, map))) fail('hierarchy', 'Choose an accessible location without a cycle (maximum depth eight).'); seen.add(p._id); if (!p.parentId) break; p = map.get(p.parentId); }
  if (!p) fail('hierarchy', 'Parent location not found.');
  if (current) for (const key of descendants(current._id, rows)) { let depth = seen.size, child = map.get(key); while (child && child._id !== current._id) { depth++; child = map.get(child.parentId); } if (depth >= 8) fail('hierarchy', 'This move would exceed eight location levels.'); }
 }
 const c = { game, role: r, user, rows, map, visible: e => e && !e.deleted && (manages(r) || !effectiveGM(e, map)) };
 if (next.relatedIds.some(key => !c.visible(map.get(key)))) fail('request', 'Related pages must be visible pages in this campaign.');
 const assets = await Assets.find({ campaignId: game._id, _id: { $in: next.assetIds } }).fetchAsync(); if (assets.length !== next.assetIds.length || assets.some(a => !assetVisible(a, c))) fail('request', 'Artwork must belong to this campaign and be visible to you.');
 return next;
}
export async function saveEntry(user, arg) {
 return mutate(user, arg.campaignId, false, async (game, r) => {
  const c = await context(user, game._id); const current = arg.entryId ? c.map.get(id(arg.entryId)) : null;
  if (arg.entryId && (!c.visible(current) || !canEdit(current, r, user))) fail('permission', 'You cannot edit this page.');
  if (current) checkRevision(current, arg.revision); else if (c.rows.length >= 1000) fail('quota', 'This campaign has reached its 1,000-page limit, including trash.');
  const next = await validatePage(user, game, r, arg, current, c.rows);
  // A player's text edit must not silently delete GM-only relationships or artwork.
  if (current && !manages(r)) {
   next.relatedIds = [...new Set([...next.relatedIds, ...current.relatedIds.filter(key => !c.visible(c.map.get(key)))])];
   const hiddenAssets = await Assets.find({ campaignId: game._id, _id: { $in: current.assetIds } }).fetchAsync();
   next.assetIds = [...new Set([...next.assetIds, ...hiddenAssets.filter(a => !assetVisible(a, c)).map(a => a._id)])];
  }
  const _id = current?._id || Random.id(), beforeGM = current && effectiveGM(current, c.map), proposed = { ...current, ...next, _id, campaignId: game._id }; const nextMap = new Map(c.map); nextMap.set(_id, proposed);
  const expanding = current ? [...descendants(_id, c.rows)].filter(key => effectiveGM(c.map.get(key), c.map) && !effectiveGM(nextMap.get(key), nextMap)) : [];
  if (expanding.length && arg.confirmPublish !== true) fail('publish', 'This exposes pages to players. Review and explicitly publish.', { entries: expanding.map(key => c.map.get(key).title), assetsRemainPrivate: true });
  // Invalidate historical audiences before exposing a branch. Explicit GM children stay private.
  for (const key of expanding.filter(key => key !== _id)) await Entries.updateAsync(key, { $set: { epoch: Random.id() } });
  const e = { ...proposed, epoch: !current || (beforeGM && !effectiveGM(proposed, nextMap)) ? Random.id() : current.epoch, revision: (current?.revision || 0) + 1, deleted: false, createdAt: current?.createdAt || new Date(), updatedAt: new Date(), updatedBy: user };
  if (current) await Entries.updateAsync(_id, { $set: e }); else await Entries.insertAsync(e);
  await snapshot(e); return { _id, revision: e.revision };
 });
}
export async function history(user, arg) {
 fields(arg, ['campaignId', 'entryId']); const c = await context(user, arg.campaignId); const e = c.map.get(id(arg.entryId)); if (!c.visible(e)) fail('access', 'Page not found.');
 return (await Revisions.find({ entryId: e._id, ...(manages(c.role) ? {} : { epoch: e.epoch, 'page.visibility': 'shared' }) }, { sort: { revision: -1 }, limit: 50 }).fetchAsync()).map(r => ({ _id: r._id, revision: r.revision, savedAt: r.savedAt, savedBy: r.savedBy, title: r.page.title, body: r.page.body }));
}
export async function restoreRevision(user, arg) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'historyId', 'confirmPublish']); const c = await context(user, arg.campaignId); const e = c.map.get(id(arg.entryId)); if (!c.visible(e) || !canEdit(e, c.role, user)) fail('permission', 'You cannot restore this page.');
 const h = await Revisions.findOneAsync({ _id: id(arg.historyId), entryId: e._id, ...(manages(c.role) ? {} : { epoch: e.epoch, 'page.visibility': 'shared' }) }); if (!h) fail('access', 'Revision not found.');
 if ((h.epoch !== e.epoch || h.page.visibility === 'gm') && !effectiveGM(e, c.map) && arg.confirmPublish !== true) fail('publish', 'This historical text had a different audience. Explicitly confirm publication before restoring it to a shared page.');
 // Restore text, not old sharing, sheet links or hierarchy. That avoids reviving spoilers or deleted relationships.
 return saveEntry(user, { campaignId: arg.campaignId, entryId: e._id, revision: arg.revision, type: e.type, title: h.page.title, body: h.page.body, tags: h.page.tags, kind: e.kind, parentId: e.parentId, relatedIds: e.relatedIds.filter(k => c.visible(c.map.get(k))), assetIds: e.assetIds, playerId: e.playerId, visibility: e.visibility, date: h.page.date });
}
export async function trash(user, arg) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'restore']); return mutate(user, arg.campaignId, true, async game => {
  const c = await context(user, game._id, true), e = c.map.get(id(arg.entryId)); if (!e) fail('access', 'Page not found.'); checkRevision(e, arg.revision);
  if (arg.restore && e.parentId && c.map.get(e.parentId)?.deleted) fail('hierarchy', 'Restore the parent location first.');
  const keys = [...descendants(e._id, c.rows)]; for (const key of keys) { const row = c.map.get(key); const n = { ...row, deleted: !arg.restore, revision: row.revision + 1, updatedAt: new Date(), updatedBy: user }; await Entries.updateAsync(key, { $set: n }); await snapshot(n); }
  return { count: keys.length };
 });
}
export async function invite(user, arg) {
 fields(arg, ['campaignId', 'username', 'role']); return mutate(user, arg.campaignId, true, async (game, r) => {
  const username = text(arg.username, 30, true), invitedRole = arg.role || 'player'; if (!['player', 'gm'].includes(invitedRole) || (invitedRole === 'gm' && r !== 'owner')) fail('permission', 'Only the owner can appoint GMs.');
  const target = await Meteor.users.findOneAsync({ username }); if (!target || game.members.some(m => m.userId === target._id)) fail('request', 'Choose an existing account that is not already a member.');
  await Invites.removeAsync({ campaignId: game._id, userId: target._id }); return Invites.insertAsync({ campaignId: game._id, userId: target._id, role: invitedRole, invitedBy: user, expiresAt: new Date(Date.now() + 7 * 86400000) });
 });
}
export async function accept(user, arg) {
 fields(arg, ['inviteId']); auth(user); const i = await Invites.findOneAsync({ _id: id(arg.inviteId), userId: user }); if (!i) fail('access', 'Invitation not found.');
 return locked(i.campaignId, async () => { const fresh = await Invites.findOneAsync({ _id: i._id, userId: user, expiresAt: { $gt: new Date() } }), game = await Games.findOneAsync(i.campaignId); if (!fresh || !game || game.archived) fail('access', 'This invitation expired or was revoked.'); if (game.members.length >= 30) fail('quota', 'This campaign has reached its 30-member limit.');
  if (!role(game, user)) await Games.updateAsync(game._id, { $push: { members: { userId: user, role: fresh.role } }, $inc: { version: 1 } }); await Invites.removeAsync(i._id); return game._id;
 });
}
export async function invitations(user, arg = {}) {
 auth(user); fields(arg, ['campaignId']); if (arg.campaignId) await access(user, arg.campaignId, true);
 const rows = await Invites.find(arg.campaignId ? { campaignId: arg.campaignId } : { userId: user, expiresAt: { $gt: new Date() } }).fetchAsync(); const out = [];
 for (const i of rows) { const g = await Games.findOneAsync(i.campaignId), u = await Meteor.users.findOneAsync(i.userId, { fields: { username: 1 } }); if (g) out.push({ _id: i._id, campaignId: g._id, campaignName: g.name, username: u?.username || 'Former account', role: i.role, expiresAt: i.expiresAt }); } return out;
}
export async function membership(user, arg) {
 fields(arg, ['campaignId', 'userId', 'action', 'role']); return mutate(user, arg.campaignId, false, async (game, r) => {
  const target = game.members.find(m => m.userId === id(arg.userId)); if (!target) fail('request', 'Member not found.');
  if (arg.action === 'leave') { if (target.userId !== user || r === 'owner') fail('permission', 'Transfer ownership before leaving your campaign.'); }
  else if (arg.action === 'transfer') { if (r !== 'owner' || target.userId === user) fail('permission', 'Only the owner can transfer to another member.'); await Games.updateAsync(game._id, { $set: { owner: target.userId, members: game.members.map(m => ({ ...m, role: m.userId === target.userId ? 'owner' : m.userId === user ? 'gm' : m.role })) } }); return; }
  else if (arg.action === 'role') { if (r !== 'owner' || target.role === 'owner' || !['player', 'gm'].includes(arg.role)) fail('permission', 'Only the owner can appoint or demote GMs.'); await Games.updateAsync(game._id, { $set: { members: game.members.map(m => m.userId === target.userId ? { ...m, role: arg.role } : m) } }); return; }
  else if (arg.action !== 'remove' || !manages(r) || target.role === 'owner' || (target.role === 'gm' && r !== 'owner')) fail('permission', 'You cannot remove that member.');
  await Games.updateAsync(game._id, { $pull: { members: { userId: target.userId } } }); await Invites.removeAsync({ campaignId: game._id, userId: target.userId });
 }, true);
}
export async function configure(user, arg) {
 fields(arg, ['campaignId', 'version', 'name', 'description', 'archived', 'coverAssetId']); return mutate(user, arg.campaignId, true, async game => {
  if (arg.version !== game.version) fail('conflict', 'The campaign changed. Reload its settings before saving.');
  const cover = arg.coverAssetId ? await Assets.findOneAsync({ _id: id(arg.coverAssetId), campaignId: game._id, visibility: 'shared' }) : null; if (arg.coverAssetId && !cover) fail('request', 'Choose shared artwork from this campaign.');
  if (cover) await Assets.updateAsync(cover._id, { $set: { standalone: true } });
  await Games.updateAsync(game._id, { $set: { name: text(arg.name, 100, true), description: text(arg.description || '', 12000), archived: Boolean(arg.archived), coverAssetId: cover?._id || null } });
 }, true);
}
export async function revokeInvite(user, arg) { fields(arg, ['campaignId', 'inviteId']); return mutate(user, arg.campaignId, true, () => Invites.removeAsync({ _id: id(arg.inviteId), campaignId: arg.campaignId }), true); }
export async function upload(user, arg, options = {}) {
 fields(arg, ['campaignId', 'entryId', 'revision', 'name', 'data', 'category', 'caption', 'alt', 'credits', 'visibility']);
 return mutate(user, arg.campaignId, false, async (game, r) => locked('media', async () => {
  if (!['portrait', 'map', 'illustration'].includes(arg.category)) fail('request', 'Choose a portrait, map or illustration.');
  const c = await context(user, game._id); c.user = user; const e = arg.entryId ? c.map.get(id(arg.entryId)) : null;
  if (arg.entryId && (!c.visible(e) || !canEdit(e, r, user))) fail('permission', 'You cannot attach artwork to this page.'); if (e) { checkRevision(e, arg.revision); if (e.assetIds.length >= 20) fail('quota', 'A page can have up to 20 artwork attachments.'); }
  const visibility = e && effectiveGM(e, c.map) ? 'gm' : arg.visibility || 'shared'; if (!['shared', 'gm'].includes(visibility) || (visibility === 'gm' && !manages(r))) fail('permission', 'Only GMs upload private GM artwork.');
  if (typeof arg.data !== 'string' || arg.data.length > 5592410 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(arg.data)) fail('image', 'Choose a JPEG, PNG or WebP up to 4 MiB.');
  const input = Buffer.from(arg.data, 'base64'); if (!input.length || input.length > 4 * 1024 ** 2) fail('image', 'Images must be between 1 byte and 4 MiB.');
  let metadata, thumbnail;
  try { const image = sharp(input, { limitInputPixels: 24000000, failOn: 'warning' }); metadata = await image.metadata(); if (!['jpeg', 'png', 'webp'].includes(metadata.format) || metadata.pages > 1 || metadata.width > 12000 || metadata.height > 12000) throw new Error('Unsupported image'); thumbnail = await image.rotate().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).timeout({ seconds: 10 }).toBuffer(); } catch { fail('image', 'The image could not be decoded. Use a non-animated JPEG, PNG or WebP below 24 megapixels and 12,000 pixels per side.'); }
  if (thumbnail.length > 512 * 1024) fail('image', 'The preview is too large. Please resize this image.');
  const all = await Assets.find({}, { fields: { bytes: 1, campaignId: 1 } }).fetchAsync(), bytes = input.length + thumbnail.length;
  if (all.filter(a => a.campaignId === game._id).length >= 200 || all.filter(a => a.campaignId === game._id).reduce((s, a) => s + a.bytes, 0) + bytes > LIMIT || all.reduce((s, a) => s + a.bytes, 0) + bytes > GLOBAL_LIMIT) fail('quota', 'Campaign artwork storage is full (25 MiB per campaign; 150 MiB for this installation).');
  await fs.mkdir(mediaRoot(), { recursive: true, mode: 0o700 }); const disk = await fs.statfs(mediaRoot()); if (!options.ignoreDiskReserve && disk.bavail * disk.bsize - bytes < 3 * 1024 ** 3) fail('storage', 'Uploads are paused to preserve space for backups and releases.');
  const _id = Random.id(), original = path.join(mediaRoot(), _id + '.original'), preview = path.join(mediaRoot(), _id + '.jpg');
  const asset = { _id, campaignId: game._id, name: text(arg.name, 160, true), category: arg.category, caption: text(arg.caption || '', 1000), alt: text(arg.alt || '', 1000), credits: text(arg.credits || '', 1000), visibility, standalone: !e, width: metadata.width, height: metadata.height, format: metadata.format, uploader: user, bytes, createdAt: new Date() };
  try {
   await fs.writeFile(original, input, { flag: 'wx', mode: 0o600 }); await fs.writeFile(preview, thumbnail, { flag: 'wx', mode: 0o600 }); await Assets.insertAsync(asset);
   if (e) { const next = { ...e, assetIds: [...e.assetIds, _id], revision: e.revision + 1, updatedAt: new Date(), updatedBy: user }; await Entries.updateAsync(e._id, { $set: next }); await snapshot(next); }
  } catch (error) { if (!await Assets.findOneAsync(_id)) { await fs.rm(original, { force: true }); await fs.rm(preview, { force: true }); } throw error; }
  return { _id };
 }));
}
export async function image(user, arg) {
 fields(arg, ['campaignId', 'assetId', 'original']); let c = await context(user, arg.campaignId), a = await Assets.findOneAsync({ _id: id(arg.assetId), campaignId: c.game._id }); if (!a || !assetVisible(a, c)) fail('access', 'Artwork not found or access has ended.');
 const bytes = await fs.readFile(path.join(mediaRoot(), a._id + (arg.original ? '.original' : '.jpg')));
 c = await context(user, arg.campaignId); a = await Assets.findOneAsync({ _id: a._id, campaignId: c.game._id }); if (!a || !assetVisible(a, c)) fail('access', 'Artwork access has ended.');
 return { data: bytes.toString('base64'), mime: arg.original ? 'image/' + a.format : 'image/jpeg' };
}
export async function updateAsset(user, arg) {
 fields(arg, ['campaignId', 'assetId', 'visibility', 'confirmPublish', 'caption', 'alt', 'credits']); return mutate(user, arg.campaignId, false, async (game, r) => {
  const c = await context(user, game._id), a = await Assets.findOneAsync({ _id: id(arg.assetId), campaignId: game._id }); if (!a || !assetVisible(a, c)) fail('access', 'Artwork not found.');
  const visibility = arg.visibility || a.visibility; if (!['shared', 'gm'].includes(visibility) || (visibility !== a.visibility && !manages(r))) fail('permission', 'Only GMs change artwork audiences.'); if (a.visibility === 'gm' && visibility === 'shared' && arg.confirmPublish !== true) fail('publish', 'Explicitly publish this artwork to the shared gallery.');
  await Assets.updateAsync(a._id, { $set: { visibility, standalone: a.standalone || visibility !== a.visibility, caption: text(arg.caption || '', 1000), alt: text(arg.alt || '', 1000), credits: text(arg.credits || '', 1000) } });
 });
}
export async function removeAsset(user, arg) {
 fields(arg, ['campaignId', 'assetId']); return mutate(user, arg.campaignId, true, async game => {
  const a = await Assets.findOneAsync({ _id: id(arg.assetId), campaignId: game._id }); if (!a) fail('access', 'Artwork not found.');
  if (game.coverAssetId === a._id || await Entries.find({ campaignId: game._id, assetIds: a._id }).countAsync()) fail('attached', 'Detach this artwork from pages (including trash) and the campaign cover first.');
  await Assets.removeAsync(a._id); await fs.rm(path.join(mediaRoot(), a._id + '.original'), { force: true }); await fs.rm(path.join(mediaRoot(), a._id + '.jpg'), { force: true });
 });
}
export async function destroy(user, arg) {
 fields(arg, ['campaignId', 'confirm']); return mutate(user, arg.campaignId, true, async (game, r) => {
  if (r !== 'owner' || !game.archived || arg.confirm !== game.name) fail('permission', 'Only the owner can permanently delete an archived campaign after confirming its name.');
  for (const a of await Assets.find({ campaignId: game._id }).fetchAsync()) { await fs.rm(path.join(mediaRoot(), a._id + '.original'), { force: true }); await fs.rm(path.join(mediaRoot(), a._id + '.jpg'), { force: true }); }
  for (const collection of [Entries, Revisions, Assets, Invites]) await collection.removeAsync({ campaignId: game._id }); await Games.removeAsync(game._id);
 }, true);
}
export async function assertAccountDeletion(user) { if (await Games.find({ owner: user }).countAsync()) fail('ownership', 'Transfer ownership or permanently delete your campaigns before deleting your account. Shared notebooks must stay with their group.'); }
Meteor.users.assertCampaignAccountDeletion = assertAccountDeletion;
const methods = { create: createGame, list: listGames, state, entry: getEntry, save: saveEntry, history, restoreRevision, trash, invite, accept, invitations, membership, configure, revokeInvite, upload, image, updateAsset, removeAsset, destroy };
for (const [name, fn] of Object.entries(methods)) Meteor.methods({ ['campaigns.' + name]: async function (arg) { return fn(auth(this.userId), arg); } });
DDPRateLimiter.addRule({ name: n => typeof n === 'string' && n.startsWith('campaigns.'), connectionId: () => true }, 180, 10000);
DDPRateLimiter.addRule({ name: 'campaigns.upload', userId: u => Boolean(u) }, 6, 60000);
Meteor.publish('campaigns.signals', async function () {
 if (!this.userId) return this.ready(); const sub = this;
 const observer = await Games.find({ 'members.userId': this.userId }, { fields: { version: 1, archived: 1 } }).observeChangesAsync({ added(key, values) { sub.added('campaignSignals', key, values); }, changed(key, values) { sub.changed('campaignSignals', key, values); }, removed(key) { sub.removed('campaignSignals', key); } }); sub.onStop(() => observer.stop()); sub.ready();
});
Meteor.startup(async () => {
 await Entries.createIndexAsync({ title: 'text', tags: 'text', body: 'text' }, { weights: { title: 15, tags: 4, body: 1 }, name: 'campaign_text' });
 await Entries.createIndexAsync({ campaignId: 1 }); await Revisions.createIndexAsync({ entryId: 1, revision: 1 }, { unique: true }); await Assets.createIndexAsync({ campaignId: 1 });
 // Failed uploads never publish metadata. Reclaim only old files with no corresponding asset.
 Meteor.setInterval(async () => {
  try {
   await Invites.removeAsync({ expiresAt: { $lt: new Date() } });
   for (const g of await Games.find().fetchAsync()) { const active = []; for (const m of g.members) if (await Meteor.users.findOneAsync(m.userId, { fields: { _id: 1 } })) active.push(m); if (active.length !== g.members.length && active.some(m => m.role === 'owner')) await locked(g._id, async () => { const current = await Games.findOneAsync(g._id); if (current?.version === g.version) await Games.updateAsync(g._id, { $set: { members: active }, $inc: { version: 1 } }); }); }
   for (const file of await fs.readdir(mediaRoot()).catch(() => [])) { if (!/^[a-zA-Z0-9]+\.(original|jpg)$/.test(file)) continue; const filename = path.join(mediaRoot(), file), stat = await fs.stat(filename); if (Date.now() - stat.mtimeMs > 3600000 && !await Assets.findOneAsync(file.split('.')[0])) await fs.rm(filename, { force: true }); }
  } catch (e) { console.error('Campaign maintenance failed', e.message); }
 }, 60000);
});
