<script setup lang="ts">
import { computed } from 'vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { appPath } from '/imports/api/utility/basePath';

const props = defineProps<{
  markdown?: string;
}>();

const emit = defineEmits<{
  click: [e: MouseEvent];
}>();

const compiledMarkdown = computed(() => {
  if (!props.markdown) return;
  const template = document.createElement('template');
  template.innerHTML = DOMPurify.sanitize(marked(props.markdown) as string);
  template.content.querySelectorAll('[href], [src]').forEach(element => {
    for (const attribute of ['href', 'src']) {
      const value = element.getAttribute(attribute);
      if (value?.startsWith('/') && !value.startsWith('//')) element.setAttribute(attribute, appPath(value));
    }
  });
  return template.innerHTML;
});
</script>

<template lang="html">
  <!-- eslint-disable vue/no-v-html -->
  <div
    class="markdown"
    @click="e => $emit('click', e)"
    v-html="compiledMarkdown"
  />
</template>
