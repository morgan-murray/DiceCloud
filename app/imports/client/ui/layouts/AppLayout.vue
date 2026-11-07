<script setup lang="ts">
import { computed, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import { useRoute } from 'vue-router';
import { useTheme, useDisplay } from 'vuetify';
import { autorun } from 'vue-meteor-tracker';
import '/imports/api/users/Users';
import Sidebar from '/imports/client/ui/layouts/Sidebar.vue';
import ChronicleBanner from '/imports/client/ui/layouts/ChronicleBanner.vue';
import DialogStack from '/imports/client/ui/dialogStack/DialogStack.vue';
import SnackbarQueue from '/imports/client/ui/components/snackbars/SnackbarQueue.vue';
import ConnectionBanner from '/imports/client/ui/layouts/ConnectionBanner.vue';
import { key } from '/imports/client/ui/vuexStore';

const store = useStore(key);
const route = useRoute();
const theme = useTheme();
const display = useDisplay();

const chronicleHeading = computed(() => {
  if (route.name === 'characterSheet') return { title: String(store.state.pageTitle), subtitle: 'A character chronicle' };
  if (route.path === '/character-list') return { title: 'Your characters', subtitle: 'Every adventure begins with a character.' };
  if (route.path === '/sign-in') return { title: 'Welcome, adventurer', subtitle: 'Continue your chronicle.' };
  if (route.path === '/') return { title: 'DiceCloud', subtitle: 'Character sheets for the stories you tell.' };
  return null;
});

const drawer = computed({
  get: () => store.state.drawer,
  set: (value) => store.commit('setDrawer', value),
});

const { result: darkMode } = autorun(() => {
  const user = Meteor.user() as any;
  if (!user) return null;
  return user.darkMode as boolean | null;
});

function applyDarkMode(newDarkModeValue: boolean | null | undefined) {
  if (typeof newDarkModeValue === 'boolean') {
    theme.global.name.value = newDarkModeValue ? 'dark' : 'light';
  } else {
    const deviceDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme.global.name.value = deviceDarkMode ? 'dark' : 'light';
  }
}

watch(darkMode, applyDarkMode, { immediate: true });

watch(route, (to) => {
  store.commit('setPageTitle', (to.meta && to.meta.title) || 'DiceCloud');
});

onMounted(() => {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (typeof darkMode.value === 'boolean') return;
    theme.global.name.value = e.matches ? 'dark' : 'light';
  });
});

function toggleDrawer() {
  store.commit('toggleDrawer');
}
</script>

<template>
  <v-app class="lance-chronicle">
    <v-navigation-drawer v-model="drawer" theme="dark" class="chronicle-drawer">
      <Sidebar />
    </v-navigation-drawer>
    <router-view name="toolbar" />
    <v-app-bar
      v-if="!route.matched[0] || !route.matched[0].components?.toolbar"
      color="secondary"
      theme="dark"
      density="compact"
    >
      <v-app-bar-nav-icon @click="toggleDrawer" />
      <v-toolbar-title>
        <v-fade-transition mode="out-in">
          <div :key="store.state.pageTitle">
            {{ store.state.pageTitle }}
          </div>
        </v-fade-transition>
      </v-toolbar-title>
      <v-spacer />
      <v-fade-transition mode="out-in">
        <div
          :key="route.path"
          style="
            text-overflow: ellipsis;
            overflow: hidden;
          "
        >
          <router-view name="toolbarItems" />
        </div>
      </v-fade-transition>
      <template #extension>
        <v-fade-transition
          v-if="display.smAndUp"
          mode="out-in"
        >
          <div
            :key="route.path"
            style="width: 100%"
          >
            <router-view name="toolbarExtension" />
          </div>
        </v-fade-transition>
      </template>
    </v-app-bar>
    <v-main>
      <connection-banner />
      <chronicle-banner v-if="chronicleHeading" :title="chronicleHeading.title" :subtitle="chronicleHeading.subtitle" />
      <router-view v-slot="{ Component }">
        <v-fade-transition hide-on-leave>
          <component :is="Component" />
        </v-fade-transition>
      </router-view>
    </v-main>
    <router-view name="rightDrawer" />
    <dialog-stack />
    <snackbar-queue />
  </v-app>
</template>

<style></style>
