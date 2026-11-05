import { basePath } from '/imports/api/utility/basePath';

// Rspack defaults lazy JS/CSS chunks to the hostname root. Set its runtime
// path before Vue/router evaluation so one image works at root or a prefix.
__webpack_public_path__ = basePath;
