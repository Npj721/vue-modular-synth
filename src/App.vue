<script setup>
  import { reactive } from "vue"
  import SynthEditor from './components/SynthEditor.vue'
  import SynthKeyboard from './components/SynthKeyboard.vue'
  import MultiTrackSequencer from './components/MultiTrackSequencer.vue'
  const patch = reactive({})

</script>

<template>
  <SynthEditor v-model:patch="patch"/>
  <MultiTrackSequencer :patch="patch.value ? patch.value : patch" />
  <SynthKeyboard :patch="patch.value ? patch.value : patch" />
 <h1>patch</h1>
 <div>
  {{ patch }}
 </div>
</template>

<style scoped>

</style>