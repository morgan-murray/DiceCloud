<script setup lang="ts">
import useHasEventListener from '/imports/client/ui/utility/useHasEventListener';
import { ref, computed } from 'vue';
import CardHighlight from '/imports/client/ui/components/CardHighlight.vue';
import AttributeCardContent from '/imports/client/ui/properties/components/attributes/AttributeCardContent.vue';
import isDarkColor from '/imports/client/ui/utility/isDarkColor';

const props = defineProps<{
  model: Record<string, any>;
}>();

const emit = defineEmits(['click']);

const checkLoading = ref(false);
const hovering = ref(false);

const hasClickListener = useHasEventListener('click');

const isDark = computed(() => {
  if (!props.model.color) return undefined;
  return isDarkColor(props.model.color);
});

function click(e: Event) {
  emit('click', e);
}
</script>

<template lang="html">
  <v-card
    :hover="hasClickListener"
    :color="model.color"
    :theme="model.color ? (isDark ? 'dark' : 'light') : undefined"
    @click="click"
    @mouseover="hasClickListener ? hovering = true : undefined"
    @mouseleave="hasClickListener ? hovering = false : undefined"
  >
    <attribute-card-content :model="model" />
    <card-highlight :active="hasClickListener && hovering" />
  </v-card>
</template>
