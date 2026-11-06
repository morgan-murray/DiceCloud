import { Meteor } from 'meteor/meteor';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { createHash } from 'node:crypto';
import Creatures, { CreatureSchema } from '/imports/api/creature/creatures/Creatures';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import CreatureVariables from '/imports/api/creature/creatures/CreatureVariables';
import assertHasCharactersSlots from '/imports/api/creature/creatures/methods/assertHasCharacterSlots';
import { buildComputationFromProps } from '/imports/api/engine/computation/buildCreatureComputation';
import computeCreatureComputation from '/imports/api/engine/computation/computeCreatureComputation';
import writeAlteredProperties from '/imports/api/engine/computation/writeComputation/writeAlteredProperties';
import writeScope from '/imports/api/engine/computation/writeComputation/writeScope';
import VERSION from '/imports/constants/VERSION';
import { mapSnapshot, ADAPTER_VERSION } from '/imports/api/aurora/adapter.mjs';
import { runWorker } from './worker';

// Server-only collections; never published, no client write methods.
export const Packs = new Mongo.Collection('auroraPacks');
export const Jobs = new Mongo.Collection('auroraJobs');
const Locks = new Mongo.Collection('auroraLocks');
const HOUR = 3600000;
const enabled = () => process.env.AURORA_IMPORT_ENABLED === 'true';
function error(code, message) { throw new Meteor.Error('aurora-' + code, message); }
function owner(id) { if (!id) error('auth', 'Sign in to use Aurora imports.'); if (!enabled()) error('disabled', 'Aurora imports are currently disabled.'); return id; }
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) error('request', 'Invalid import request.');
}
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value)) error('request', 'Invalid import identifier.'); return value; }
function upload(file, max) {
  keys(file, ['name', 'data']);
  if (typeof file.name !== 'string' || !file.name || file.name.length > 200 || typeof file.data !== 'string' || file.data.length > Math.ceil(max * 4 / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.data)) error('upload', 'Invalid or oversized file.');
  const size = Buffer.from(file.data, 'base64').length;
  if (!size || size > max) error('upload', 'Invalid or oversized file.');
  return size;
}
async function owned(collection, identifier, userId) {
  const doc = await collection.findOneAsync({ _id: id(identifier), owner: userId });
  if (!doc) error('not-found', 'Import record not found.');
  return doc;
}
async function quota(userId, additional) {
  let used = 0;
  for (const collection of [Packs, Jobs]) await collection.find({ owner: userId }, { fields: { size: 1 } }).forEachAsync(d => used += d.size || 0);
  // Separate, explicit import-source quota; no changes to native image/archive accounting.
  if (used + additional > 20 * 1024 ** 2) error('quota', 'Import sources exceed your 20 MiB allowance. Delete old private packs or import history first.');
}
async function lock(key) {
  const token = Random.id(), expiresAt = new Date(Date.now() + 600000);
  await Locks.removeAsync({ _id: key, expiresAt: { $lt: new Date() } });
  try { await Locks.insertAsync({ _id: key, token, expiresAt }); return async () => Locks.removeAsync({ _id: key, token }); }
  catch { error('busy', 'Another import is running. Please retry shortly.'); }
}
async function workerFor(userId, request) {
  let release;
  for (let slot = 0; slot < 2; slot++) {
    try { release = await lock('worker-' + slot); break; } catch (e) { if (slot === 1) throw e; }
  }
  try { return await runWorker(request); } finally { await release(); }
}
async function userWork(userId, fn) {
  const release = await lock('user-' + userId);
  try { return await fn(); } finally { await release(); }
}
export async function rollback(creatureId) {
  // No creature is published until every property and variable has been written.
  await CreatureProperties.removeAsync({ 'root.id': creatureId });
  await CreatureVariables.removeAsync({ _creatureId: creatureId });
}
async function prepareSnapshot(snapshot, creatureId, userId) {
  const { creature, props } = mapSnapshot(snapshot, creatureId, userId, () => Random.id());
  CreatureSchema.validate(CreatureSchema.clean(creature));
  const cleaned = props.map(prop => {
    const schema = CreatureProperties.simpleSchema(prop);
    const clean = schema.clean(prop); schema.validate(clean); return clean;
  });
  const computation = buildComputationFromProps(cleaned, creature, { _creatureId: creature._id });
  await computeCreatureComputation(computation);
  if (computation.errors.length) error('computation', 'The imported snapshot could not be computed safely.');
  // Check numeric fidelity against actual engine output before persistence.
  const byVariable = Object.fromEntries(computation.props.filter(p => p.variableName).map(p => [p.variableName, p]));
  for (const [ability, score] of Object.entries(snapshot.abilities)) if (byVariable[ability]?.total !== score) error('fidelity', 'Computed ability differs from the preview.');
  if (byVariable.hitPoints?.total !== snapshot.hitPoints.maximum || byVariable.armor?.total !== snapshot.armorClass) error('fidelity', 'Computed hit points or AC differ from the preview.');
  for (const [skill, values] of Object.entries(snapshot.skills)) if (byVariable[skill.replace(/ /g, '')]?.value !== values.bonus) error('fidelity', 'Computed skill differs from the preview.');
  return { creature, cleaned, computation };
}
export async function commitSnapshot(job, userId, fault = () => {}) {
  await assertHasCharactersSlots(userId);
  const { creature, cleaned, computation } = await prepareSnapshot(job.snapshot, job.creatureId, userId);
  try {
    for (const prop of cleaned) { await CreatureProperties.insertAsync(prop); await fault('property'); }
    await writeAlteredProperties(computation); await fault('computed-properties');
    await writeScope(creature._id, computation); await fault('variables');
    await assertHasCharactersSlots(userId);
    creature.computeVersion = VERSION; creature.lastComputedAt = new Date();
    await fault('before-publish');
    // Last write makes a complete character visible to native publications.
    await Creatures.insertAsync(creature);
  } catch (e) { await rollback(creature._id); throw e; }
  return creature._id;
}
let builtinStatus;
export const api = {
  async status(userId) {
    if (!userId) return { enabled: false };
    if (!enabled()) return { enabled: false };
    const result = builtinStatus || await userWork(userId, () => workerFor(userId, { schemaVersion: 1, operation: 'pack', files: [] }));
    if (result.ok) builtinStatus = result;
    if (!result.ok) error('worker', 'Built-in reference pack is unavailable.');
    return { enabled: true, builtin: result.result.builtin, quotaBytes: 20 * 1024 ** 2 };
  },
  async list(userId) {
    owner(userId);
    return { packs: await Packs.find({ owner: userId }, { fields: { name: 1, manifest: 1, createdAt: 1, size: 1 } }).fetchAsync(),
      history: await Jobs.find({ owner: userId, state: 'complete' }, { fields: { creatureId: 1, createdAt: 1, size: 1 } }).fetchAsync() };
  },
  async addPack(userId, request) {
    owner(userId); keys(request, ['name', 'files']);
    if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 128 || !Array.isArray(request.files) || !request.files.length || request.files.length > 100) error('request', 'Choose a pack name and XML/ZIP files.');
    const size = request.files.reduce((sum, file) => sum + upload(file, 4 * 1024 ** 2), 0);
    if (size > 8 * 1024 ** 2) error('size', 'Pack uploads exceed 8 MiB.');
    return userWork(userId, async () => {
      await quota(userId, size);
      if (await Packs.find({ owner: userId }).countAsync() >= 5) error('quota', 'At most five private packs can be saved.');
      const response = await workerFor(userId, { schemaVersion: 1, operation: 'pack', files: request.files });
      if (!response.ok) return response;
      const packId = await Packs.insertAsync({ owner: userId, name: request.name.trim(), files: request.files, manifest: response.result, size, createdAt: new Date() });
      return { ok: true, packId, manifest: response.result };
    });
  },
  async preview(userId, request) {
    owner(userId); keys(request, ['character', 'packIds']);
    const size = upload(request.character, 2 * 1024 ** 2);
    if (!Array.isArray(request.packIds) || request.packIds.length > 5 || new Set(request.packIds).size !== request.packIds.length) error('request', 'Choose up to five different private packs.');
    return userWork(userId, async () => {
      await quota(userId, size); await assertHasCharactersSlots(userId);
      if (!await Meteor.users.findOneAsync(userId)) error('auth', 'Account is no longer available.');
      if (await Jobs.find({ owner: userId, state: 'preview' }).countAsync() >= 3) error('quota', 'Cancel an earlier preview before starting another.');
      const files = [];
      for (const packId of request.packIds) files.push(...(await owned(Packs, packId, userId)).files);
      const response = await workerFor(userId, { schemaVersion: 1, operation: 'character', character: request.character, files });
      if (!response.ok) return response;
      const creatureId = Random.id();
      await prepareSnapshot(response.result, creatureId, userId);
      const commitKey = Random.secret(), expiresAt = new Date(Date.now() + HOUR);
      const previewId = await Jobs.insertAsync({ owner: userId, state: 'preview', source: request.character, size,
        snapshot: response.result, commitHash: createHash('sha256').update(commitKey).digest('hex'),
        creatureId, adapterVersion: ADAPTER_VERSION, createdAt: new Date(), expiresAt });
      return { ok: true, previewId, commitKey, expiresAt, snapshot: response.result };
    });
  },
  async commit(userId, request) {
    owner(userId); keys(request, ['previewId', 'commitKey', 'acknowledgedCodes']);
    const job = await owned(Jobs, request.previewId, userId);
    if (typeof request.commitKey !== 'string' || request.commitKey.length > 100 || createHash('sha256').update(request.commitKey).digest('hex') !== job.commitHash) error('request', 'Invalid preview commit key.');
    if (job.state === 'complete') return { creatureId: job.creatureId };
    if (job.adapterVersion !== ADAPTER_VERSION) error('expired', 'Importer version changed. Preview the file again.');
    if (job.expiresAt < new Date() || job.state !== 'preview') error('expired', 'Preview expired or is no longer available. Preview the file again.');
    if (!Array.isArray(request.acknowledgedCodes) || job.snapshot.diagnostics.some(d => !request.acknowledgedCodes.includes(d.code))) error('acknowledgement', 'Acknowledge all import warnings before importing.');
    return userWork(userId, async () => {
      const claimed = await Jobs.updateAsync({ _id: job._id, owner: userId, state: 'preview', expiresAt: { $gt: new Date() } }, { $set: { state: 'committing' } });
      if (!claimed) error('busy', 'This preview is already being imported. Retry to retrieve the result.');
      try {
        const creatureId = await commitSnapshot(job, userId);
        await Jobs.updateAsync(job._id, { $set: { state: 'complete', completedAt: new Date() } });
        return { creatureId };
      } catch (e) {
        // A crash after the final creature insert is still a successful commit.
        if (await Creatures.findOneAsync({ _id: job.creatureId, owner: userId })) {
          await Jobs.updateAsync(job._id, { $set: { state: 'complete' } }); return { creatureId: job.creatureId };
        }
        await Jobs.updateAsync(job._id, { $set: { state: 'preview' } }); throw e;
      }
    });
  },
  async remove(userId, request) {
    owner(userId); keys(request, ['kind', 'id']);
    if (!['pack', 'job'].includes(request.kind)) error('request', 'Unknown import record type.');
    return userWork(userId, async () => {
      const collection = request.kind === 'pack' ? Packs : Jobs;
      const record = await owned(collection, request.id, userId);
      if (record.state === 'committing') error('busy', 'Import is committing. Retry after completion.');
      await collection.removeAsync({ _id: record._id, owner: userId });
      return true;
    });
  },
};
// Owner comes exclusively from the authenticated DDP invocation.
DDPRateLimiter.addRule({ type: 'method', name: name => typeof name === 'string' && name.startsWith('aurora.'), userId: id => !!id }, 20, 10000);
Meteor.methods(Object.fromEntries(Object.entries(api).map(([name, handler]) => ['aurora.' + name, async function (request) { return handler(this.userId, request); }])));

export async function cleanup() {
  for (const job of await Jobs.find({ state: 'committing' }).fetchAsync()) {
    if (await Locks.findOneAsync({ _id: 'user-' + job.owner, expiresAt: { $gt: new Date() } })) continue;
    if (await Creatures.findOneAsync({ _id: job.creatureId, owner: job.owner })) await Jobs.updateAsync(job._id, { $set: { state: 'complete' } });
    else { await rollback(job.creatureId); await Jobs.updateAsync(job._id, { $set: { state: 'preview' } }); }
  }
  await Jobs.removeAsync({ state: 'preview', expiresAt: { $lt: new Date() } });
  for (const collection of [Packs, Jobs]) for (const record of await collection.find({}, { fields: { owner: 1, creatureId: 1 } }).fetchAsync()) {
    if (!await Meteor.users.findOneAsync(record.owner)) {
      if (record.creatureId && !await Creatures.findOneAsync(record.creatureId)) await rollback(record.creatureId);
      await collection.removeAsync(record._id);
    }
  }
  await Locks.removeAsync({ expiresAt: { $lt: new Date() } });
}
Meteor.startup(async () => { await cleanup(); Meteor.setInterval(cleanup, 60000); });
