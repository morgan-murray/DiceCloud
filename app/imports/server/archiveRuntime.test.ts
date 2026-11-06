import { assert } from 'chai';
import Creatures from '/imports/api/creature/creatures/Creatures';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import ArchiveCreatureFiles from '/imports/api/creature/archive/ArchiveCreatureFiles';
import archiveCreatureToFile from '/imports/api/creature/archive/methods/archiveCreatureToFile';
import restoreCreatureFromFile from '/imports/api/creature/archive/methods/restoreCreatureFromFile';
import { removeCreatureWork } from '/imports/api/creature/creatures/methods/removeCreature';
import { loadCreature, loadedCreatures } from '/imports/api/engine/loadCreatures';

describe('Archive runtime migration', function () {
  it('rejects another user, archives durably and restores the character and properties', async function () {
    const owner = Random.id(), other = Random.id(), creatureId = Random.id();
    let fileId: string | undefined;
    const stops: (() => void)[] = [];
    try {
      for (const id of [owner, other]) {
        await Meteor.users.insertAsync({ _id: id, username: `test-${id}`, createdAt: new Date() });
      }
      await Creatures.insertAsync({ _id: creatureId, name: 'Synthetic archive fixture', owner, type: 'pc' });
      const propId = await CreatureProperties.insertAsync({
        type: 'attribute', name: 'Archive Strength', variableName: 'strength', attributeType: 'ability',
        baseValue: { calculation: '14' }, root: { collection: 'creatures', id: creatureId }, left: 1, right: 2,
      });
      let denied = false;
      try { await archiveCreatureToFile._execute({ userId: other }, { creatureId }); } catch { denied = true; }
      assert.isTrue(denied);
      assert.exists(await Creatures.findOneAsync(creatureId), 'A denied archive cannot remove the character');
      // Keep an active sheet subscription while archiving: removing properties
      // schedules debounced computation after the character has disappeared.
      await loadCreature(creatureId, { onStop(callback: () => void) { stops.push(callback); } } as Subscription);
      assert.exists(loadedCreatures.get(creatureId)?.creature);
      fileId = await archiveCreatureToFile._execute({ userId: owner }, { creatureId });
      assert.isString(fileId);
      assert.notExists(await Creatures.findOneAsync(creatureId));
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.notExists(loadedCreatures.get(creatureId)?.creature);
      const file = (await ArchiveCreatureFiles.findOneAsync(fileId))?.get();
      assert.exists(file);
      const archived = await ArchiveCreatureFiles.readJSONFile(file);
      assert.equal(archived.creature.name, 'Synthetic archive fixture');
      await restoreCreatureFromFile._execute({ userId: owner }, { fileId });
      const restored = await Creatures.findOneAsync(creatureId);
      assert.equal(restored?.owner, owner);
      assert.equal(restored?.name, 'Synthetic archive fixture');
      assert.equal((await CreatureProperties.findOneAsync(propId))?.name, 'Archive Strength');
      assert.isNull(await ArchiveCreatureFiles.findOneAsync(fileId));
    } finally {
      for (const stop of stops) stop();
      await removeCreatureWork(creatureId);
      if (fileId && await ArchiveCreatureFiles.findOneAsync(fileId)) await ArchiveCreatureFiles.removeAsync(fileId);
      await Meteor.users.removeAsync({ _id: { $in: [owner, other] } });
    }
  });
});
