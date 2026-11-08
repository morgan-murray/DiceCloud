import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import Libraries from '/imports/api/library/Libraries';
import LibraryCollections from '/imports/api/library/LibraryCollections';
import LibraryNodes from '/imports/api/library/LibraryNodes';
import getUserLibraryIds from '/imports/api/library/getUserLibraryIds';
import { rebuildNestedSets } from '/imports/api/parenting/parentingFunctions';
import { validatePackage, hash, snippet } from '/imports/api/rulesReference/package.mjs';

// These records and the derived full-text index are server-only. Clients receive bounded method results.
export const Installs = new Mongo.Collection('rulesReferenceInstalls');
export const Revisions = new Mongo.Collection('rulesReferenceRevisions');
export const Entries = new Mongo.Collection('rulesReferenceEntries');
const Locks = new Mongo.Collection('rulesReferenceLocks');
let packagePromise;
export function bundledPackage() {
  return packagePromise ||= Assets.getTextAsync('rules-reference/srd51.json').then(text => validatePackage(JSON.parse(text)));
}
function fail(code, message) { throw new Meteor.Error('reference-' + code, message); }
function auth(userId) { if (!userId) fail('auth', 'Sign in to use the rules reference.'); return userId; }
function fields(arg, allowed) {
  if (!arg || typeof arg !== 'object' || Array.isArray(arg) || Object.keys(arg).some(k => !allowed.includes(k))) fail('request', 'Invalid reference request.');
}
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,48}$/.test(value)) fail('request', 'Invalid reference identifier.'); return value; }
async function lock(owner) {
  const key = 'srd51-mutation', token = Random.id(), now = new Date();
  await Locks.removeAsync({ _id: key, expiresAt: { $lt: now } });
  try { await Locks.insertAsync({ _id: key, owner, token, expiresAt: new Date(Date.now() + 600000) }); }
  catch { fail('busy', 'Another reference operation is finishing. Please try again shortly.'); }
  const release = async () => Locks.removeAsync({ _id: key, token });
  release.check = async () => { if (!await Locks.updateAsync({ _id: key, token, expiresAt: { $gte: new Date() } }, { $set: { expiresAt: new Date(Date.now() + 600000) } })) fail('busy', 'Reference operation expired. Please retry.'); };
  return release;
}
async function owned(packId, owner) {
  const install = await Installs.findOneAsync({ _id: id(packId), owner: auth(owner) });
  if (!install) fail('not-found', 'Reference collection not found.');
  return install;
}
export async function accessible(packId, userId) {
  auth(userId);
  const install = await Installs.findOneAsync(id(packId));
  const revision = install?.activeRevisionId && await Revisions.findOneAsync({ _id: install.activeRevisionId, state: 'ready' });
  const allowed = revision && (await getUserLibraryIds(userId)).includes(revision.libraryId);
  if (!allowed) fail('not-found', 'Reference collection not found.');
  return { install, revision };
}
async function summary(install, userId) {
  const { revision } = await accessible(install._id, userId);
  const pack = await bundledPackage();
  const counts = {};
  await Entries.find({ revisionId: revision._id }, { fields: { category: 1 } }).forEachAsync(e => { counts[e.category] = (counts[e.category] || 0) + 1; });
  return { id: install._id, name: pack.name, edition: pack.edition, version: revision.version, sourceUrl: pack.sourceUrl, sourceHash: pack.sourceHash, counts, categories: pack.categories, canManage: install.owner === userId, previous: Boolean(install.previousRevisionId), entryCount: revision.entryCount, libraryId: revision.libraryId };
}
export async function listReferences(userId) {
  const libraries = await getUserLibraryIds(auth(userId));
  const revisions = await Revisions.find({ libraryId: { $in: libraries }, state: 'ready' }, { fields: { _id: 1 } }).fetchAsync();
  const installs = await Installs.find({ activeRevisionId: { $in: revisions.map(r => r._id) } }).fetchAsync();
  return Promise.all(installs.map(i => summary(i, userId)));
}
async function cleanupRevision(revisionId, fallbackLibraryId) {
  const r = await Revisions.findOneAsync(revisionId) || (fallbackLibraryId ? { libraryId: fallbackLibraryId } : null);
  if (!r) return;
  // Never remove a revision that was published, including a lost final acknowledgement.
  if (await Installs.findOneAsync({ $or: [{ activeRevisionId: revisionId }, { previousRevisionId: revisionId }] })) return;
  await LibraryNodes.removeAsync({ 'root.id': r.libraryId });
  await Libraries.removeAsync(r.libraryId);
  await Entries.removeAsync({ revisionId });
  await Revisions.removeAsync(revisionId);
}
async function archiveInactive(install) {
  const revisions = await Revisions.find({ installId: install._id, _id: { $ne: install.activeRevisionId } }).fetchAsync();
  for (const r of revisions) {
    await Libraries.updateAsync(r.libraryId, { $set: { owner: 'rr-archive-' + r._id, readers: [], writers: [] } });
    if (r._id !== install.previousRevisionId) await cleanupRevision(r._id);
  }
}
export async function installReference(userId, options = {}) {
  auth(userId);
  if (process.env.RULE_REFERENCE_ENABLED === 'false') fail('disabled', 'Adding reference material is currently disabled.');
  const pack = validatePackage(options.pack || await bundledPackage());
  const release = await lock(userId), installId = hash('srd51:' + userId).slice(0, 24);
  let revisionId, stagedLibraryId;
  try {
    let install = await Installs.findOneAsync(installId);
    if (!install) { await Installs.insertAsync({ _id: installId, owner: userId, readers: [], createdAt: new Date() }); install = await Installs.findOneAsync(installId); }
    const active = install.activeRevisionId && await Revisions.findOneAsync(install.activeRevisionId);
    if (active?.packageHash === pack.entriesHash) { await archiveInactive(install); return { ...(await summary(install, userId)), unchanged: true, changes: { added: 0, changed: 0, removed: 0 } }; }
    // Recover stages left by an interrupted application. Only this user's unpublished revisions are eligible.
    for (const r of await Revisions.find({ installId }).fetchAsync()) await cleanupRevision(r._id);
    const prior = active ? await Entries.find({ revisionId: active._id }, { fields: { key: 1, contentHash: 1 } }).fetchAsync() : [];
    const priorHashes = new Map(prior.map(e => [e.key, e.contentHash])), nextKeys = new Set(pack.entries.map(e => e.key));
    const changes = { added: pack.entries.filter(e => !priorHashes.has(e.key)).length, changed: pack.entries.filter(e => priorHashes.has(e.key) && priorHashes.get(e.key) !== e.contentHash).length, removed: prior.filter(e => !nextKeys.has(e.key)).length };
    revisionId = Random.id(); const libraryId = Random.id(); stagedLibraryId = libraryId;
    await Revisions.insertAsync({ _id: revisionId, installId, owner: userId, libraryId, state: 'staging', changes, version: pack.version, packageHash: pack.entriesHash, entryCount: pack.entries.length, createdAt: new Date() });
    await Libraries.insertAsync({ _id: libraryId, name: pack.name, description: 'Managed 2014 SRD source pages. Read and search in Rules Reference; keep personal notes in your own libraries.', owner: 'rr-stage-' + revisionId, readers: [], writers: [], public: false, managedReference: revisionId });
    if (options.fault === 'library') throw new Error('Injected reference library failure');
    const folders = {};
    for (const category of pack.categories) folders[category] = await LibraryNodes.insertAsync({ type: 'folder', name: category, root: { collection: 'libraries', id: libraryId }, searchable: false, fillSlots: false });
    let inserted = 0;
    for (const e of pack.entries) {
      if (inserted++ % 50 === 0) await release.check();
      const nodeId = await LibraryNodes.insertAsync({ type: 'note', name: e.title, description: { text: e.markdown }, tags: e.tags, parentId: folders[e.category], root: { collection: 'libraries', id: libraryId }, searchable: false, fillSlots: false });
      await Entries.insertAsync({ ...e, _id: hash(revisionId + ':' + e.key).slice(0, 24), revisionId, installId, libraryId, nodeId, owner: userId });
      if (options.fault === 'entries') throw new Error('Injected reference entries failure');
    }
    await rebuildNestedSets(LibraryNodes, libraryId);
    if (await Entries.find({ revisionId }).countAsync() !== pack.entries.length) throw new Error('Incomplete reference revision');
    await Revisions.updateAsync(revisionId, { $set: { state: 'ready' } });
    if (options.fault === 'validated') throw new Error('Injected reference validation failure');
    await release.check();
    // All content and tree relationships exist before a single library ACL exposes them.
    await Libraries.updateAsync(libraryId, { $set: { owner: userId, readers: install.readers || [] } });
    const collectionId = install.collectionId || Random.id();
    if (!install.collectionId) await LibraryCollections.insertAsync({ _id: collectionId, name: pack.name, description: '2014 SRD 5.1 — descriptive rules reference, not character automation.', libraries: [libraryId], owner: userId, readers: install.readers || [], writers: [], public: false, managedReference: installId });
    else await LibraryCollections.updateAsync(collectionId, { $set: { libraries: [libraryId] } });
    if (options.fault === 'publication') throw new Error('Injected reference publication failure');
    await Installs.updateAsync(installId, { $set: { activeRevisionId: revisionId, previousRevisionId: install.activeRevisionId || null, collectionId, updatedAt: new Date() } });
    if (options.fault === 'acknowledgement') throw new Error('Injected acknowledgement loss');
    install = await Installs.findOneAsync(installId); await archiveInactive(install);
    return { ...(await summary(install, userId)), changes };
  } catch (error) {
    const current = await Installs.findOneAsync(installId);
    if (revisionId && current?.activeRevisionId === revisionId) return { ...(await summary(current, userId)), changes: (await Revisions.findOneAsync(revisionId)).changes };
    if (revisionId) {
      const r = await Revisions.findOneAsync(revisionId);
      if (r && current?.collectionId && current.activeRevisionId) {
        const previous = await Revisions.findOneAsync(current.activeRevisionId);
        await LibraryCollections.updateAsync(current.collectionId, { $set: { libraries: [previous.libraryId] } });
      } else if (r) await LibraryCollections.removeAsync({ owner: userId, managedReference: installId });
      await cleanupRevision(revisionId, stagedLibraryId);
    }
    throw error;
  } finally { await release(); }
}
export async function searchReference(userId, arg) {
  fields(arg, ['packId', 'query', 'category', 'page']);
  const { revision } = await accessible(arg.packId, userId);
  await ensureIndexes();
  const query = arg.query || '', category = arg.category || '', page = arg.page || 0;
  if (typeof query !== 'string' || query.length > 120 || typeof category !== 'string' || category.length > 80 || !Number.isInteger(page) || page < 0 || page > 100) fail('request', 'Invalid search.');
  const filter = { revisionId: revision._id };
  if (category) filter.category = category;
  if (query.trim()) filter.$text = { $search: query.trim() };
  const options = { limit: 25, skip: page * 25, fields: { key: 1, title: 1, category: 1, section: 1, text: 1, ...(query.trim() ? { score: { $meta: 'textScore' } } : {}) }, sort: query.trim() ? { score: { $meta: 'textScore' }, title: 1 } : { category: 1, title: 1 } };
  const [rows, total] = await Promise.all([Entries.find(filter, options).fetchAsync(), Entries.find(filter).countAsync()]);
  return { total, page, results: rows.map(e => ({ key: e.key, title: e.title, category: e.category, section: e.section, snippet: snippet(e.text, query) })) };
}
export async function getReferenceEntry(userId, arg) {
  fields(arg, ['packId', 'key']); const { revision } = await accessible(arg.packId, userId);
  const e = await Entries.findOneAsync({ revisionId: revision._id, key: id(arg.key) }, { fields: { key: 1, title: 1, category: 1, section: 1, markdown: 1, pages: 1, links: 1, sourcePath: 1, contentHash: 1 } });
  if (!e) fail('not-found', 'Reference page not found.');
  return e;
}
export async function rollbackReference(userId, packId) {
  await owned(packId, userId); const release = await lock(userId);
  try {
    const install = await owned(packId, userId);
    const r = install.previousRevisionId && await Revisions.findOneAsync({ _id: install.previousRevisionId, owner: userId, state: 'ready' });
    if (!r) fail('not-found', 'No previous reference revision is available.');
    await Libraries.updateAsync(r.libraryId, { $set: { owner: userId, readers: install.readers || [] } });
    await LibraryCollections.updateAsync(install.collectionId, { $set: { libraries: [r.libraryId] } });
    await Installs.updateAsync(install._id, { $set: { activeRevisionId: r._id, previousRevisionId: install.activeRevisionId } });
    await archiveInactive(await Installs.findOneAsync(install._id));
  } finally { await release(); }
}
export async function shareReference(userId, arg) {
  fields(arg, ['packId', 'username', 'remove']); await owned(arg.packId, userId);
  if (typeof arg.username !== 'string' || !arg.username.trim() || arg.username.length > 30 || (arg.remove !== undefined && typeof arg.remove !== 'boolean')) fail('request', 'Enter a valid account username.');
  const user = await Meteor.users.findOneAsync({ username: arg.username.trim() }, { fields: { _id: 1 } });
  if (!user || user._id === userId) fail('request', 'Choose another existing account.');
  const release = await lock(userId);
  try {
    const install = await owned(arg.packId, userId);
    const readers = [...new Set([...(install.readers || []).filter(i => i !== user._id), ...(arg.remove ? [] : [user._id])])];
    if (readers.length > 50) fail('request', 'A maximum of 50 readers is supported.');
    await Libraries.updateAsync({ _id: (await Revisions.findOneAsync(install.activeRevisionId)).libraryId }, { $set: { readers } });
    await LibraryCollections.updateAsync(install.collectionId, { $set: { readers } });
    await Installs.updateAsync(install._id, { $set: { readers } });
  } finally { await release(); }
}
export async function removeReference(userId, packId) {
  const install = await owned(packId, userId), release = await lock(userId);
  try {
    const revisions = await Revisions.find({ installId: install._id, owner: userId }).fetchAsync();
    // Remove only the managed corpus. Other libraries and characters are never touched.
    await Installs.removeAsync(install._id);
    for (const r of revisions) await cleanupRevision(r._id);
    await LibraryCollections.removeAsync({ _id: install.collectionId, owner: userId });
  } finally { await release(); }
}
let indexPromise;
export function ensureIndexes() {
  return indexPromise ||= (async () => {
  await Entries.createIndexAsync({ title: 'text', tags: 'text', text: 'text' }, { weights: { title: 20, tags: 5, text: 1 }, name: 'reference_full_text' });
  await Entries.createIndexAsync({ revisionId: 1, key: 1 }, { unique: true });
  await Revisions.createIndexAsync({ installId: 1 });
  })();
}
Meteor.startup(async () => {
  await ensureIndexes();
  const username = process.env.RULE_REFERENCE_BOOTSTRAP_USER;
  if (username) {
    const user = await Meteor.users.findOneAsync({ username });
    if (!user) throw new Error('Reference bootstrap account was not found');
    await installReference(user._id);
    console.log('Verified bundled rules reference installed for configured account.');
  }
});
Meteor.methods({
  async 'rulesReference.catalog'() { auth(this.userId); const p = await bundledPackage(); return { name: p.name, edition: p.edition, version: p.version, entryCount: p.entries.length, categories: p.categories, enabled: process.env.RULE_REFERENCE_ENABLED !== 'false' }; },
  async 'rulesReference.list'() { return listReferences(this.userId); },
  async 'rulesReference.install'(arg = {}) { fields(arg, []); return installReference(auth(this.userId)); },
  async 'rulesReference.search'(arg) { return searchReference(auth(this.userId), arg); },
  async 'rulesReference.entry'(arg) { return getReferenceEntry(auth(this.userId), arg); },
  async 'rulesReference.rollback'(arg) { fields(arg, ['packId']); await rollbackReference(auth(this.userId), arg.packId); },
  async 'rulesReference.share'(arg) { return shareReference(auth(this.userId), arg); },
  async 'rulesReference.readers'(arg) { fields(arg, ['packId']); const i = await owned(arg.packId, this.userId); return Meteor.users.find({ _id: { $in: i.readers || [] } }, { fields: { username: 1 } }).fetchAsync(); },
  async 'rulesReference.remove'(arg) { fields(arg, ['packId']); return removeReference(auth(this.userId), arg.packId); },
});
DDPRateLimiter.addRule({ name: name => typeof name === 'string' && name.startsWith('rulesReference.'), connectionId: () => true }, 80, 10000);
DDPRateLimiter.addRule({ name: 'rulesReference.install', userId: id => Boolean(id) }, 3, 60000);

async function cleanupDeletedAccounts() {
  for (const install of await Installs.find({}, { fields: { owner: 1 } }).fetchAsync()) {
    if (!await Meteor.users.findOneAsync(install.owner, { fields: { _id: 1 } })) {
      try { await removeReference(install.owner, install._id); } catch (e) { if (e.error !== 'reference-busy') console.error('Reference orphan cleanup failed', e.message); }
    }
  }
}
Meteor.startup(() => { Meteor.setInterval(() => { cleanupDeletedAccounts().catch(e => console.error('Reference cleanup failed', e.message)); }, 60000); });
