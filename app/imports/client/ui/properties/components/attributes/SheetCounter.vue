<script setup lang="ts">
defineProps<{
  label: string;
  value: number;
  total?: number;
}>();
defineEmits(['click']);
</script>

<template>
  <div class="sheet-counter">
    <button
      type="button"
      class="counter-details"
      @click="$emit('click', $event)"
    >
      <span class="counter-label">{{ label }}</span>
      <span class="counter-amount">
        <span>{{ value }}</span>
        <span v-if="total != null" class="counter-total">/ {{ total }}</span>
      </span>
    </button>
    <div class="counter-controls">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.sheet-counter {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
}
.counter-details {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: start;
  color: inherit;
  overflow-wrap: anywhere;
}
.counter-details:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.counter-label {
  line-height: 1.3;
}
.counter-amount {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  column-gap: 0.25em;
  font-size: 1.5rem;
  font-variant-numeric: tabular-nums;
  line-height: 1.2;
}
.counter-total {
  font-size: 1rem;
  opacity: 0.75;
}
.counter-controls {
  display: grid;
  gap: 2px;
}
</style>
