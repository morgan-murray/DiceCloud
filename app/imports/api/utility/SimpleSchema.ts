import MeteorSimpleSchema from 'meteor/aldeed:simple-schema';
import type NpmSimpleSchema from 'simpl-schema';

// Collection2 and nested schemas must share the same runtime constructor.
// Keep npm declarations for the typed wrapper, without bundling a second implementation.
type SimpleSchema = NpmSimpleSchema;
const SimpleSchema = MeteorSimpleSchema as typeof NpmSimpleSchema;
// Register tags before any schema can be constructed, including cold client imports.
SimpleSchema.extendOptions([
  'parseLevel', 'removeBeforeCompute', 'inlineCalculationField', 'computedField',
]);
export type * from 'simpl-schema';
export default SimpleSchema;
