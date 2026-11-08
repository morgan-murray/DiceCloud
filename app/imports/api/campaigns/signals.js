import { Mongo } from 'meteor/mongo';
export const CampaignSignals = new Mongo.Collection('campaignSignals');
export const InviteSignals = new Mongo.Collection('campaignInviteSignals');

import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
let lastUser;
if (Meteor.isClient) Tracker.autorun(() => {
 const current = Meteor.userId();
 if (lastUser && current !== lastUser) for (const key of Object.keys(sessionStorage)) if (key.startsWith('campaign-draft:')) sessionStorage.removeItem(key);
 lastUser = current;
});
