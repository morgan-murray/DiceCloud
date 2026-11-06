import { appPath, basePath } from '/imports/api/utility/basePath';
Meteor.startup(() => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(appPath('sw.js'), { scope: basePath })
      .catch(error => console.log('ServiceWorker registration failed: ', error));
  }
});
