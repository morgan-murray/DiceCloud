<script setup lang="ts">
import { ref, onMounted } from 'vue';
const allowed = ref(false), open = ref(false), busy = ref(false), error = ref(''), copied = ref(false);
const username = ref(''), email = ref(''), setupLink = ref('');
const rows = ref<any[]>([]);
const labels: Record<string, string> = { pending: 'Not yet used', expired: 'Expired', revoked: 'Revoked', claiming: 'Being accepted', accepted: 'Joined' };
const call = (name: string, request?: unknown) => Meteor.callAsync('playerInvitations.' + name, request);
async function refresh() { rows.value = await call('list'); }
onMounted(async () => {
  try { allowed.value = (await call('status')).canInvite; if (allowed.value) await refresh(); }
  catch { /* Settings remains available if invitation permissions cannot be loaded. */ }
});
function start() { username.value = ''; email.value = ''; setupLink.value = ''; error.value = ''; copied.value = false; open.value = true; }
async function act(name: string, request: unknown) {
  busy.value = true; error.value = ''; copied.value = false;
  try {
    const result = await call(name, request);
    if (result?.url) { setupLink.value = result.url; open.value = true; }
    await refresh();
  } catch (e: any) { error.value = e.reason || e.message; }
  finally { busy.value = false; }
}
async function copyLink() {
  try { await navigator.clipboard.writeText(setupLink.value); copied.value = true; }
  catch { error.value = 'Select and copy the link below.'; }
}
</script>

<template>
  <v-card v-if="allowed" class="settings-card profile-card player-invitations">
    <v-card-title>Players</v-card-title>
    <v-card-text>
      <p class="mb-4">Create an invitation link for a friend. They choose their own password. Links expire after seven days and can only be used once. No characters or campaigns are shared automatically.</p>
      <v-btn color="primary" prepend-icon="mdi-account-plus" @click="start">Invite player</v-btn>
      <v-alert v-if="error && !open" type="error" class="mt-4">{{ error }}</v-alert>
      <div v-for="row in rows" :key="row._id" class="invitation-row">
        <div class="invitation-person">
          <strong>{{ row.username }}</strong>
          <div>{{ row.email }}</div>
          <div class="text-caption">{{ labels[row.state] }}<span v-if="row.state === 'pending'"> · Expires {{ new Date(row.expiresAt).toLocaleDateString() }}</span></div>
        </div>
        <div v-if="['pending', 'expired'].includes(row.state)" class="invitation-actions">
          <v-btn variant="text" :disabled="busy" @click="act('replace', { id: row._id })">Replace link</v-btn>
          <v-btn variant="text" color="error" :disabled="busy" @click="act('revoke', { id: row._id })">Revoke</v-btn>
        </div>
      </div>
    </v-card-text>
    <v-dialog v-model="open" max-width="600" :persistent="busy">
      <v-card class="invite-dialog">
        <v-card-title>Invite player</v-card-title>
        <v-card-text>
          <template v-if="!setupLink">
            <p class="mb-4">Choose a username and enter your friend's email address. No email is sent automatically; you can share the link yourself.</p>
            <v-text-field v-model="username" label="Player username" autocomplete="off" variant="outlined" maxlength="30" :disabled="busy" />
            <v-text-field v-model="email" label="Player email" type="email" autocomplete="off" variant="outlined" maxlength="254" :disabled="busy" />
          </template>
          <template v-else>
            <p class="mb-4">Send this private link to your friend. It expires in seven days. Replacing or revoking the link makes this copy stop working.</p>
            <v-textarea :model-value="setupLink" label="Invitation link" readonly auto-grow rows="2" variant="outlined" />
            <v-btn prepend-icon="mdi-content-copy" variant="outlined" @click="copyLink">{{ copied ? 'Copied' : 'Copy link' }}</v-btn>
          </template>
          <v-alert v-if="error" type="error" class="mt-4">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="busy" @click="open = false">{{ setupLink ? 'Done' : 'Cancel' }}</v-btn>
          <v-btn v-if="!setupLink" color="primary" :loading="busy" :disabled="!username.trim() || !email.trim()" @click="act('create', { username, email })">Create invitation</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.invitation-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.invitation-person { min-width: 0; overflow-wrap: anywhere; }
.invitation-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.invite-dialog :deep(.v-card-title) { white-space: normal; }
.invite-dialog :deep(.v-card-actions) { flex-wrap: wrap; gap: 4px; }
</style>
