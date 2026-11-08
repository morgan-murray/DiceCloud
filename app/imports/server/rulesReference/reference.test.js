import { assert } from 'chai';
import { Installs, Revisions, Entries, installReference, listReferences, searchReference, getReferenceEntry, shareReference, rollbackReference, removeReference, bundledPackage, ensureIndexes } from './service';
import Libraries from '/imports/api/library/Libraries';
import LibraryNodes from '/imports/api/library/LibraryNodes';
import LibraryCollections from '/imports/api/library/LibraryCollections';
import { assertEditPermission } from '/imports/api/sharing/sharingPermissions';
import { hash } from '/imports/api/rulesReference/package.mjs';
async function denied(fn) { let err; try { await fn(); } catch (e) { err = e; } assert.exists(err); }
function changed(pack, version) { const p = JSON.parse(JSON.stringify(pack)); p.version = version; p.entries[0].markdown += '\nUpdated source fixture.\n'; p.entries[0].contentHash = hash(p.entries[0].markdown); p.entriesHash = hash(JSON.stringify(p.entries)); return p; }
describe('Rules reference ownership, publishing, search and recovery', function () {
 this.timeout(120000);
 let owner, other, pack, tiny, personal;
 before(async () => {
  await ensureIndexes(); owner = Random.id(); other = Random.id();
  for (const id of [owner, other]) await Meteor.users.insertAsync({ _id: id, username: 'rr-test-' + id, createdAt: new Date() });
  pack = await bundledPackage(); tiny = JSON.parse(JSON.stringify(pack));
  tiny.entries = tiny.entries.filter(e => ['About and Sources', 'Bless', 'Grappled', 'Incapacitated', 'Thunderwave', 'Casting a Spell', 'Cleric', 'Armor'].includes(e.title));
  const keys = new Set(tiny.entries.map(e => e.key)); for (const e of tiny.entries) e.links = e.links.filter(l => keys.has(l.key)); tiny.entriesHash = hash(JSON.stringify(tiny.entries));
  personal = await Libraries.insertAsync({ name: 'Personal notes', owner, readers: [], writers: [], public: false });
 });
 after(async () => {
  for (const i of await Installs.find({ owner: { $in: [owner, other] } }).fetchAsync()) await removeReference(i.owner, i._id);
  await LibraryNodes.removeAsync({ 'root.id': personal }); await Libraries.removeAsync(personal); await Meteor.users.removeAsync({ _id: { $in: [owner, other] } });
 });
 it('refuses anonymous requests and leaves no partial collection at every failed boundary', async () => {
  await denied(() => installReference(null)); await denied(() => listReferences(null));
  for (const fault of ['library', 'entries', 'validated', 'publication']) {
   await denied(() => installReference(owner, { pack: tiny, fault }));
   assert.deepEqual(await listReferences(owner), []); assert.equal(await Entries.find({ owner }).countAsync(), 0); assert.equal(await Revisions.find({ owner }).countAsync(), 0);
   assert.equal(await LibraryCollections.find({ owner, managedReference: { $exists: true } }).countAsync(), 0);
  }
 });
 it('retains a fully published revision when final acknowledgement is lost', async () => {
  const result = await installReference(owner, { pack: tiny, fault: 'acknowledgement' }); assert.equal(result.entryCount, tiny.entries.length);
  assert.equal((await listReferences(owner)).length, 1); const repeated = await installReference(owner, { pack: tiny }); assert.isTrue(repeated.unchanged);
 });
 it('enforces private search, read-only originals, sharing and revocation', async () => {
  const book = (await listReferences(owner))[0], key = tiny.entries.find(e => e.title === 'Bless').key;
  assert.deepEqual(await listReferences(other), []); await denied(() => searchReference(other, { packId: book.id, query: 'Bless' })); await denied(() => getReferenceEntry(other, { packId: book.id, key }));
  await denied(async () => assertEditPermission(await Libraries.findOneAsync(book.libraryId), owner)); await assertEditPermission(await Libraries.findOneAsync(personal), owner);
  await shareReference(owner, { packId: book.id, username: 'rr-test-' + other }); assert.equal((await listReferences(other)).length, 1);
  assert.equal((await getReferenceEntry(other, { packId: book.id, key })).title, 'Bless');
  await denied(() => shareReference(other, { packId: book.id, username: 'rr-test-' + owner }));
  await shareReference(owner, { packId: book.id, username: 'rr-test-' + other, remove: true }); await denied(() => getReferenceEntry(other, { packId: book.id, key }));
 });
 it('updates and rolls back while preserving personal notes', async () => {
  const before = (await listReferences(owner))[0], next = changed(tiny, '1.0.1'); await installReference(owner, { pack: next });
  let book = (await listReferences(owner))[0]; assert.equal(book.version, '1.0.1'); assert.isTrue(book.previous);
  await rollbackReference(owner, before.id); book = (await listReferences(owner))[0]; assert.equal(book.version, tiny.version); assert.exists(await Libraries.findOneAsync(personal));
 });
 it('imports the complete corpus, searches body text and keeps reference notes out of character pickers', async () => {
  await installReference(owner, { pack }); const book = (await listReferences(owner))[0]; assert.equal(book.entryCount, pack.entries.length);
  for (const query of ['difficult terrain', 'concentration', 'grappled', 'long rest', 'opportunity attack']) { const found = await searchReference(owner, { packId: book.id, query }); assert.isAbove(found.total, 0, query); assert.isAtMost(found.results.length, 25); }
  const found = await searchReference(owner, { packId: book.id, query: 'Bless' }); assert.equal(found.results[0].title, 'Bless');
  assert.equal(await LibraryNodes.find({ 'root.id': book.libraryId, searchable: true }).countAsync(), 0);
  assert.isTrue((await installReference(owner)).unchanged);
  await denied(() => searchReference(owner, { packId: book.id, query: 'x'.repeat(121) }));
 });
});
