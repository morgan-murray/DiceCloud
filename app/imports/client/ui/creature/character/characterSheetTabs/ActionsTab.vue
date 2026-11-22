<script setup lang="ts">
import { computed } from 'vue';
import Creatures from '/imports/api/creature/creatures/Creatures';
import ClassAbilityCard from '/imports/client/ui/properties/actionPresets/ClassAbilityCard.vue';
import { classLevel, sheetAbilities } from '/imports/api/classAbilities/physical.mjs';
import { useStore } from 'vuex';
import { autorun } from 'vue-meteor-tracker';
import ColumnLayout from '/imports/client/ui/components/ColumnLayout.vue';
import ActionCard from '/imports/client/ui/properties/components/actions/ActionCard.vue';
import FolderGroupCard from '/imports/client/ui/properties/components/folders/FolderGroupCard.vue';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import softRemoveProperty from '/imports/api/creature/creatureProperties/methods/softRemoveProperty';
import { snackbar } from '/imports/client/ui/components/snackbars/SnackbarQueue';
import { getFilter } from '/imports/api/parenting/parentingFunctions';
import { key } from '/imports/client/ui/vuexStore';

const props = defineProps<{ creatureId: string }>();
const store = useStore(key);
const tabName = 'actions';

const { result: classSheet } = autorun(() => Creatures.findOne(props.creatureId));
const { result: classProperties } = autorun(() => CreatureProperties.find({
  'root.id': props.creatureId, removed: { $ne: true }, inactive: { $ne: true }, disabled: { $ne: true },
  $or: [{ type: { $in: ['feature', 'class'] } }, { type: 'note', name: 'Aurora import record' },
    { type: 'attribute', attributeType: { $in: ['resource', 'spellSlot'] } }],
}, { fields: { type: 1, name: 1, level: 1, variableName: 1, tags: 1, attributeType: 1, overridden: 1,
  spellSlotLevel: 1, value: 1, total: 1, 'description.text': 1 } }).fetch());
const classCards = computed(() => sheetAbilities(classSheet.value, classProperties.value || []));
const rogueLevel = computed(() => classLevel(classSheet.value, classProperties.value || [], 'rogue'));

const { result: startFolders } = autorun(() =>
  CreatureProperties.find({
    ...getFilter.descendantsOfRoot(props.creatureId),
    groupStats: true,
    inactive: { $ne: true },
    removed: { $ne: true },
    tab: tabName,
    location: 'start',
  }, { sort: { left: 1 } }).fetch()
);

const { result: endFolders } = autorun(() =>
  CreatureProperties.find({
    ...getFilter.descendantsOfRoot(props.creatureId),
    groupStats: true,
    inactive: { $ne: true },
    removed: { $ne: true },
    tab: tabName,
    location: 'end',
  }, { sort: { left: 1 } }).fetch()
);

const { result: actions } = autorun(() => {
  const folderIds = CreatureProperties.find({
    ...getFilter.descendantsOfRoot(props.creatureId),
    type: 'folder',
    groupStats: true,
    hideStatsGroup: true,
    removed: { $ne: true },
    inactive: { $ne: true },
  }, { fields: { _id: 1 } }).map((folder: any) => folder._id);

  return CreatureProperties.find({
    ...getFilter.descendantsOfRoot(props.creatureId),
    'parentId': { $nin: folderIds },
    type: 'action',
    actionType: { $ne: 'event' },
    removed: { $ne: true },
    inactive: { $ne: true },
  }, {
    sort: { actionType: 1, order: 1 },
  }).fetch();
});

const monkLevel = computed(() => classLevel(classSheet.value, classProperties.value || [], 'monk'));

function clickProperty({ _id }: { _id: string }) {
  store.commit('pushDialogStack', {
    component: 'creature-property-dialog',
    elementId: `${_id}`,
    data: { _id },
  });
}

function clickTreeProperty({ _id }: { _id: string }) {
  store.commit('pushDialogStack', {
    component: 'creature-property-dialog',
    elementId: `tree-node-${_id}`,
    data: { _id },
  });
}

function softRemove(_id: string) {
  softRemoveProperty.call({ _id }, (error: any) => {
    if (error) {
      snackbar({ text: error.reason || error.message || error.toString() });
      console.error(error);
    }
  });
}
</script>

<template lang="html">
  <div class="actions-tab ma-2">
    <v-card v-if="!classCards.length && !actions?.length && !startFolders?.length && !endFolders?.length" class="ma-2">
      <v-card-title>No actions yet</v-card-title>
      <v-card-text>Actions added to this character appear here. Use the + button to add an action.</v-card-text>
    </v-card>
    <column-layout wide-columns>
      <class-ability-card v-for="entry in classCards" :key="creatureId + entry.name" :ability="entry.name"
        :creature-id="creatureId" :pools="classProperties || []" :rogue-level="rogueLevel" :monk-level="monkLevel" />
      <folder-group-card
        v-for="folder in startFolders"
        :key="folder._id"
        :model="folder"
        @click-property="clickProperty"
        @sub-click="_id => clickTreeProperty({ _id })"
        @remove="softRemove"
      />
      <div
        v-for="action in actions"
        :key="action._id"
        class="action"
      >
        <action-card
          :model="action"
          :data-id="action._id"
          @click="clickProperty({ _id: action._id })"
          @sub-click="_id => clickTreeProperty({ _id })"
        />
      </div>
      <folder-group-card
        v-for="folder in endFolders"
        :key="folder._id"
        :model="folder"
        @click-property="clickProperty"
        @sub-click="_id => clickTreeProperty({ _id })"
        @remove="softRemove"
      />
    </column-layout>
  </div>
</template>
