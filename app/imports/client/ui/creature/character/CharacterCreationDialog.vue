<script setup lang="ts">
import { ref, computed } from "vue";
import { useStore } from "vuex";
import { useRouter } from "vue-router";
import { autorun, subscribe } from "vue-meteor-tracker";
import { snackbar } from "/imports/client/ui/components/snackbars/SnackbarQueue";
import { defer, union, without } from "lodash";
import DialogBase from "/imports/client/ui/dialogStack/DialogBase.vue";
import insertCreature from "/imports/api/creature/creatures/methods/insertCreature";
import LibraryList from "/imports/client/ui/library/LibraryList.vue";
import LibraryCollections from "/imports/api/library/LibraryCollections";
import { key } from "/imports/client/ui/vuexStore";

const emit = defineEmits(["pop"]);
const store = useStore(key);
const router = useRouter();

autorun(() => {
  subscribe("libraries");
});

const step = ref(1);
const name = ref("New Character");
const gender = ref("");
const alignment = ref("");
const startingLevel = ref(1);
const librariesSelected = ref<string[]>([]);
const libraryCollectionsSelected = ref<string[]>([]);
const librariesSelectedByCollections = ref<string[]>([]);
const allSubscribedLibraries = ref(true);

const submitting = ref(false);

const biographyAlert = computed(() => {
  if (!name.value) return "Name required";
  return undefined;
});

function selectLibrary(libraryId: string, val: boolean) {
  if (val) {
    librariesSelected.value = union(librariesSelected.value, [libraryId]);
  } else {
    librariesSelected.value = without(librariesSelected.value, libraryId);
  }
}

function selectLibraryCollection(libraryCollectionId: string, val: boolean) {
  const collection = LibraryCollections.findOne(libraryCollectionId);
  if (!collection) return;
  if (val) {
    libraryCollectionsSelected.value = union(libraryCollectionsSelected.value, [
      libraryCollectionId,
    ]);
    librariesSelectedByCollections.value = union(
      librariesSelectedByCollections.value,
      collection.libraries,
    );
  } else {
    libraryCollectionsSelected.value = without(
      libraryCollectionsSelected.value,
      libraryCollectionId,
    );
    librariesSelectedByCollections.value = without(
      librariesSelectedByCollections.value,
      ...collection.libraries,
    );
  }
}

async function submit() {
  if (submitting.value || biographyAlert.value) return;
  submitting.value = true;
  const char: any = {
    name: name.value,
    gender: gender.value,
    alignment: alignment.value,
    startingLevel: startingLevel.value,
  };
  if (!allSubscribedLibraries.value) {
    char.allowedLibraries = librariesSelected.value;
    char.allowedLibraryCollections = libraryCollectionsSelected.value;
  }
  try {
    const creatureId = await insertCreature.callAsync(char);
    store.commit("setTabForCharacterSheet", { id: creatureId, tab: "build" });
    emit("pop", creatureId);
    defer(() => {
      router.push({ name: "characterSheet", params: { id: creatureId } });
    });
    return creatureId;
  } catch (error: any) {
    console.error(error);
    snackbar({ text: error.reason });
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <dialog-base class="character-creation">
    <template #replace-toolbar>
      <v-toolbar color="secondary" height="64" class="creation-toolbar">
        <v-btn
          icon="mdi-arrow-left"
          aria-label="Close New Character"
          :disabled="submitting"
          @click="$emit('pop')"
        />
        <v-toolbar-title>New Character</v-toolbar-title>
      </v-toolbar>
    </template>
    <template #unwrapped-content>
      <v-tabs
        v-model="step"
        grow
        color="primary"
        class="creation-tabs"
        aria-label="Character creation steps"
      >
        <v-tab :value="1">Biography</v-tab>
        <v-tab :value="2">Libraries</v-tab>
      </v-tabs>
      <v-window v-model="step" class="creation-window">
        <v-window-item :value="1">
          <section class="creation-panel" aria-label="Biography">
            <p class="creation-intro">
              Start with your character’s details. You can change these later.
            </p>
            <v-row class="biography-fields">
              <v-col cols="12">
                <v-text-field
                  v-model="name"
                  variant="outlined"
                  density="comfortable"
                  label="Name"
                  hide-details="auto"
                  :error="!name"
                  :error-messages="!name ? 'Name required' : undefined"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="alignment"
                  variant="outlined"
                  density="comfortable"
                  label="Alignment"
                  hint="Optional"
                  hide-details="auto"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="gender"
                  variant="outlined"
                  density="comfortable"
                  label="Gender"
                  hint="Optional"
                  hide-details="auto"
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model.number="startingLevel"
                  variant="outlined"
                  density="comfortable"
                  label="Level"
                  type="number"
                  min="0"
                  hide-details="auto"
                />
              </v-col>
            </v-row>
          </section>
        </v-window-item>
        <v-window-item :value="2">
          <section class="creation-panel" aria-label="Libraries">
            <p class="creation-intro">
              Choose which libraries are available to this character.
            </p>
            <v-switch
              v-model="allSubscribedLibraries"
              label="All user libraries"
              color="primary"
              hide-details
              class="library-switch"
            />
            <library-list
              class="creation-library-list"
              selection
              :disabled="allSubscribedLibraries"
              :libraries-selected="librariesSelected"
              :library-collections-selected="libraryCollectionsSelected"
              :libraries-selected-by-collections="
                librariesSelectedByCollections
              "
              @select-library="selectLibrary"
              @select-library-collection="selectLibraryCollection"
            />
          </section>
        </v-window-item>
      </v-window>
    </template>
    <template #actions>
      <div class="creation-actions">
        <v-btn variant="text" :disabled="submitting" @click="$emit('pop')"
          >Cancel</v-btn
        >
        <v-btn
          v-if="step > 1"
          variant="text"
          :disabled="submitting"
          @click="step = 1"
          >Back</v-btn
        >
        <v-spacer />
        <v-btn
          v-if="step < 2"
          variant="tonal"
          color="primary"
          :disabled="!!biographyAlert || submitting"
          @click="step = 2"
          >Next</v-btn
        >
        <v-btn
          :disabled="!!biographyAlert"
          :loading="submitting"
          :variant="step < 2 ? 'text' : 'flat'"
          color="primary"
          @click="submit"
          >Create</v-btn
        >
      </div>
    </template>
  </dialog-base>
</template>

<style scoped>
.creation-toolbar,
.creation-tabs {
  flex: 0 0 auto;
}
.creation-tabs {
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.creation-panel {
  padding: 24px;
}
.creation-intro {
  margin: 0 0 24px;
  color: rgb(var(--v-theme-on-surface));
  opacity: 0.8;
  line-height: 1.5;
}
.biography-fields {
  margin-top: 0;
}
.library-switch {
  margin-bottom: 16px;
}
.creation-library-list {
  background: transparent;
  padding: 0;
}
.creation-library-list :deep(.v-input__details) {
  display: none;
}
.creation-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  padding: 8px;
}
.character-creation :deep(.v-card-actions) {
  flex: 0 0 auto;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
@media (max-width: 600px) {
  .creation-panel {
    padding: 20px 16px;
  }
  .creation-actions {
    padding: 4px 0;
    gap: 0;
  }
}
</style>
