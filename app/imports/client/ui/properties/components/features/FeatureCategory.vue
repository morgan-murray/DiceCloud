<script setup lang="ts">
import { featureLabel } from './featureCategories.mjs';
defineProps<{ expanded: boolean; group: { key: string; title: string; icon: string; features: Record<string, any>[] } }>();
const emit = defineEmits<{ select: [feature: Record<string, any>]; 'update:expanded': [open: boolean] }>();
function toggle(event: Event) { emit('update:expanded', (event.currentTarget as HTMLDetailsElement).open); }
</script>

<template>
  <v-card class="feature-category">
    <details :data-id="`feature-group-${group.key}`" :open="expanded" @toggle="toggle">
      <summary>
        <v-icon :icon="group.icon" size="22" aria-hidden="true" />
        <span class="feature-category__title">{{ group.title }}</span>
        <span class="feature-category__count">{{ group.features.length }}</span>
        <v-icon class="feature-category__chevron" icon="mdi-chevron-down" size="22" aria-hidden="true" />
      </summary>
      <ul class="feature-category__list" :aria-label="group.title">
        <li v-for="feature in group.features" :key="feature._id">
          <button
            :id="feature._id"
            type="button"
            :data-id="feature._id"
            :aria-label="`Open feature: ${feature.name || 'Unnamed feature'}`"
            @click="$emit('select', feature)"
          >
            <span>{{ featureLabel(feature, group.key) }}</span>
            <v-icon icon="mdi-chevron-right" size="18" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </details>
  </v-card>
</template>

<style scoped>
.feature-category summary { display: flex; align-items: center; gap: 10px; padding: 16px; cursor: pointer; list-style: none; background: rgba(var(--v-theme-primary), .08); }
.feature-category summary::-webkit-details-marker { display: none; }
.feature-category__title { flex: 1; min-width: 0; font-size: 1.05rem; font-weight: 600; overflow-wrap: anywhere; }
.feature-category__count { border-radius: 16px; padding: 2px 9px; font-size: .85rem; background: rgba(var(--v-theme-primary), .12); }
.feature-category__chevron { transition: transform .15s; }
.feature-category details[open] .feature-category__chevron { transform: rotate(180deg); }
.feature-category__list { list-style: none; padding: 6px; max-height: 22rem; overflow-y: auto; }
.feature-category__list button { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 12px; text-align: left; padding: 10px; border-radius: 4px; color: inherit; cursor: pointer; }
.feature-category__list button span { min-width: 0; overflow-wrap: anywhere; }
.feature-category__list button:hover { background: rgba(var(--v-theme-primary), .08); }
.feature-category summary:focus-visible, .feature-category__list button:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
@media (prefers-reduced-motion: reduce) { .feature-category__chevron { transition: none; } }
</style>
