<template>
  <div class="d-flex flex-column align-center pa-2">
    <v-card class="feedback-card">
      <iframe
        src="https://discordapp.com/widget?id=120762305087668224&theme=dark"
        width="100%"
        height="500"
        allowtransparency="true"
        frameborder="0"
      />
      <v-card-title>DiceCloud Discord server</v-card-title>
      <v-card-text>
        To give feedback or get support using DiceCloud, join the official Discord server.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" color="primary" href="https://discord.gg/qEvdfeB">
          Join
        </v-btn>
      </v-card-actions>
    </v-card>
  </div>
</template>

<style scoped>
.feedback-card { width: 100%; max-width: 720px; min-width: 0; }
.feedback-card :deep(.v-card-title) { white-space: normal; overflow-wrap: anywhere; }
.feedback-card iframe { display: block; max-width: 100%; border: 0; }
</style>
