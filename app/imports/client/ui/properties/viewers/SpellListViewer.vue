<script setup lang="ts">
defineProps<{ model: Record<string, any> }>();
</script>

<template lang="html">
  <div class="spell-list-viewer">
    <v-row dense>
      <property-field
        name="Variable name"
        mono
        :value="model.variableName"
      />

      <property-field
        name="Maximum prepared spells"
        large
        center
        :calculation="model.maxPrepared"
      />
      <property-field
        name="Spellcasting ability"
        mono
        :value="model.ability"
      />
      <property-field
        name="Spellcasting ability modifier"
        large
        center
        signed
        :value="model.abilityMod"
      />
      <property-field
        name="Spell save DC"
        large
        center
        :calculation="model.dc"
      />
      <property-field
        name="Attack roll bonus"
        large
        center
        signed
        :calculation="model.attackRollBonus"
      />
      <property-description
        name="Description"
        :model="model.description"
      />
    </v-row>
  </div>
</template>
