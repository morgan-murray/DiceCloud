import { assert } from 'chai';
import { Accounts } from 'meteor/accounts-base';
import { Email } from 'meteor/email';
import { Meteor } from 'meteor/meteor';
import '/imports/server/config/urlPath';
import '/imports/server/config/accountsEmailConfig';

describe('Configured account URLs', function () {
  it('renders reset, enrollment and verification links through a fake transport', async function () {
    const original = Email.customTransport;
    const messages: any[] = [];
    Email.customTransport = async options => { messages.push(options); return true; };
    let userId: string | undefined;
    try {
      const email = `url-fixture-${Random.id()}@example.invalid`;
      userId = await Accounts.createUserAsync({ username: Random.id(), email, password: Random.id() });
      await Accounts.sendResetPasswordEmail(userId, email);
      await Accounts.sendEnrollmentEmail(userId, email);
      await Accounts.sendVerificationEmail(userId, email);
      assert.lengthOf(messages, 3);
      for (const message of messages) {
        assert.include(message.html, Meteor.absoluteUrl());
        assert.notInclude(message.html, 'https://dicecloud.com');
        assert.notInclude(message.html, '#/');
      }
      assert.include(messages[0].html, Meteor.absoluteUrl('reset-password/'));
      assert.include(messages[1].html, Meteor.absoluteUrl('reset-password/'));
      assert.include(messages[2].html, Meteor.absoluteUrl('verify-email/'));
    } finally {
      Email.customTransport = original;
      if (userId) await Meteor.users.removeAsync(userId);
    }
  });
});
