<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Meteor } from 'meteor/meteor';
import { sessionPageRole } from '/imports/api/campaigns/sessionJournal';

type Page = { _id: string; title: string; revision: number; kind: string };
const props = defineProps<{ campaignId: string; entries: Page[]; connected: boolean }>();
const emit = defineEmits(['close', 'saved']);
const pages = props.entries.filter(p => sessionPageRole(p));
const matching = (role: string) => pages.filter(p => sessionPageRole(p) === role);
const recaps = matching('recap'), schedules = matching('schedule');
const quests = [...matching('quest'), ...matching('tracker')];
const only = (rows: Page[]) => rows.length === 1 ? rows[0]._id : '';
const recapId = ref(only(recaps)), scheduleId = ref(only(schedules));
const active = quests.filter(p => p.kind.toLowerCase() === 'active quest');
const questId = ref(only(active) || only(quests));
const recap = ref(''), note = ref(''), mode = ref('Add a note');
const original = ref(''), questText = ref(''), loadedRevision = ref(0);
const plan = ref('Keep current plan'), date = ref(''), time = ref('');
const zone = ref(Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London');
const loading = ref(false), busy = ref(false), error = ref('');
let sequence = 0;
watch([questId, mode], async () => {
 const request = ++sequence;
 original.value = questText.value = ''; loadedRevision.value = 0; loading.value = false; error.value = '';
 if (!questId.value || mode.value !== 'Edit tracker text') return;
 loading.value = true;
 try {
  const page = await Meteor.callAsync('campaigns.entry', { campaignId: props.campaignId, entryId: questId.value });
  if (sequence !== request) return;
  if (!['quest','tracker'].includes(sessionPageRole(page))) throw new Error('Choose a shared quest page.');
  original.value = questText.value = page.body;
  loadedRevision.value = page.revision;
 } catch (e: any) { if (sequence === request) error.value = e.reason || e.message; }
 finally { if (sequence === request) loading.value = false; }
});
const editingText = computed(() => mode.value === 'Edit tracker text');
const questChanged = computed(() => editingText.value ? questText.value !== original.value : !!note.value.trim());
const hasChanges = computed(() => !!recap.value.trim() || questChanged.value || plan.value !== 'Keep current plan');
const canSave = computed(() => props.connected && !busy.value && !loading.value && hasChanges.value &&
 (!recap.value.trim() || !recaps.length || recapId.value) &&
 (!questChanged.value || ((!quests.length || questId.value) && (!editingText.value || (questText.value.trim() && (!questId.value || loadedRevision.value))))) &&
 (plan.value === 'Keep current plan' || ((!schedules.length || scheduleId.value) && (plan.value === 'To be arranged' || (date.value && (!time.value || zone.value.trim()))))));
function target(id: string) {
 return { entryId: id || null, revision: pages.find(p => p._id === id)?.revision || 0 };
}
function close() {
 if (!busy.value && (!hasChanges.value || window.confirm('Discard these unsaved session changes?'))) emit('close');
}
async function save() {
 if (!canSave.value) return;
 busy.value = true; error.value = '';
 try {
  const args: any = { campaignId: props.campaignId };
  if (recap.value.trim()) args.recap = { ...target(recapId.value), body: recap.value };
  if (questChanged.value) args.quest = editingText.value
    ? { ...target(questId.value), revision: loadedRevision.value, body: questText.value }
    : { ...target(questId.value), body: note.value, append: true };
  if (plan.value !== 'Keep current plan') args.schedule = { ...target(scheduleId.value), tba: plan.value === 'To be arranged', date: date.value, time: time.value, zone: zone.value };
  await Meteor.callAsync('campaigns.finishSession', args);
  emit('saved');
 } catch (e: any) { error.value = e.reason || e.message || 'Could not save the session.'; }
 finally { busy.value = false; }
}
</script>
<template>
 <v-dialog :model-value="true" max-width="720" scrollable persistent aria-labelledby="finish-session-heading" @keydown.esc="close">
  <v-card>
   <v-card-title id="finish-session-heading">Finish session</v-card-title>
   <v-card-text class="session-fields">
    <p>Only the sections you change will be saved to the shared Journal.</p>
    <section>
     <h3>Last session recap</h3>
     <v-select v-if="recaps.length > 1" v-model="recapId" label="Recap page" :items="recaps" item-title="title" item-value="_id" />
     <v-textarea v-model="recap" label="What happened this session?" rows="3" maxlength="48000" hide-details />
    </section>
    <section>
     <h3>Quest tracker</h3>
     <v-select v-if="quests.length" v-model="questId" :disabled="editingText && questChanged" label="Quest to update" :items="quests" item-title="title" item-value="_id" hide-details />
     <v-select v-model="mode" :disabled="questChanged" label="Update type" :items="['Add a note','Edit tracker text']" hide-details />
     <v-textarea v-if="!editingText" v-model="note" label="New lead, recovery or other progress" rows="2" maxlength="48000" hide-details />
     <v-textarea v-else v-model="questText" label="Tracker text" :disabled="loading || (!!questId && !loadedRevision)" :loading="loading" rows="7" maxlength="48000" hide-details />
    </section>
    <section>
     <h3>Next arranged game</h3>
     <v-select v-if="schedules.length > 1" v-model="scheduleId" label="Schedule page" :items="schedules" item-title="title" item-value="_id" hide-details />
     <v-radio-group v-model="plan" inline hide-details aria-label="Next game">
      <v-radio v-for="choice in ['Keep current plan','Set a date','To be arranged']" :key="choice" :label="choice" :value="choice" />
     </v-radio-group>
     <div v-if="plan === 'Set a date'" class="game-date">
      <v-text-field v-model="date" type="date" label="Game date" hide-details />
      <v-text-field v-model="time" type="time" label="Start time (optional)" hide-details />
     </div>
     <v-text-field v-if="plan === 'Set a date' && time" v-model="zone" label="Time zone" hide-details />
    </section>
    <v-alert v-if="error" type="error" role="alert">{{ error }}</v-alert>
    <v-alert v-if="!connected" type="warning">Reconnect to save these changes.</v-alert>
   </v-card-text>
   <v-card-actions><v-spacer/><v-btn :disabled="busy" @click="close">Cancel</v-btn><v-btn color="primary" variant="flat" :disabled="!canSave" :loading="busy" @click="save">Save session</v-btn></v-card-actions>
  </v-card>
 </v-dialog>
</template>
<style scoped>
.session-fields, .session-fields section { display: grid; gap: 12px; }
.session-fields section + section { margin-top: 8px; }
.game-date { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr)); gap: 12px; }
</style>
