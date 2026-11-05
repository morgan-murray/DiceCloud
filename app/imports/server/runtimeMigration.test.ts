import { assert } from 'chai';
import { TypedSimpleSchema } from '/imports/api/utility/TypedSimpleSchema';
import CreatureVariables from '/imports/api/creature/creatures/CreatureVariables';
import writeScope from '/imports/api/engine/computation/writeComputation/writeScope';
import { assertEditPermission, assertViewPermission } from '/imports/api/sharing/sharingPermissions';

describe('Runtime migration regressions', function () {
  it('omits the excluded schema fields while retaining other fields', function () {
    const schema = TypedSimpleSchema.from({
      visible: { type: String },
      excluded: { type: String, optional: true },
    }).omit('excluded');
    assert.sameMembers(schema.objectKeys(), ['visible']);
    schema.validate({ visible: 'kept' });
    assert.throws(() => schema.validate({ excluded: 'not allowed' }));
  });

  it('persists computed values and property references and removes stale variables', async function () {
    const creatureId = Random.id();
    try {
      await writeScope(creatureId, {
        scope: { score: { _id: 'attribute', type: 'attribute', value: 12 }, total: { value: 4 }, stale: { value: 1 } },
        creature: {},
      });
      const stored = await CreatureVariables.findOneAsync({ _creatureId: creatureId });
      assert.deepEqual(stored?.score, { _propId: 'attribute' });
      assert.deepEqual(stored?.total, { value: 4 });
      await writeScope(creatureId, { scope: { total: { value: 8 } }, creature: {} });
      const updated = await CreatureVariables.findOneAsync({ _creatureId: creatureId });
      assert.deepEqual(updated?.total, { value: 8 });
      assert.notProperty(updated, 'stale');
      assert.notProperty(updated, 'score');
    } finally {
      await CreatureVariables.removeAsync({ _creatureId: creatureId });
    }
  });

  it('allows the owner to edit and denies another user and anonymous access', async function () {
    const owner = Random.id(), other = Random.id();
    const doc = { owner, writers: [], readers: [], public: false };
    try {
      for (const id of [owner, other]) {
        await Meteor.users.insertAsync({ _id: id, username: `test-${id}`, createdAt: new Date() });
      }
      await assertEditPermission(doc, owner);
      await assertViewPermission(doc, owner);
      for (const userId of [other, null]) {
        let editDenied = false, viewDenied = false;
        try { await assertEditPermission(doc, userId); } catch { editDenied = true; }
        try { await assertViewPermission(doc, userId); } catch { viewDenied = true; }
        assert.isTrue(editDenied);
        assert.isTrue(viewDenied);
      }
    } finally {
      await Meteor.users.removeAsync({ _id: { $in: [owner, other] } });
    }
  });
});
