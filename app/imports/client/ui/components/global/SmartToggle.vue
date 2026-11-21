<script setup lang="ts">
import { ref, useAttrs } from 'vue';
import { useSmartInput } from '/imports/client/ui/components/global/useSmartInput';
import OutlinedInput from '/imports/client/ui/properties/viewers/shared/OutlinedInput.vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  value?: string | number | Date | unknown[] | object | boolean;
  errorMessages?: string | string[];
  disabled?: boolean;
  debounce?: number;
  rules?: Array<(val: unknown) => string | true>;
  label?: string;
  options?: Array<{ value: unknown; name: string; icon?: string }>;
}>();

const emit = defineEmits<{
  change: [val: unknown, ack: (err?: unknown) => void];
  input: [val: unknown];
}>();

const attrs = useAttrs();
const { loading, errors, safeValue, isDisabled, change } = useSmartInput(props, emit, attrs);

const clickedValue = ref<unknown>(undefined);

function click(val: unknown) {
  clickedValue.value = val;
  change(val);
}
</script>

<template lang="html">
  <outlined-input :name="label" class="smart-toggle mb-4">
    <v-btn-toggle
      v-bind="$attrs"
      mandatory
      rounded="0"
      group
      :model-value="safeValue"
      color="accent"
      class="smart-toggle-options"
    >
      <v-btn
        v-for="(option, i) in options"
        :key="`toggle-option-${i}`"
        :value="option.value"
        :disabled="isDisabled || (clickedValue != option.value && loading)"
        :variant="clickedValue != option.value && loading ? 'plain' : undefined"
        :loading="clickedValue == option.value && loading"
        class="smart-toggle-option"
        v-on="
          value == option.value
            ? {}
            : {
                click() {
                  click(option.value);
                },
              }
        "
      >
        <v-icon v-if="option.icon" start>
          {{ option.icon }}
        </v-icon>
        {{ option.name }}
      </v-btn>
    </v-btn-toggle>
    <v-expand-transition>
      <div v-if="errors.length" class="pa-2 text-error">
        {{ errors.join("\n\n") }}
      </div>
    </v-expand-transition>
  </outlined-input>
</template>

<style scoped>
.smart-toggle {
  min-width: 0;
  width: 100%;
}
.smart-toggle-options {
  display: flex;
  flex-wrap: wrap;
  height: auto;
  min-height: 42px;
  max-width: 100%;
  gap: 4px;
  overflow: visible;
}
.smart-toggle-option {
  flex: 0 1 auto;
  height: auto !important;
  min-height: 42px;
  max-width: 100%;
}
.smart-toggle-option :deep(.v-btn__content) {
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.35;
  padding-block: 8px;
}
</style>
