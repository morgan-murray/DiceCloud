import { Meteor } from 'meteor/meteor';
import SCHEMA_VERSION from '/imports/constants/SCHEMA_VERSION';
import SimpleSchema from '/imports/api/utility/SimpleSchema';
import { ValidatedMethod } from 'meteor/mdg:validated-method';
import { RateLimiterMixin } from 'ddp-rate-limiter-mixin';
import { assertOwnership } from '/imports/api/creature/creatures/creaturePermissions';
import Creatures from '/imports/api/creature/creatures/Creatures';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import CreatureLogs from '/imports/api/creature/log/CreatureLogs';
import Experiences from '/imports/api/creature/experience/Experiences';
import { removeCreatureWork } from '/imports/api/creature/creatures/methods/removeCreature';
import ArchiveCreatureFiles from '/imports/api/creature/archive/ArchiveCreatureFiles';
import { getFilter } from '/imports/api/parenting/parentingFunctions';

export async function getArchiveObj(creatureId) {
  // Build the archive document
  const creature = await Creatures.findOneAsync(creatureId);
  if (!creature) throw new Meteor.Error('creature-not-found', 'Creature not found');
  const properties = await CreatureProperties.find({ ...getFilter.descendantsOfRoot(creatureId) }).fetchAsync();
  const experiences = await Experiences.find({ creatureId }).fetchAsync();
  const logs = await CreatureLogs.find({ creatureId }).fetchAsync();
  const archiveCreature = {
    meta: {
      type: 'DiceCloud V2 Creature Archive',
      schemaVersion: SCHEMA_VERSION,
      archiveDate: new Date(),
    },
    creature,
    properties,
    experiences,
    logs,
  };

  return archiveCreature;
}

export async function archiveCreature(creatureId) {
  const archive = await getArchiveObj(creatureId);
  const buffer = Buffer.from(JSON.stringify(archive, null, 2));
  const fileRef = await ArchiveCreatureFiles.writeAsync(buffer, {
    fileName: `${archive.creature.name || archive.creature._id}.json`,
    type: 'application/json', userId: archive.creature.owner,
    meta: { schemaVersion: SCHEMA_VERSION, creatureId: archive.creature._id, creatureName: archive.creature.name },
  }, true);
  if (Meteor.settings.useS3) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ArchiveCreatureFiles.off('s3Result', resultHandler);
        reject(new Meteor.Error('archive-upload-timeout', 'The remote archive was not confirmed; the original character has been retained'));
      }, 30000);
      const resultHandler = (error, resultRef) => {
        if (resultRef?._id !== fileRef._id) return;
        clearTimeout(timeout);
        ArchiveCreatureFiles.off('s3Result', resultHandler);
        if (error) reject(error); else resolve();
      };
      ArchiveCreatureFiles.on('s3Result', resultHandler);
    });
  }
  await removeCreatureWork(creatureId);
  return fileRef._id;
}

const archiveCreatureToFile = new ValidatedMethod({
  name: 'Creatures.methods.archiveCreatureToFile',
  validate: new SimpleSchema({
    'creatureId': {
      type: String,
      max: 32,
    },
  }).validator(),
  mixins: [RateLimiterMixin],
  rateLimit: {
    numRequests: 10,
    timeInterval: 5000,
  },
  async run({ creatureId }) {
    if (!Meteor.isServer) return;
    await assertOwnership(creatureId, this.userId);
    return await archiveCreature(creatureId);
  },
});

export default archiveCreatureToFile;
