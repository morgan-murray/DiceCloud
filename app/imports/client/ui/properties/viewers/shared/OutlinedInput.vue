<script setup lang="ts">
withDefaults(
  defineProps<{
    name?: string;
  }>(),
  {
    name: undefined,
  },
);
</script>

<template>
  <fieldset
    class="outlined-input rounded v-sheet--outlined"
    @click="$emit('click', $event)"
    @dragover="$emit('dragover', $event)"
    @drop="$emit('drop', $event)"
    @dragleave="$emit('dragleave', $event)"
  >
    <legend v-if="name" class="text-caption px-1 ml-2 name">
      {{ name }}
    </legend>
    <slot />
  </fieldset>
</template>

<style scoped>
.outlined-input {
  min-inline-size: 0;
  max-width: 100%;
  margin: 0;
  padding: 12px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.38);
  transition: border-color 0.15s ease;
}
.outlined-input:not(.no-hover):hover {
  border-color: rgba(var(--v-theme-on-surface), 0.86);
}
.outlined-input .name {
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.8);
}
</style>
