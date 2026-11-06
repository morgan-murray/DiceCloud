import { assert } from 'chai';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import '/imports/api/users/Users';

describe('Short account usernames', function () {
  it('persists a three-character username and subsequent account updates', async function () {
    const id = Random.id();
    try {
      await Meteor.users.insertAsync({ _id: id, username: 'abc', createdAt: new Date() });
      await Meteor.users.updateAsync(id, { $set: { darkMode: true } });
      const user = await Meteor.users.findOneAsync(id);
      assert.equal(user?.username, 'abc');
      assert.isTrue(user?.darkMode);
    } finally {
      await Meteor.users.removeAsync(id);
    }
  });

  it('continues to reject usernames shorter than three characters', async function () {
    const id = Random.id();
    let rejected = false;
    try {
      await Meteor.users.insertAsync({ _id: id, username: 'ab', createdAt: new Date() });
    } catch {
      rejected = true;
    } finally {
      await Meteor.users.removeAsync(id);
    }
    assert.isTrue(rejected);
  });
});
