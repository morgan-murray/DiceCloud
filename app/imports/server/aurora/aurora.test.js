import { assert } from 'chai';
import fs from 'node:fs';
import path from 'node:path';
import { api, Jobs, Packs, commitSnapshot, rollback } from './service';
import { runWorker, workerPath } from './worker';
import Creatures from '/imports/api/creature/creatures/Creatures';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import CreatureVariables from '/imports/api/creature/creatures/CreatureVariables';
import computeCreature from '/imports/api/engine/computeCreature';
import { mapSnapshot } from '/imports/api/aurora/adapter.mjs';
const fixture = name => ({ name, data: fs.readFileSync(path.join(path.dirname(workerPath()), 'fixtures', name)).toString('base64') });
async function rejects(fn, part) { let error; try { await fn(); } catch(e) { error=e; } assert.exists(error); if(part) assert.include(String(error.error || error.message), part); }

describe('Aurora import private preview and native fidelity', function () {
  this.timeout(30000);
  let userId, otherId, savedFlag;
  const creatures=[];
  before(async () => {
    savedFlag=process.env.AURORA_IMPORT_ENABLED; process.env.AURORA_IMPORT_ENABLED='true';
    userId=Random.id(); otherId=Random.id();
    for (const id of [userId,otherId]) await Meteor.users.insertAsync({ _id:id, username:'aurora-test-'+id, createdAt:new Date() });
  });
  after(async () => {
    for (const creatureId of creatures) { await rollback(creatureId); await Creatures.removeAsync(creatureId); }
    for (const collection of [Jobs,Packs]) await collection.removeAsync({ owner: { $in:[userId,otherId] } });
    await Meteor.users.removeAsync({ _id: { $in:[userId,otherId] } });
    if(savedFlag===undefined) delete process.env.AURORA_IMPORT_ENABLED; else process.env.AURORA_IMPORT_ENABLED=savedFlag;
  });
  it('computes and reloads the synthetic corpus without duplicate ability/proficiency', async () => {
    const expected=JSON.parse(fs.readFileSync(path.join(path.dirname(workerPath()),'fixtures/expected.json')));
    for (const name of Object.keys(expected)) {
      const response=await runWorker({ schemaVersion:1, operation:'character', character:fixture(name+'.dnd5e'), files:[fixture('content.xml')] });
      assert.isTrue(response.ok,JSON.stringify(response));
      const creatureId=Random.id(); creatures.push(creatureId);
      await commitSnapshot({ snapshot:response.result,creatureId },userId);
      await computeCreature(creatureId);
      const props=await CreatureProperties.find({ 'root.id':creatureId }).fetchAsync();
      const byVariable=Object.fromEntries(props.map(p=>[p.variableName,p]));
      assert.equal(byVariable.hitPoints.total,expected[name].hp);
      assert.equal(byVariable.armor.total,expected[name].ac);
      assert.equal(byVariable.strength.total,expected[name].strength);
      for(const [skill, values] of Object.entries(response.result.skills)) assert.equal(byVariable[skill.replace(/ /g,'')].value,values.bonus);
      for(const [save, value] of Object.entries(response.result.saves)) assert.equal(byVariable[save+'Save'].value,value);
      const saved=await Creatures.findOneAsync(creatureId);
      assert.equal(saved.owner,userId); assert.isFalse(saved.public); assert.deepEqual(saved.allowedLibraries,[]);
      await rollback(creatureId); await Creatures.removeAsync(creatureId);
    }
  });
  it('fails closed for anonymous, disabled and cross-user access', async () => {
    await rejects(()=>api.list(null),'auth');
    process.env.AURORA_IMPORT_ENABLED='false'; await rejects(()=>api.list(userId),'disabled'); process.env.AURORA_IMPORT_ENABLED='true';
    const pack=await api.addPack(userId,{ name:'Test pack',files:[fixture('content.xml')] });
    assert.isTrue(pack.ok);
    await rejects(()=>api.remove(otherId,{ kind:'pack',id:pack.packId }),'not-found');
    await rejects(()=>api.preview(otherId,{ character:fixture('martial.dnd5e'),packIds:[pack.packId] }),'not-found');
    await api.remove(userId,{kind:'pack',id:pack.packId});
  });
  it('requires warnings, is idempotent, and keeps preview invisible', async () => {
    const pack=await api.addPack(userId,{name:'Preview pack',files:[fixture('content.xml')]});
    const preview=await api.preview(userId,{ character:fixture('martial.dnd5e'),packIds:[pack.packId] });
    assert.isTrue(preview.ok,JSON.stringify(preview));
    const job=await Jobs.findOneAsync(preview.previewId); creatures.push(job.creatureId);
    assert.isUndefined(await Creatures.findOneAsync(job.creatureId));
    const commit={ previewId:preview.previewId,commitKey:preview.commitKey,acknowledgedCodes:[] };
    await rejects(()=>api.commit(userId,commit),'acknowledgement');
    await rejects(()=>api.commit(otherId,commit),'not-found');
    commit.acknowledgedCodes=preview.snapshot.diagnostics.map(d=>d.code);
    const once=await api.commit(userId,commit), twice=await api.commit(userId,commit);
    assert.equal(once.creatureId,twice.creatureId);
    await api.remove(userId,{kind:'job',id:preview.previewId});
    assert.exists(await Creatures.findOneAsync(once.creatureId));
    await api.remove(userId,{kind:'pack',id:pack.packId});
  });
  it('preserves a complete snapshot if final publication acknowledgement fails', async () => {
    const result=await runWorker({schemaVersion:1,operation:'character',character:fixture('martial.dnd5e'),files:[fixture('content.xml')]});
    const creatureId=Random.id(); creatures.push(creatureId);
    let reached=false;
    const saved=await commitSnapshot({snapshot:result.result,creatureId},userId,point=>{if(point==='published') {reached=true;throw new Error('Synthetic lost acknowledgement');}});
    assert.isTrue(reached); assert.equal(saved,creatureId);
    assert.exists(await Creatures.findOneAsync(creatureId));
    assert.isAbove(await CreatureProperties.find({'root.id':creatureId}).countAsync(),0);
    assert.exists(await CreatureVariables.findOneAsync({_creatureId:creatureId}));
    await rollback(creatureId); await Creatures.removeAsync(creatureId);
  });
  it('rolls back every persistence boundary before publishing', async () => {
    const result=await runWorker({schemaVersion:1,operation:'character',character:fixture('martial.dnd5e'),files:[fixture('content.xml')]});
    for(const boundary of ['property','computed-properties','variables','before-publish']) {
      const creatureId=Random.id();
      let reached=false;
      await rejects(()=>commitSnapshot({snapshot:result.result,creatureId},userId,point=>{if(point===boundary) { reached=true; throw new Error('Synthetic fault'); }}));
      assert.isTrue(reached, 'Fault boundary was actually exercised: '+boundary);
      assert.equal(await CreatureProperties.find({'root.id':creatureId}).countAsync(),0);
      assert.isUndefined(await CreatureVariables.findOneAsync({_creatureId:creatureId}));
      assert.isUndefined(await Creatures.findOneAsync(creatureId));
    }
  });
});
