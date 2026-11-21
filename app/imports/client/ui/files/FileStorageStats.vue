<script setup lang="ts">
import { ref, computed } from 'vue';
import { autorun } from 'vue-meteor-tracker';
import { getUserTier } from '/imports/api/users/patreon/tiers';
import { snackbar } from '/imports/client/ui/components/snackbars/SnackbarQueue';
import updateFileStorageUsed from '/imports/api/users/methods/updateFileStorageUsed';
import prettyBytes from 'pretty-bytes';

const updateStorageUsedLoading = ref(false);

const { result: storageUsed } = autorun(() => Meteor.user()?.fileStorageUsed || 0);
const { result: storageAllowed } = autorun(() => getUserTier(Meteor.userId()).fileStorage * 1000000);

const percentFileStorageUsed = computed(() =>
  Math.round(((storageUsed.value ?? 0) / (storageAllowed.value ?? 1)) * 100)
);

async function updateStorageUsedFn() {
  updateStorageUsedLoading.value = true;
  try {
    await updateFileStorageUsed.callAsync();
  } catch (error: any) {
    snackbar({ text: error.reason });
  }
  updateStorageUsedLoading.value = false;
}
</script>

<template>
  <div
    class="file-storage-stats d-flex flex-column justify-center align-center"
  >
    <v-progress-circular
      :rotate="-90"
      :size="100"
      :width="15"
      :model-value="percentFileStorageUsed"
      :buffer-value="50"
      color="accent"
    >
      {{ percentFileStorageUsed }}%
    </v-progress-circular>
    <div class="storage-caption">
      {{ prettyBytes(storageUsed) }} / {{ prettyBytes(storageAllowed) }}
      <v-btn
        icon
        @click="updateStorageUsedFn"
        :loading="updateStorageUsedLoading"
        aria-label="Refresh file storage usage"
      >
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.file-storage-stats {
  min-width: 0;
  padding: 16px;
}
.storage-caption {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 12px;
  text-align: center;
}
</style>
