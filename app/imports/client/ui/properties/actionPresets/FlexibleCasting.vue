<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import { Meteor } from 'meteor/meteor';
import { slotCosts } from '/imports/api/classAbilities/physical.mjs';

const props = defineProps<{ creatureId: string; level?: number; hasPool: boolean; slots: any[] }>();
const context = inject('context', { editPermission: false });
const remaining = ref(''), busy = ref(false), message = ref('');
const mode = ref('Create a slot'), selectedLevel = ref(1);
const creating = computed(() => mode.value === 'Create a slot');
const availableLevels = computed(() => creating.value ? [1, 2, 3, 4, 5]
  : [...new Set<number>(props.slots.map(p => p.spellSlotLevel.value))].sort((a, b) => a - b));
const level = computed(() => availableLevels.value.includes(selectedLevel.value)
  ? selectedLevel.value : availableLevels.value[0]);
const matchingSlots = computed(() => props.slots.filter(p => p.spellSlotLevel.value === level.value));
const validBalance = computed(() => props.level && remaining.value !== '' && Number.isInteger(Number(remaining.value))
  && Number(remaining.value) >= 0 && Number(remaining.value) <= props.level);

async function createPool() {
  if (!context.editPermission || busy.value || !validBalance.value || props.hasPool) return;
  busy.value = true;
  try {
    await Meteor.callAsync('classAbilities.createSorceryPool', { creatureId: props.creatureId, remaining: Number(remaining.value) });
    message.value = 'Sorcery points added to Stats.';
  } catch (e: any) { message.value = e.reason || 'Check your sorcery points under Stats.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="casting">
    <p>Use a bonus action on your turn to exchange sorcery points and a spell slot. Adjust both counters in Stats.</p>
    <v-select v-model="mode" label="Exchange" :items="['Create a slot', 'Convert a slot to points']" variant="outlined" hide-details />
    <v-select v-if="availableLevels.length" :model-value="level" label="Slot level" :items="availableLevels"
      variant="outlined" hide-details @update:model-value="selectedLevel = $event" />
    <p v-if="creating">Spend <strong>{{ slotCosts[level] }} sorcery points</strong> and gain one level {{ level }} slot. A created slot expires at your next long rest.</p>
    <p v-else-if="level">Spend one level {{ level }} slot and gain <strong>{{ level }} {{ level === 1 ? 'sorcery point' : 'sorcery points' }}</strong><template v-if="props.level">, up to {{ props.level }} points in total</template>.</p>
    <p v-else>Add a levelled spell-slot counter in Stats to convert a slot.</p>
    <p v-if="creating && matchingSlots.some(slot => slot.value >= slot.total)" class="text-body-2">To record an extra slot above the normal maximum, enable “Can be incremented above total” on the slot counter.</p>
    <p v-for="slot in matchingSlots" :key="slot._id" class="text-body-2">{{ slot.name }} · {{ slot.value }} of {{ slot.total }} remaining</p>
    <template v-if="!hasPool && context.editPermission && props.level">
      <p>If you already track these points in Stats, tag that resource <code>sorceryPoints</code>. Otherwise enter your current balance to start tracking them here.</p>
      <v-text-field v-model="remaining" type="number" :label="'Sorcery points remaining (0–' + props.level + ')'"
        min="0" :max="props.level" step="1" variant="outlined" hide-details />
      <v-btn variant="tonal" :disabled="!validBalance || busy" :loading="busy" @click="createPool">Create sorcery point pool</v-btn>
    </template>
    <p v-if="message" role="status">{{ message }}</p>
  </div>
</template>
<style scoped>
.casting { display: grid; gap: 10px; }
</style>
