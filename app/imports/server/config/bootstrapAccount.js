import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { promises as fs } from 'node:fs';

// One-time, private provisioning. Neither input nor setup token is logged or
// exposed through a method/publication. Remove the temporary mount after use.
if (process.env.DICECLOUD_BOOTSTRAP_ACCOUNT_FILE) {
  Meteor.startup(async () => {
    const { username, email } = JSON.parse(await fs.readFile(process.env.DICECLOUD_BOOTSTRAP_ACCOUNT_FILE, 'utf8'));
    const resultPath = process.env.DICECLOUD_BOOTSTRAP_RESULT_FILE;
    if (!resultPath || typeof username !== 'string' || typeof email !== 'string' || !email.includes('@')) {
      throw new Error('Invalid private account provisioning configuration');
    }
    const existing = await Meteor.users.findOneAsync({ $or: [{ username }, { 'emails.address': email }] });
    if (existing) {
      // Repeated startup must never reset an existing account's credentials.
      if (existing.username !== username || !existing.emails?.some(item => item.address === email)) {
        throw new Error('Account provisioning conflicts with an existing user');
      }
      return;
    }
    const userId = await Accounts.createUserAsync({ username, email });
    const { token } = await Accounts.generateResetToken(userId, email, 'enrollAccount');
    await fs.writeFile(resultPath, JSON.stringify({ username, email, setupUrl: Accounts.urls.enrollAccount(token) }), { mode: 0o600, flag: 'wx' });
  });
}
