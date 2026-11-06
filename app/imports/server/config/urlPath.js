import { WebAppInternals } from 'meteor/webapp';
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { appPath, basePath } from '/imports/api/utility/basePath';
import { accountLink } from '/imports/api/utility/urlPaths.mjs';

WebAppInternals.registerBoilerplateDataCallback('dicecloud-url-prefix', (request, data) => {
  data.head = `<base href="${basePath}">` + data.head.replace(
    /\b(href|src|content)="(\/(?!\/)[^"]*)"/g,
    (match, attribute, path) => `${attribute}="${appPath(path)}"`,
  );
});

for (const kind of ['resetPassword', 'enrollAccount', 'verifyEmail']) {
  Accounts.urls[kind] = token => accountLink(Meteor.absoluteUrl(), kind, token);
}
