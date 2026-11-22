<script setup lang="ts">
import { useAttrs } from 'vue';
import { useSmartInput } from '/imports/client/ui/components/global/useSmartInput';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  value?: string | number | Date | unknown[] | object | boolean;
  errorMessages?: string | string[];
  disabled?: boolean;
  debounce?: number;
  rules?: Array<(val: unknown) => string | true>;
}>();

const emit = defineEmits<{
  change: [val: unknown, ack: (err?: unknown) => void];
  input: [val: unknown];
}>();

const attrs = useAttrs();
const { loading, errors, safeValue, isDisabled, focused, change } = useSmartInput(props, emit, attrs);

// Older forms use text for labels. Newer options use Vuetify's title field.
function optionTitle(item: any) {
  return item?.title ?? item?.text ?? item;
}
</script>

<template lang="html">
  <v-select
    :item-title="optionTitle"
    v-bind="$attrs"
    :loading="loading"
    :error-messages="errors"
    :model-value="safeValue"
    :menu-props="{}"
    :disabled="isDisabled"
    variant="outlined"
    @update:model-value="change"
    @focus="focused = true"
    @blur="focused = false"
  >
    <template #prepend>
      <slot name="prepend" />
    </template>
    <template #prepend-inner>
      <slot name="prepend-inner" />
    </template>
  </v-select>
</template>
