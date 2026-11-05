import 'meteor/aldeed:collection2/static';

// Await module evaluation before Mocha starts, including async import chains.
Meteor.startup(async () => {
  await import('/imports/server/runtimeMigration.test.ts');
  await import('/imports/api/creature/creatureProperties/methods/getSlotFillFilter.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyActionProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyAdjustmentProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyBranchProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyBuffProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyBuffRemoverProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyDamageProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyFolderProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyNoteProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyRollProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applySavingThrowProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyToggleProperty.test.ts');
  await import('/imports/api/engine/action/applyProperties/applyTriggerProperty.test.ts');
  await import('/imports/api/engine/action/test/applySilencedProps.test.ts');
  await import('/imports/api/engine/action/test/diceRollFunctions.test.ts');
  await import('/imports/api/engine/computation/buildCreatureComputation.test.js');
  await import('/imports/api/engine/computation/computeCreatureComputation.test.ts');
  await import('/imports/api/engine/computation/computeTagTargetedEffects.test.js');
  await import('/imports/api/engine/computation/test/tagTargetBaseValue.test.ts');
  await import('/imports/api/engine/computation/utility/applyFnToKey.test.js');
  await import('/imports/api/parenting/parentingFunctions.test.ts');
  await import('/imports/migrations/server/dbv1/dbv1.test.js');
  await import('/imports/migrations/server/dbv2/dbv2.test.js');
  await import('/imports/migrations/server/dbv3/dbv3.test.ts');
  await import('/imports/migrations/server/transformFields.test.js');
  await import('/imports/parser/parseTree/accessor.test.ts');
  await import('/imports/parser/parseTree/call.test.ts');
  await import('/imports/parser/parser.test.js');
  await import('/imports/server/config/throwUnresolvedPromises.test.ts');
});
