<script setup lang="ts">
import { ref, computed, watch, inject } from 'vue';
import SheetCounter from './SheetCounter.vue';

const props = defineProps<{
  model: Record<string, any>;
}>();

const emit = defineEmits(['click', 'change', 'mouseover', 'mouseleave']);
const context = inject('context', {});

const optimisticIncrement = ref(0);

const optimisticValue = computed(() => props.model?.value + optimisticIncrement.value);

watch(() => props.model.value, () => {
  optimisticIncrement.value = 0;
});

function increment(value: number, ack?: Function) {
  emit('change', { type: 'increment', value, ack });
}
</script>

<template>
  <sheet-counter
    :label="model.name"
    :value="optimisticValue"
    :total="model.total || undefined"
    @mouseover="emit('mouseover')"
    @mouseleave="emit('mouseleave')"
    @click="emit('click', $event)"
  >
    <smart-btn
      icon
      size="small"
      variant="text"
      :disabled="(optimisticValue >= model.total && !model.ignoreUpperLimit) || context.editPermission === false"
      :aria-label="`Increase ${model.name}`"
      @clicks="(times, ack) => increment(times, ack)"
      @click="optimisticIncrement += 1"
    >
      <v-icon>mdi-chevron-up</v-icon>
    </smart-btn>
    <smart-btn
      icon
      size="small"
      variant="text"
      :disabled="(optimisticValue <= 0 && !model.ignoreLowerLimit) || context.editPermission === false"
      :aria-label="`Decrease ${model.name}`"
      @clicks="(times, ack) => increment(-1 * times, ack)"
      @click="optimisticIncrement -= 1"
    >
      <v-icon>mdi-chevron-down</v-icon>
    </smart-btn>
  </sheet-counter>
</template>
