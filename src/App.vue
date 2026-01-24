<script setup>
  import { reactive } from "vue"
  import SynthEditor from './components/SynthEditor.vue'
  const patch = reactive({})

</script>

<template>
  <SynthEditor v-model:patch="patch"/>
 <h1>patch</h1>
    <div>
        {{ patch }}
    </div>
</template>

<style scoped>

</style>
