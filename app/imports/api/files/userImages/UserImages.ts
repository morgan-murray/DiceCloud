
import { incrementFileStorageUsed } from '/imports/api/users/methods/updateFileStorageUsed';
import assertUserHasFileSpace from '/imports/api/files/assertUserHasFileSpace';
let createS3FilesCollection;
if (Meteor.isServer) {
  createS3FilesCollection = require('/imports/api/files/server/s3FileStorage').createS3FilesCollection
} else {
  createS3FilesCollection = require('/imports/api/files/client/s3FileStorage').createS3FilesCollection
}

const UserImages = createS3FilesCollection({
  collectionName: 'userImages',
  storagePath: Meteor.isServer && process.env.DICECLOUD_STORAGE_PATH ? `${process.env.DICECLOUD_STORAGE_PATH}/userImages` : (Meteor.isDevelopment ? '../../../../../fileStorage/userImages' : 'assets/app/userImages'),
  async onBeforeUpload(file) {
    // Allow upload files under 30MB
    if (file.size > 30_000_000) {
      return 'Images must be less than 30MB';
    }
    // Make sure the user has enough space
    await assertUserHasFileSpace(Meteor.userId(), file.size);
    // Allow common image extensions
    if (!/gif|png|jpe?g|webp/i.test(file.extension || '')) {
      return 'Please upload an image file only';
    }
    return true
  },
  async onAfterUpload(file) {
    if (Meteor.isServer) await incrementFileStorageUsed(file.userId, file.size);
  }
});

import './methods';

export default UserImages;
