<script setup>
  import { reactive } from "vue"
  import SynthEditor from './components/SynthEditor.vue'
  import SynthKeyboard from './components/SynthKeyboard.vue'
  import MultiTrackSequencer from './components/MultiTrackSequencer.vue'
  import MidiController from './components/MidiController.vue'
  import AudioVisualizer from './components/AudioVisualizer.vue'
  const patch = reactive({})

</script>

<template>
  <SynthEditor v-model:patch="patch"/>
  <MidiController :patch="patch.value ? patch.value : patch" />
  <MultiTrackSequencer :patch="patch.value ? patch.value : patch" />
  <SynthKeyboard :patch="patch.value ? patch.value : patch" />
  <AudioVisualizer />
  <h1>patch</h1>
  <div>
    {{ patch }}
  </div>
</template>

<style scoped>

</style>