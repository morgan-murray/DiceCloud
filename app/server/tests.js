import 'meteor/aldeed:collection2/static';

// Await module evaluation before Mocha starts, including async import chains.
Meteor.startup(async () => {
  await import('/imports/server/tabletopPermissions.test');
  await import('/imports/server/archiveRuntime.test');
  await import('/imports/server/runtimeMigration.test');
  await import('/imports/api/creature/creatureProperties/methods/getSlotFillFilter.test');
  await import('/imports/api/engine/action/applyProperties/applyActionProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyAdjustmentProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyBranchProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyBuffProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyBuffRemoverProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyDamageProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyFolderProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyNoteProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyRollProperty.test');
  await import('/imports/api/engine/action/applyProperties/applySavingThrowProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyToggleProperty.test');
  await import('/imports/api/engine/action/applyProperties/applyTriggerProperty.test');
  await import('/imports/api/engine/action/test/applySilencedProps.test');
  await import('/imports/api/engine/action/test/diceRollFunctions.test');
  await import('/imports/api/engine/computation/buildCreatureComputation.test');
  await import('/imports/api/engine/computation/computeCreatureComputation.test');
  await import('/imports/api/engine/computation/computeTagTargetedEffects.test');
  await import('/imports/api/engine/computation/test/tagTargetBaseValue.test');
  await import('/imports/api/engine/computation/utility/applyFnToKey.test');
  await import('/imports/api/parenting/parentingFunctions.test');
  await import('/imports/migrations/server/dbv1/dbv1.test');
  await import('/imports/migrations/server/dbv2/dbv2.test');
  await import('/imports/migrations/server/dbv3/dbv3.test');
  await import('/imports/migrations/server/transformFields.test');
  await import('/imports/parser/parseTree/accessor.test');
  await import('/imports/parser/parseTree/call.test');
  await import('/imports/parser/parser.test');
  await import('/imports/server/config/throwUnresolvedPromises.test');
});
