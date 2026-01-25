<script setup>
  import { reactive } from "vue"
  import SynthEditor from './components/SynthEditor.vue'
  import SynthKeyboard from './components/SynthKeyboard.vue'
  const patch = reactive({})

</script>

<template>
  <SynthEditor v-model:patch="patch"/>
  <SynthKeyboard :patch="patch.value ? patch.value : patch" />
 <h1>patch</h1>
 <div>
  {{ patch }}
 </div>
</template>

<style scoped>

</style>
