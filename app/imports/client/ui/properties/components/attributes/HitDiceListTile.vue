<script setup lang="ts">
import { computed, inject } from 'vue';
import SheetCounter from './SheetCounter.vue';
import numberToSignedString from '/imports/api/utility/numberToSignedString';

const props = defineProps<{
  model: Record<string, any>;
}>();

const emit = defineEmits(['click', 'change']);
const context = inject('context', {});

const diceLabel = computed(() => [props.model.hitDiceSize, numberToSignedString(props.model.constitutionMod)]
  .filter(value => value != null).join(' '));

function increment(value: number) {
  emit('change', { type: 'increment', value });
}
</script>

<template>
  <sheet-counter
    class="hit-dice-list-tile"
    :label="diceLabel"
    :value="model.value"
    :total="model.total"
    @click="emit('click', $event)"
  >
    <v-btn
      icon
      size="small"
      variant="text"
      :disabled="model.value >= model.total || context.editPermission === false"
      :aria-label="`Increase ${model.name}`"
      @click="increment(1)"
    >
      <v-icon>mdi-chevron-up</v-icon>
    </v-btn>
    <v-btn
      icon
      size="small"
      variant="text"
      :disabled="model.value <= 0 || context.editPermission === false"
      :aria-label="`Decrease ${model.name}`"
      @click="increment(-1)"
    >
      <v-icon>mdi-chevron-down</v-icon>
    </v-btn>
  </sheet-counter>
</template>
