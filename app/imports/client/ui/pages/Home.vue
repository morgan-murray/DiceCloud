<script setup lang="ts">
import { appPath } from '/imports/api/utility/basePath';
import { autorun } from 'vue-meteor-tracker';

const { result: signedIn } = autorun(() => !!Meteor.userId());

</script>

<template>
  <div
    class="home content layout column justify-space-between"
    style="min-height: 100%;"
  >
    <section
      class="py-12 px-4"
    >
      <v-row
        align="end"
        justify="center"
        class="mb-8"
      >
        <v-col
          class="text-center"
          cols="12"
        >
          <h1 class="text-h4 mb-4">
            Free, auditable, real-time character tracking for 5th edition
          </h1>
          <h4 class="text-subtitle-1">
            Spend less time shuffling paper, and more time playing the game
          </h4>
        </v-col>
      </v-row>
      <div
        v-if="!signedIn"
        class="d-flex align-center justify-center"
      >
        <v-btn
          color="accent"
          rounded
          size="large"
          to="/register"
          class="mr-4"
        >
          Register
        </v-btn>
        <v-btn
          color="accent"
          rounded
          variant="outlined"
          size="large"
          to="/sign-in"
        >
          Sign in
        </v-btn>
      </div>
      <div
        v-else
        class="d-flex align-center justify-center"
      >
        <v-btn
          color="accent"
          rounded
          size="large"
          to="/character-list"
          class="mr-4"
        >
          My characters
        </v-btn>
      </div>
    </section>
    <section>
      <v-parallax
        :src="appPath('/images/crown-dice-on-ipad.webp')"
        height="300"
      />
    </section>
  </div>
</template>
