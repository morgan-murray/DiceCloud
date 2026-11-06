<script setup>
import { ref, onMounted } from 'vue';
import { Meteor } from 'meteor/meteor';
import DialogBase from '/imports/client/ui/dialogStack/DialogBase.vue';
const emit = defineEmits(['pop']);
const status = ref(), packs = ref([]), history = ref([]), selected = ref([]), character = ref(), content = ref([]), packName = ref('My Aurora content');
const busy = ref(false), error = ref(''), diagnostics = ref([]), preview = ref(), acknowledged = ref(false), cancelled = ref(false);
async function call(name, request) { return Meteor.callAsync('aurora.' + name, request); }
async function reload() { const records = await call('list'); packs.value = records.packs; history.value = records.history; }
onMounted(async () => { try { status.value = await call('status'); if (status.value.enabled) await reload(); } catch(e) { error.value = e.reason || e.message; } });
async function fileData(file, max) {
  if (!file || file.size > max) throw new Error('The selected file exceeds its size limit.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { name: file.name, data: btoa(binary) };
}
async function work(fn) {
  busy.value = true; error.value = ''; diagnostics.value = []; cancelled.value = false;
  try { await fn(); } catch(e) { error.value = e.reason || e.message; } finally { busy.value = false; }
}
async function uploadPack() {
  await work(async () => {
    const files = []; for (const file of content.value) files.push(await fileData(file, 4 * 1024 ** 2));
    const result = await call('addPack', { name: packName.value, files });
    if (!result.ok) { diagnostics.value = result.diagnostics; return; }
    await reload(); selected.value = [...selected.value, result.packId]; content.value = [];
  });
}
async function makePreview() {
  preview.value = undefined; acknowledged.value = false;
  await work(async () => {
    const result = await call('preview', { character: await fileData(character.value, 2 * 1024 ** 2), packIds: selected.value });
    if (!result.ok) { diagnostics.value = result.diagnostics; return; }
    if (cancelled.value) { await call('remove', { kind: 'job', id: result.previewId }); return; }
    preview.value = result;
  });
}
async function cancelPreview() {
  cancelled.value = true;
  if (preview.value) await work(async () => { await call('remove', { kind: 'job', id: preview.value.previewId }); preview.value = undefined; });
}
async function commit() {
  await work(async () => {
    const result = await call('commit', { previewId: preview.value.previewId, commitKey: preview.value.commitKey, acknowledgedCodes: preview.value.snapshot.diagnostics.map(d => d.code) });
    emit('pop', result.creatureId);
  });
}
async function remove(kind, id) { await work(async () => { await call('remove', { kind, id }); selected.value = selected.value.filter(p => p !== id); await reload(); }); }
</script>
<template>
  <dialog-base>
    <template #toolbar><v-toolbar-title>Import an Aurora character</v-toolbar-title></template>
    <div aria-live="polite">
      <v-alert v-if="error" type="error" class="mb-4">{{ error }}</v-alert>
      <v-alert v-if="status && !status.enabled" type="info">Aurora imports are currently unavailable.</v-alert>
      <template v-if="status?.enabled">
        <p class="mb-4">Import a 2014 Aurora .dnd5e sheet as a current-sheet snapshot. You can edit the result in DiceCloud; future level-up and conditional effects require manual review.</p>
        <v-alert type="info" class="mb-4">
          Built in: {{ status.builtin.name }}, version {{ status.builtin.version }} (CC-BY-4.0).
          This core pack provides common proficiencies and compatibility definitions. Classes, spells and other missing content require your private XML packs.
        </v-alert>
        <v-expansion-panels class="mb-4" :disabled="busy || !!preview">
          <v-expansion-panel title="Manage private content and import history">
            <v-expansion-panel-text>
              <p>Private sources have a separate 20 MiB allowance. Removing a pack or history record keeps existing character snapshots intact.</p>
              <v-text-field v-model="packName" label="Private pack name" maxlength="128" />
              <v-file-input v-model="content" label="Aurora XML or ZIP files (4 MiB per file)" accept=".xml,.zip" multiple />
              <v-btn :disabled="busy || !content.length" @click="uploadPack">Save private pack</v-btn>
              <v-list>
                <v-list-item v-for="pack in packs" :key="pack._id" :title="pack.name" :subtitle="`${pack.manifest.elementCount} definitions`">
                  <template #append><v-btn variant="text" :aria-label="`Delete pack ${pack.name}`" @click="remove('pack', pack._id)">Delete pack</v-btn></template>
                </v-list-item>
                <v-list-item v-for="record in history" :key="record._id" title="Saved import source" :subtitle="new Date(record.createdAt).toLocaleString()">
                  <template #append><v-btn variant="text" @click="remove('job', record._id)">Delete source</v-btn></template>
                </v-list-item>
              </v-list>
              <p class="text-caption">This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.</p>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
        <template v-if="!preview">
          <v-select v-model="selected" :items="packs" item-title="name" item-value="_id" multiple label="Additional private packs (optional)" :disabled="busy" />
          <v-file-input v-model="character" accept=".dnd5e,.xml" label="Aurora character file (maximum 2 MiB)" :disabled="busy" />
          <v-btn :disabled="busy || !character" color="primary" data-id="aurora-preview" @click="makePreview">Preview character</v-btn>
        </template>
        <v-progress-linear v-if="busy" indeterminate aria-label="Processing Aurora import" class="my-4" />
        <v-alert v-for="(diagnostic, index) in diagnostics" :key="index" type="error" class="my-2">{{ diagnostic.code }}: {{ diagnostic.message }}</v-alert>
        <template v-if="preview">
          <h2>{{ preview.snapshot.identity.name }}</h2>
          <p>Level {{ preview.snapshot.identity.level }} · AC {{ preview.snapshot.armorClass }} · HP {{ preview.snapshot.hitPoints.maximum }} · initiative {{ preview.snapshot.initiative }}</p>
          <v-table density="compact"><thead><tr><th>Ability</th><th>Score</th></tr></thead><tbody><tr v-for="(value, ability) in preview.snapshot.abilities" :key="ability"><td>{{ ability }}</td><td>{{ value }}</td></tr></tbody></v-table>
          <p class="my-2">{{ preview.snapshot.inventory.length }} items · {{ preview.snapshot.features.length }} features · {{ preview.snapshot.spellcasting.length }} spellcasting lists. Preview expires {{ new Date(preview.expiresAt).toLocaleTimeString() }}.</p>
          <v-alert v-for="warning in preview.snapshot.diagnostics" :key="warning.code" type="warning" class="my-2">{{ warning.message }}</v-alert>
          <p class="text-caption">Reference pack {{ preview.snapshot.provenance.builtin.version }} · source fingerprint {{ preview.snapshot.provenance.sourceHash.slice(0,12) }} · content fingerprint {{ preview.snapshot.provenance.contentHash.slice(0,12) }}. Full provenance stays on the imported sheet.</p>
          <v-checkbox v-model="acknowledged" label="I have reviewed the warnings and agree to initialize HP and resources to full." :disabled="busy" />
          <v-btn color="primary" data-id="aurora-commit" :disabled="busy || !acknowledged" @click="commit">Import this snapshot</v-btn>
          <v-btn variant="text" :disabled="busy" @click="cancelPreview">Discard preview</v-btn>
        </template>
      </template>
    </div>
    <template #actions><v-btn variant="text" :disabled="busy" @click="cancelPreview().then(() => emit('pop'))">Close</v-btn></template>
  </dialog-base>
</template>
