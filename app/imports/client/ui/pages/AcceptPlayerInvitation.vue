<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { autorun } from 'vue-meteor-tracker';
import { useRoute, useRouter } from 'vue-router';
import { SHA256 } from 'meteor/sha';
const route = useRoute(), router = useRouter();
const invitation = ref<any>(null), loading = ref(true), busy = ref(false), error = ref(''), created = ref(false);
const password = ref(''), confirmation = ref('');
const { result: userId } = autorun(() => Meteor.userId());
const signedIn = computed(() => Boolean(userId.value));
const token = computed(() => String(route.params.token || ''));
let previewVersion = 0;
watch(token, async value => {
  const version = ++previewVersion;
  loading.value = true; invitation.value = null; error.value = '';
  password.value = ''; confirmation.value = '';
  try {
    const result = await Meteor.callAsync('playerInvitations.preview', { token: value });
    if (version === previewVersion) invitation.value = result;
  } catch {
    if (version === previewVersion) error.value = 'This invitation is invalid, expired or already used. Ask your friend for a new link.';
  } finally { if (version === previewVersion) loading.value = false; }
}, { immediate: true });
async function signOut() {
  busy.value = true;
  try { await new Promise<void>((resolve, reject) => Meteor.logout((e: any) => e ? reject(e) : resolve())); }
  catch { error.value = 'Could not sign out. Please try again.'; }
  finally { busy.value = false; }
}
async function accept() {
  error.value = '';
  if (password.value.length < 8) { error.value = 'Choose a password of at least eight characters.'; return; }
  if (password.value !== confirmation.value) { error.value = 'Passwords do not match.'; return; }
  busy.value = true;
  try {
    const result = await Meteor.callAsync('playerInvitations.accept', { token: token.value, password: { digest: SHA256(password.value), algorithm: 'sha-256' } });
    created.value = true;
    await new Promise<void>((resolve, reject) => Meteor.loginWithPassword(result.username, password.value, (e: any) => e ? reject(e) : resolve()));
    await router.replace('/character-list');
  } catch (e: any) { error.value = created.value ? 'Your account has been created. Sign in with the password you chose.' : e.reason || 'The invitation could not be accepted. Ask for a new link.'; }
  finally { password.value = ''; confirmation.value = ''; busy.value = false; }
}
</script>

<template>
  <v-container class="accept-invitation">
    <v-card>
      <v-card-title>Join DiceCloud</v-card-title>
      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate aria-label="Loading invitation" />
        <template v-else-if="invitation && !created">
          <p class="mb-4">Choose a password for <strong>{{ invitation.username }}</strong>. Your friend will not see your password.</p>
          <template v-if="signedIn">
            <p class="mb-4">Sign out of your current account before accepting this invitation.</p>
            <v-btn :loading="busy" @click="signOut">Sign out</v-btn>
          </template>
          <form v-else @submit.prevent="accept">
            <v-text-field v-model="password" label="Password" type="password" autocomplete="new-password" hint="At least eight characters" persistent-hint variant="outlined" :disabled="busy" />
            <v-text-field v-model="confirmation" label="Password again" type="password" autocomplete="new-password" variant="outlined" :disabled="busy" />
            <v-btn type="submit" color="primary" :loading="busy" :disabled="!password || !confirmation">Create account</v-btn>
          </form>
        </template>
        <v-alert v-if="error" type="error" class="mt-4">{{ error }}</v-alert>
        <v-btn v-if="created || (!loading && !invitation)" to="/sign-in" variant="text" class="mt-4">Sign in</v-btn>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<style scoped>
.accept-invitation { max-width: 560px; padding-block: 24px; }
.accept-invitation :deep(.v-card-title) { white-space: normal; }
</style>
