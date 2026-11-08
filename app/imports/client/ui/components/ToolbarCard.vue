<script setup lang="ts">
import { ref, computed } from 'vue';
import isDarkColor from '/imports/client/ui/utility/isDarkColor';
import getThemeColor from '/imports/client/ui/utility/getThemeColor';
import useHasEventListener from '/imports/client/ui/utility/useHasEventListener';
import CardHighlight from '/imports/client/ui/components/CardHighlight.vue';

const props = withDefaults(defineProps<{
  color?: string;
  transparentToolbar?: boolean;
  wrapTitle?: boolean;
}>(), {
  color: () => getThemeColor('secondary'),
});

defineEmits(['click', 'toolbarclick']);
const hovering = ref(false);

const isDark = computed(() => isDarkColor(props.color));
const hasClickListener = useHasEventListener('click');
const hasToolbarClickListener = useHasEventListener('toolbarclick');

function hoverToolbar(val: boolean) {
  hovering.value = hasToolbarClickListener.value && val;
}
</script>

<template lang="html">
  <v-card
    :hover="hasClickListener"
    class="toolbar-card"
    :class="{'transparent-toolbar': transparentToolbar, 'wrap-title': wrapTitle, hovering}"
    :elevation="hovering ? 8 : undefined"
    @click="$emit('click')"
  >
    <v-toolbar
      flat
      :style="`transform: none; ${hasToolbarClickListener ? 'cursor: pointer;' : ''}`"
      :class="{}"
      :color="transparentToolbar ? undefined : color"
      :theme="transparentToolbar ? undefined : (isDark ? 'dark' : 'light')"
      @click="$emit('toolbarclick')"
      @mouseover="hoverToolbar(true)"
      @mouseleave="hoverToolbar(false)"
    >
      <slot name="toolbar" />
    </v-toolbar>
    <div>
      <slot />
    </div>
    <card-highlight :active="hovering" />
  </v-card>
</template>

<style lang="css">
.toolbar-card.wrap-title > .v-toolbar,
.toolbar-card.wrap-title > .v-toolbar .v-toolbar__content {
  height: auto !important;
  min-height: 64px;
}
.toolbar-card.wrap-title > .v-toolbar .v-toolbar__content {
  padding: 12px 16px;
}
.toolbar-card.wrap-title .v-toolbar-title__placeholder {
  white-space: normal;
  overflow-wrap: anywhere;
}

.toolbar-card .v-toolbar__title {
  font-size: 15px;
}

.toolbar-card {
  transition: box-shadow .4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.toolbar-card.transparent-toolbar .v-theme--dark.v-toolbar.v-sheet {
  background-color: #303030;
}
</style>
