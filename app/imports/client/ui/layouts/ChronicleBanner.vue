<script setup lang="ts">
import { appPath } from '/imports/api/utility/basePath';
defineProps<{ title: string; subtitle: string }>();
const artwork = appPath('images/themes/lance-chronicle/banner.png');
</script>

<template>
  <header class="chronicle-banner" data-id="chronicle-banner">
    <img :src="artwork" alt="" aria-hidden="true" class="chronicle-banner__art" decoding="async" fetchpriority="high">
    <div class="chronicle-banner__veil" aria-hidden="true" />
    <div class="chronicle-banner__copy">
      <p class="chronicle-banner__eyebrow">Lance Chronicle</p>
      <h1>{{ title }}</h1>
      <p class="chronicle-banner__subtitle">{{ subtitle }}</p>
    </div>
  </header>
</template>
