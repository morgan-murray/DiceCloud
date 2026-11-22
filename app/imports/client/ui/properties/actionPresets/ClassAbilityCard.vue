<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import { Meteor } from 'meteor/meteor';
import { poolFor, smiteDice, sneakDice, validCost } from '/imports/api/classAbilities/physical.mjs';

const props = defineProps<{ ability: string; creatureId: string; pools: any[]; rogueLevel?: number; monkLevel?: number }>();
const context = inject('context', { editPermission: false });
const selected = ref(''), points = ref('1'), healing = ref('Heal'), maneuver = ref('Dash');
const initialKi = ref('');
const critical = ref(false), undead = ref(false), busy = ref(false), message = ref('');
const smite = computed(() => props.ability === 'Divine Smite');
const hands = computed(() => props.ability === 'Lay on Hands');
const step = computed(() => props.ability === 'Step of the Wind');
const consumes = computed(() => smite.value || hands.value || step.value);
const choices = computed(() => props.pools.filter(p => poolFor(props.ability, p))
  .sort((a,b) => (a.spellSlotLevel?.value || 0) - (b.spellSlotLevel?.value || 0)));
const pool = computed(() => choices.value.find(p => p._id === selected.value));
watch(choices, list => {
  if (list.some(p => p._id === selected.value)) return;
  const first = smite.value ? list.find(p => p.value > 0) || list[0] : list.length === 1 ? list[0] : undefined;
  selected.value = first?._id || '';
}, { immediate: true });
const cost = computed(() => hands.value ? healing.value === 'Heal' ? Number(points.value) : 5 : 1);
const canSpend = computed(() => context.editPermission && !busy.value && validCost(props.ability, cost.value, pool.value?.value));
const dice = computed(() => smite.value && pool.value ? smiteDice(pool.value.spellSlotLevel.value, undead.value, critical.value) : sneakDice(props.rogueLevel, critical.value));
const label = (p: any) => p.name + ' (' + p.value + '/' + p.total + ')';
const benefit = computed(() => maneuver.value === 'Dash' ? 'Gain extra movement equal to your current speed.' : maneuver.value === 'Hide' ? 'Roll Dexterity (Stealth) when hiding is possible.' : 'Your movement avoids opportunity attacks for the rest of the turn.');
watch([selected, critical, undead, points, healing, maneuver], () => { message.value = ''; });
async function createKi() {
  if (busy.value || !context.editPermission || initialKi.value === '') return;
  busy.value = true;
  try {
    await Meteor.callAsync('classAbilities.createKiPool', { creatureId: props.creatureId, remaining: Number(initialKi.value) });
    message.value = 'Ki pool added to Stats.';
  } catch (e: any) { message.value = e.reason || 'Check the ki pool under Stats.'; }
  finally { busy.value = false; }
}
async function spend() {
  if (!canSpend.value) return;
  const chosen = pool.value, amount = cost.value;
  const outcome = smite.value ? 'Roll ' + dice.value + 'd8 radiant damage.'
    : step.value ? maneuver.value + ' as a bonus action. Double your jump distance this turn.'
    : healing.value === 'Heal' ? 'Restore ' + amount + ' HP to the recipient, up to their maximum.' : healing.value + ' by touch.';
  busy.value = true;
  try {
    const left = await Meteor.callAsync('classAbilities.spend', {
      creatureId: props.creatureId, poolId: chosen._id, ability: props.ability, amount, remaining: chosen.value,
    });
    message.value = outcome + ' ' + chosen.name + ': ' + left + ' remaining.';
  } catch (e: any) {
    message.value = e.reason || 'Check your counter before trying again.';
  } finally { busy.value = false; }
}
</script>
<template>
  <v-card class="pa-4 class-ability" :data-ability="ability">
    <h3 class="text-h6">{{ ability }}</h3>
    <p v-if="smite">After a melee weapon attack hits, choose a spell slot to add radiant damage.</p>
    <p v-else-if="hands">As an action, touch a creature to heal it or spend 5 points per disease or poison. Undead and constructs are unaffected. Update the recipient’s sheet separately.</p>
    <p v-else-if="step">Spend 1 ki to Dash or Disengage as a bonus action. Your jump distance doubles for the turn.</p>
    <p v-else-if="ability === 'Cunning Action'">On your turn, use your bonus action for one of these moves.</p>
    <p v-else>Once per turn on a finesse or ranged weapon hit. You need advantage, or another enemy of the target within 5 feet of it who is not incapacitated while you do not have disadvantage.</p>
    <div class="ability-fields">
      <v-select v-if="consumes && choices.length" v-model="selected" :label="smite ? 'Spell slot' : 'Resource pool'" :items="choices"
        :item-title="label" item-value="_id" :disabled="busy" variant="outlined" hide-details />
      <p v-if="consumes && !choices.length" class="text-body-2">{{ smite ? 'Add a levelled spell-slot counter under Stats to use Divine Smite.' : hands ? 'Select an existing resource in Stats and give it the tag layOnHands, or add a Lay on Hands resource.' : 'Tag an existing ki resource with kiPoints in Stats. If you have no ki pool, create one with your current balance.' }}</p>
      <template v-if="step && !choices.length && monkLevel && context.editPermission">
        <v-text-field v-model="initialKi" type="number" :label="'Ki currently remaining (0–' + monkLevel + ')'" min="0" :max="monkLevel" step="1" :disabled="busy" variant="outlined" hide-details />
        <v-btn variant="tonal" :disabled="busy || initialKi === '' || !Number.isInteger(Number(initialKi)) || Number(initialKi) < 0 || Number(initialKi) > monkLevel" @click="createKi">Create ki pool</v-btn>
      </template>
      <template v-if="hands">
        <v-select v-model="healing" label="Use points to" :items="['Heal','Cure one disease','Neutralise one poison']" :disabled="busy" variant="outlined" hide-details />
        <v-text-field v-if="healing === 'Heal'" v-model="points" type="number" label="HP to restore" min="1" :max="pool?.value" step="1" :disabled="busy" variant="outlined" hide-details />
      </template>
      <v-select v-if="step || ability === 'Cunning Action'" v-model="maneuver" label="Bonus action" :items="step ? ['Dash','Disengage'] : ['Dash','Disengage','Hide']" :disabled="busy" variant="outlined" hide-details />
      <template v-if="smite || ability === 'Sneak Attack'">
        <v-checkbox v-if="smite" v-model="undead" :disabled="busy" label="Fiend or undead" hide-details density="compact" />
        <v-checkbox v-model="critical" :disabled="busy" label="Critical hit" hide-details density="compact" />
      </template>
    </div>
    <p v-if="step || ability === 'Cunning Action'" class="mt-2">{{ benefit }}</p>
    <p v-if="smite && pool" class="mt-2"><strong>{{ dice }}d8</strong> extra radiant damage on your physical dice.</p>
    <p v-if="ability === 'Sneak Attack'" class="mt-2"><template v-if="dice">Roll <strong>{{ dice }}d6</strong> extra weapon damage.</template><template v-else>Use the Sneak Attack dice for your rogue class level{{ critical ? ', doubled for this critical hit' : '' }}.</template></p>
    <v-btn v-if="consumes && choices.length" class="mt-3" variant="tonal" color="primary" :disabled="!canSpend" :loading="busy" @click="spend">
      {{ smite ? 'Spend 1 slot' : step ? 'Spend 1 ki' : 'Spend ' + (cost || 0) + (cost === 1 ? ' point' : ' points') }}
    </v-btn>
    <p v-if="message" class="mt-2" role="status">{{ message }}</p>
  </v-card>
</template>
<style scoped>
.ability-fields { display: grid; gap: 8px; margin-top: 12px; }
.class-ability { overflow-wrap: anywhere; }
</style>
