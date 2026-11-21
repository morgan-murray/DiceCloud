<script setup lang="ts">
import { ref, computed } from 'vue';
import { useStore } from 'vuex';
import { useRouter } from 'vue-router';
import { autorun, subscribe } from 'vue-meteor-tracker';
import getEntitledCents from '/imports/api/users/patreon/getEntitledCents';
import Invites from '/imports/api/users/Invites';
import linkWithPatreon from '/imports/api/users/methods/linkWithPatreon';
import { getUserTier } from '/imports/api/users/patreon/tiers';
import addEmail from '/imports/api/users/methods/addEmail';
import removeEmail from '/imports/api/users/methods/removeEmail';
import CreatureStorageStats from '/imports/client/ui/creature/creatureList/CreatureStorageStats.vue';
import FileStorageStats from '/imports/client/ui/files/FileStorageStats.vue';
import { key } from '/imports/client/ui/vuexStore';
import { setDarkMode as setUserDarkMode } from '/imports/api/users/Users';

const store = useStore(key);
const router = useRouter();

const { result: user } = autorun(() => Meteor.user());
const googleAccount = computed(() => (user.value as any)?.services?.google);
const emails = computed(() => (user.value as any)?.emails);
const darkMode = computed(() => (user.value as any)?.darkMode);

const { result: invites } = autorun(() => {
  const usernames: Record<string, string> = {};
  Meteor.users.find({}).forEach((u: any) => {
    usernames[u._id] = u.username;
  });
  return Invites.find({
    inviter: Meteor.userId(),
  }, {
    sort: { dateConfirmed: 1, invitee: -1 },
  }).map((invite: any) => {
    invite.inviteeName = usernames[invite.invitee];
    return invite;
  });
});

subscribe(() => [
  'userPublicProfiles',
  invites.value?.map((i: any) => i.invitee).filter(Boolean) ?? [],
]);

const entitledCents = computed(() => getEntitledCents(user.value));
const tier = computed(() => {
  if (!user.value) return {};
  return getUserTier(user.value);
});

const showApiKey = ref(false);
const signOutBusy = ref(false);
const apiKeyGenerationError = ref<string | null>(null);
const emailVerificationError = ref<string | null>(null);
const linkGoogleError = ref('');
const linkPatreonError = ref('');
const updatePatreonError = ref('');
const updatePatreonLoading = ref(false);
const showEmailInput = ref(false);
const addEmailLoading = ref(false);
const inputEmail = ref('');
const addEmailError = ref<string | undefined>(undefined);
const removeEmailLoading = ref<string | undefined>(undefined);
const removeEmailError = ref<string | undefined>(undefined);

function changeUsername() {
  store.commit('pushDialogStack', {
    component: 'username-dialog',
    elementId: 'username',
  });
}

function clearEmailInput() {
  showEmailInput.value = false;
  addEmailError.value = undefined;
  inputEmail.value = '';
}

async function addEmailAddress() {
  addEmailLoading.value = true;
  try {
    await addEmail.callAsync({ email: inputEmail.value });
    showEmailInput.value = false;
    inputEmail.value = '';
  } catch (error: any) {
    addEmailError.value = error?.message;
  }
  addEmailLoading.value = false;
}

async function removeEmailAddress(address: string) {
  removeEmailLoading.value = address;
  try {
    await removeEmail.callAsync({ email: address });
    removeEmailError.value = undefined;
    showEmailInput.value = false;
    inputEmail.value = '';
  } catch (error: any) {
    removeEmailError.value = error?.message;
  }
  removeEmailLoading.value = undefined;
}

function signOut() {
  Meteor.logout();
  router.push('/');
}

async function setDarkMode(value: string, ack?: (err?: string) => void) {
  let dm: boolean | null;
  if (value === 'true') {
    dm = true;
  } else if (value === 'false') {
    dm = false;
  } else {
    dm = null;
  }
  try {
    await setUserDarkMode.callAsync({ darkMode: dm });
    if (ack) ack();
  } catch (error) {
    if (ack) ack(error.reason || error.message || error);
    else console.error(error);
  }
}

