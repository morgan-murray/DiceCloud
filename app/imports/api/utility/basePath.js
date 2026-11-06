import { Meteor } from 'meteor/meteor';
import { rootConfiguration, withBasePath } from './urlPaths.mjs';

// Meteor publishes ROOT_URL to the client and derives DDP/storage prefixes from it.
export const { basePath } = rootConfiguration(Meteor.absoluteUrl());
export const appPath = path => withBasePath(path, basePath);
