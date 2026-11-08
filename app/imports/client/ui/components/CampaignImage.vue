<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue';
import { Meteor } from 'meteor/meteor';
const props = defineProps<{ campaignId: string; assetId: string; version: number; alt?: string; original?: boolean }>();
const src = ref(''), failed = ref(false); let request = 0;
watch(() => [props.campaignId, props.assetId, props.version, props.original], async () => {
 const n = ++request; src.value = ''; failed.value = false;
 try { const image: any = await Meteor.callAsync('campaigns.image', { campaignId: props.campaignId, assetId: props.assetId, original: Boolean(props.original) }); if (n === request) src.value = `data:${image.mime};base64,${image.data}`; }
 catch { if (n === request) failed.value = true; }
}, { immediate: true });
onBeforeUnmount(() => { request++; src.value = ''; });
</script>
<template><img v-if="src" :src="src" :alt="alt || 'Campaign artwork'" loading="lazy" /><span v-else class="campaign-image-placeholder" role="status">{{ failed ? 'Artwork unavailable' : 'Loading artwork…' }}</span></template>
