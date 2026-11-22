<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { autorun } from 'vue-meteor-tracker';
import CreatureProperties from '/imports/api/creature/creatureProperties/CreatureProperties';
import { CreatureVariables } from '/imports/client/localCollections/CreatureVariables';
import catalog from './weapons2014.json';
import { commonActions, commonAction, weaponKey, weaponProfile, recordedAttack, abilityFor,
  weaponProficiency, weaponNumbers, weaponAction, sheetWeaponAction } from './physicalActions.mjs';

const props = defineProps<{ creatureId: string; search?: string }>();
const emit = defineEmits(['choose', 'open']);
const { result: properties } = autorun(() => CreatureProperties.find({
  'root.id': props.creatureId, removed: { $ne: true }, type: { $in: ['item', 'note', 'skill', 'action'] },
}, { sort: { name: 1 } }).fetch());
const { result: variables } = autorun(() => CreatureVariables.findOne({ _creatureId: props.creatureId }));
const vars = computed(() => variables.value || {});
const sheet = computed(() => (properties.value || []) as Record<string, any>[]);
const inventory = computed(() => sheet.value.filter(p => p.type === 'item' && p.quantity !== 0 && p.name));
const weapons = computed(() => inventory.value.map(p => ({ title: p.name + (p.equipped ? ' (equipped)' : ''), value: p._id })));
const notes = computed(() => sheet.value.filter(p => p.type === 'note').map(recordedAttack).filter(Boolean));
const sources = computed(() => [{ title: 'Use sheet stats or enter details', value: '' },
  ...notes.value.map(n => ({ title: n.name + ' (recorded attack)', value: n.id }))]);
const weapon = 'Weapon attack';
const templates = computed(() => [...Object.keys(commonActions), weapon].filter(n => n.toLowerCase().includes((props.search || '').trim().toLowerCase())));
const selected = ref(''), itemId = ref(''), sourceId = ref('');
const trigger = ref(''), response = ref('');
const ability = ref(''), proficient = ref<boolean | null>(null), twoHands = ref(false);
const bonus = ref(''), damage = ref(''), range = ref('');
const item = computed(() => inventory.value.find(p => p._id === itemId.value));
const profile = computed(() => weaponProfile(item.value?.name, catalog));
const note = computed(() => notes.value.find(n => n.id === sourceId.value));
watch(itemId, () => {
  const name = item.value?.name || '';
  sourceId.value = notes.value.find(n => weaponKey(n.name) === weaponKey(name))?.id || '';
  ability.value = abilityFor(profile.value, vars.value);
  proficient.value = weaponProficiency(name, profile.value, sheet.value.filter(p => p.type === 'skill' && p.skillType === 'weapon' && !p.inactive));
  twoHands.value = false;
});
const defaults = computed(() => note.value || weaponNumbers(profile.value, ability.value, proficient.value, vars.value, twoHands.value));
// Refill only fields whose source changed, preserving manual corrections in the others.
watch([itemId, sourceId, defaults], ([id, source, fields], [oldId, oldSource, previous]) => {
  const reset = id !== oldId || source !== oldSource;
  if (reset || previous?.bonus !== fields.bonus) bonus.value = fields.bonus == null ? '' : String(fields.bonus);
  if (reset || previous?.damage !== fields.damage) damage.value = fields.damage || '';
  if (reset || previous?.range !== fields.range) range.value = fields.range || '';
});
const isWeapon = computed(() => selected.value === weapon);
const readyIncomplete = computed(() => selected.value === 'Ready' && Boolean(trigger.value.trim()) !== Boolean(response.value.trim()));
const validWeapon = computed(() => item.value && /^[+-]?\d{1,2}$/.test(bonus.value.trim()) && damage.value.trim() && range.value.trim());
const existing = computed(() => sheet.value.filter(p => p.type === 'action' && (isWeapon.value && item.value
  ? p.parentId === itemId.value || p.tags?.includes('weaponAttack-' + itemId.value) || weaponKey(p.name) === weaponKey(item.value.name)
  : p.name === selected.value)));
function choose() {
  if (!selected.value || readyIncomplete.value) return;
  if (!isWeapon.value) return emit('choose', commonAction(selected.value, vars.value, trigger.value, response.value));
  if (!validWeapon.value) return;
  const args = [item.value, Number(bonus.value), damage.value, range.value] as const;
  const action = note.value ? weaponAction(...args)
    : sheetWeaponAction(...args, profile.value, ability.value, proficient.value, vars.value, twoHands.value);
  if (profile.value?.properties) action.description = { text: profile.value.properties };
  emit('choose', action);
}
</script>
<template>
  <section class="pa-4">
    <v-select v-model="selected" label="Action template" :items="templates" variant="outlined" hide-details="auto" />
    <template v-if="selected">
      <template v-if="isWeapon">
        <v-autocomplete v-model="itemId" label="Weapon from inventory" :items="weapons" class="mt-3"
          variant="outlined" hide-details="auto" no-data-text="No matching inventory items on this sheet" />
        <template v-if="item">
          <v-select v-if="notes.length" v-model="sourceId" label="Attack details" :items="sources" class="mt-3" hide-details="auto" variant="outlined" />
          <div v-if="!note" class="weapon-fields mt-3">
            <v-select v-model="ability" label="Ability" :items="[{title:'Strength',value:'strength'},{title:'Dexterity',value:'dexterity'}]" hide-details="auto" variant="outlined" />
            <v-select v-model="proficient" label="Proficient with this weapon?" :items="[{title:'Yes',value:true},{title:'No',value:false}]" hide-details="auto" variant="outlined" />
          </div>
          <v-checkbox v-if="!note && profile?.versatile" v-model="twoHands" label="Use two hands" hide-details />
          <div class="weapon-fields mt-3">
            <v-text-field v-model="bonus" label="Total to add to your d20" maxlength="3" hide-details="auto" variant="outlined" />
            <v-text-field v-model="damage" label="Damage on a hit" placeholder="1d8+3 slashing" maxlength="200" hide-details="auto" variant="outlined" />
            <v-text-field v-model="range" label="Range or reach" placeholder="5 ft" maxlength="100" hide-details="auto" variant="outlined" />
          </div>
          <p v-if="note" class="mt-2 text-body-2">Recorded attack totals are fixed. Review them if your equipment or bonuses have changed.</p>
          <p v-if="profile?.properties" class="mt-2 text-body-2">{{ profile.properties }}</p>
        </template>
      </template>
      <template v-else>
        <p class="my-3">{{ commonActions[selected] }}</p>
        <div v-if="selected === 'Ready'" class="weapon-fields">
          <v-text-field v-model="trigger" label="Trigger (optional)" maxlength="180" variant="outlined" hide-details="auto" />
          <v-text-field v-model="response" label="What you will do (optional)" maxlength="180" variant="outlined" hide-details="auto" />
        </div>
      </template>
      <div v-for="action in existing" :key="action._id" class="mt-2">
        Already on this sheet: <v-btn variant="text" @click="emit('open', action._id)">{{ action.name }}</v-btn>
      </div>
      <v-btn class="mt-3" color="primary" :disabled="readyIncomplete || (isWeapon && !validWeapon)" @click="choose">Use template</v-btn>
    </template>
  </section>
</template>
<style scoped>
.weapon-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 12px; }
</style>
