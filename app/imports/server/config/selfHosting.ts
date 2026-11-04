import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';

// Server-side account creation remains available for private administration.
// Client registration is an explicit deployment choice, disabled by default.
Accounts.config({
  forbidClientAccountCreation: Meteor.settings.private?.allowRegistration !== true,
});