async function swapAbilityScoresAndModifiers(value: any, ack?: (err?: string) => void) {
  try {
    await (Meteor.users as any).setPreference.callAsync({
      preference: 'swapAbilityScoresAndModifiers',
      value: !!value,
    });
    if (ack) ack();
  } catch (error: any) {
    if (ack) ack(error.reason || error.message || error);
    else console.error(error);
  }
}

async function generateKey() {
  try {
    await (Meteor.users as any).gnerateApiKey.callAsync();
  } catch (error: any) {
    apiKeyGenerationError.value = error.reason;
  }
  showApiKey.value = true;
}

async function verifyEmail(email: string) {
  try {
    await sendVerificationEmail.callAsync({ address });
  } catch (error: any) {
    emailVerificationError.value = error.reason;
  }
}

function clickInvite(invite: any) {
  store.commit('pushDialogStack', {
    component: 'invite-dialog',
    elementId: invite._id,
    data: { inviteId: invite._id },
  });
}

function linkWithGoogleAccount() {
  linkGoogleError.value = '';
  Meteor.linkWithGoogle((error: any) => {
    if (error) linkGoogleError.value = error;
  });
}

function linkWithPatreonAccount() {
  linkPatreonError.value = '';
  linkWithPatreon(async (error: any) => {
    if (error) {
      linkPatreonError.value = error;
    } else {
      try {
        await Meteor.callAsync('updateMyPatreonDetails');
      } catch (err: any) {
        linkPatreonError.value = err;
      }
    }
  });
}

async function updatePatreon() {
  updatePatreonLoading.value = true;
  updatePatreonError.value = '';
  try {
    await Meteor.callAsync('updateMyPatreonDetails');
  } catch (error: any) {
    updatePatreonError.value = error;
  }
  updatePatreonLoading.value = false;
}

function deleteAccount() {
  store.commit('pushDialogStack', {
    component: 'delete-user-account-dialog',
    elementId: 'delete-account-btn',
  });
}
</script>

