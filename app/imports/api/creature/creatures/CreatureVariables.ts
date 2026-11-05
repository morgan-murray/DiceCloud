import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import type { Variables } from '/imports/api/engine/computation/CreatureComputation';

const CreatureVariables = new Mongo.Collection<Variables>('creatureVariables');
if (Meteor.isServer) {
  Meteor.startup(async () => {
    await CreatureVariables.createIndexAsync({ _creatureId: 1 }, { unique: true });
  });
}
export default CreatureVariables;
