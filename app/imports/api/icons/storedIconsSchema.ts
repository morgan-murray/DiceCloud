import { TypedSimpleSchema } from '/imports/api/utility/TypedSimpleSchema';

const storedIconsSchema = TypedSimpleSchema.from({
  name: {
    type: String,
  },
  shape: {
    type: String,
  },
});

export { storedIconsSchema };