<template>
  <v-container class="account-page">
    <h1 class="text-h4 mb-6">Account &amp; settings</h1>
    <div class="account-grid">
      <v-card class="settings-card storage-card">
        <v-card-title>Storage</v-card-title>
        <v-card-text>
          <h2 class="settings-label">File storage used</h2>
          <file-storage-stats />
          <div class="account-row mt-4">
            <h2 class="settings-label">Character storage used</h2>
            <creature-storage-stats />
          </div>
        </v-card-text>
      </v-card>
      <v-card class="settings-card">
        <v-card-title>Preferences</v-card-title>
        <v-card-text>
          <smart-toggle
            label="Theme"
            :value="
              darkMode === true
                ? 'true'
                : darkMode === false
                  ? 'false'
                  : darkMode === null
                    ? 'unset'
                    : undefined
            "
            :options="[
              { name: 'Dark', value: 'true', icon: 'mdi-brightness-5' },
              { name: 'Match device theme', value: 'unset' },
              { name: 'Light', value: 'false', icon: 'mdi-brightness-7' },
            ]"
            @change="setDarkMode"
          />
          <smart-switch
            label="Swap ability scores and modifiers"
            :value="user?.preferences?.swapAbilityScoresAndModifiers"
            hide-details="auto"
            @change="swapAbilityScoresAndModifiers"
          />
        </v-card-text>
      </v-card>
      <v-card class="settings-card profile-card">
        <v-card-title>Profile</v-card-title>
        <v-card-text>
          <section class="profile-section">
            <h2 class="settings-label">Username</h2>
            <div class="account-row" data-id="username">
              <span class="account-value">{{ user?.username }}</span
              ><v-btn
                variant="outlined"
                prepend-icon="mdi-pencil"
                @click="changeUsername"
                >Change username</v-btn
              >
            </div>
          </section>
          <section class="profile-section">
            <h2 class="settings-label">Email addresses</h2>
            <div
              v-for="email in emails"
              :key="email.address"
              class="account-row email-row"
            >
              <span class="account-value">{{ email.address }}</span>
              <v-btn
                v-if="emails.length > 1"
                variant="text"
                color="error"
                :loading="removeEmailLoading === email.address"
                :aria-label="'Remove ' + email.address"
                @click="removeEmailAddress(email.address)"
                >Remove</v-btn
              >
            </div>
            <v-alert v-if="removeEmailError" type="error" class="my-3">{{
              removeEmailError
            }}</v-alert>
            <div v-if="showEmailInput" class="email-input-row">
              <v-text-field
                v-model="inputEmail"
                label="Add Email Address"
                type="email"
                variant="outlined"
                density="comfortable"
                hide-details="auto"
                :error-messages="addEmailError"
              />
              <div class="settings-actions">
                <v-btn variant="text" @click="clearEmailInput">Cancel</v-btn
                ><v-btn
                  color="primary"
                  :loading="addEmailLoading"
                  @click="addEmailAddress"
                  >Add email</v-btn
                >
              </div>
            </div>
            <v-btn
              v-else-if="!emails || emails.length < 2"
              variant="text"
              prepend-icon="mdi-plus"
              class="mt-2"
              @click="showEmailInput = true"
              >Add email address</v-btn
            >
          </section>
        </v-card-text>
      </v-card>
      <v-card class="settings-card">
        <v-card-title>Linked accounts</v-card-title>
        <v-card-text>
          <div class="account-row mb-4">
            <span class="account-value">Patreon tier: {{ tier.name }}</span
            ><v-btn
              variant="text"
              icon="mdi-refresh"
              aria-label="Refresh Patreon status"
              :loading="updatePatreonLoading"
              @click="updatePatreon"
            />
          </div>
          <v-alert
            v-if="updatePatreonError || linkGoogleError || linkPatreonError"
            type="error"
            class="mb-4"
            >{{
              updatePatreonError || linkGoogleError || linkPatreonError
            }}</v-alert
          >
          <div class="settings-actions">
            <v-btn
              v-if="!user?.services?.google"
              color="primary"
              @click="linkWithGoogleAccount"
              >Link Google Account</v-btn
            ><v-btn
              v-if="!user?.services?.patreon"
              color="primary"
              @click="linkWithPatreonAccount"
              >Link Patreon Account</v-btn
            >
          </div>
        </v-card-text>
      </v-card>
      <v-card v-if="invites?.length" class="settings-card profile-card">
        <v-card-title>Invites</v-card-title>
        <v-list
          ><v-list-item
            v-for="invite in invites"
            :key="invite._id"
            :data-id="invite._id"
            append-icon="mdi-email-outline"
            @click="clickInvite(invite)"
            ><v-list-item-title class="account-value">{{
              invite.inviteeName || invite.invitee || "Available"
            }}</v-list-item-title></v-list-item
          ></v-list
        >
      </v-card>
    </div>
    <div class="account-footer settings-actions">
      <v-btn color="primary" variant="tonal" @click="signOut">Sign Out</v-btn
      ><v-btn
        color="error"
        variant="outlined"
        data-id="delete-account-btn"
        @click="deleteAccount"
        >Delete Account</v-btn
      >
    </div>
  </v-container>
</template>

<style scoped>
.account-page {
  max-width: 1100px;
  padding-block: 24px;
}
.account-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: 20px;
  align-items: start;
}
.settings-card {
  min-width: 0;
}
.settings-card :deep(.v-card-title) {
  white-space: normal;
  overflow-wrap: anywhere;
}
.settings-card :deep(.v-card-text) {
  padding: 20px;
}
.settings-label {
  font-size: 1rem;
  line-height: 1.5;
  margin: 0 0 8px;
}
.account-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.account-value {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
.profile-card {
  grid-column: 1 / -1;
}
.profile-section + .profile-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.email-row {
  margin-bottom: 8px;
}
.email-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
  margin-top: 16px;
}
.settings-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.settings-actions :deep(.v-btn) {
  max-width: 100%;
  height: auto;
  min-height: 36px;
}
.settings-actions :deep(.v-btn__content) {
  white-space: normal;
}
.account-footer {
  justify-content: flex-end;
  margin-top: 24px;
  padding-block: 8px;
}
@media (max-width: 700px) {
  .account-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .profile-card {
    grid-column: auto;
  }
  .email-input-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .settings-card :deep(.v-card-text) {
    padding: 16px;
  }
}
</style>
