import SimpleSchema from '/imports/api/utility/SimpleSchema';

const SCHEMA_OPTIONS = {
  clean: {
    filter: true,
    autoConvert: true,
    removeEmptyStrings: true,
    trimStrings: false,
    getAutoValues: true,
    removeNullsFromArrays: true,
  },
};

export default SCHEMA_OPTIONS;
