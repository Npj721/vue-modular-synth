<script setup>
import { ref, reactive } from "vue"
import PatchEditor from "./PatchEditor.vue";




const currentPatch = ref("voice")

const voicePatch = reactive({
  modules: [],
  connections: []
})

const mainPatch = reactive({
  modules: [],
  connections: []
})

const toggleVoicePatch = () => {
    currentPatch.value = "voice"
}

const toggleMainPatch = () => {
    currentPatch.value = "main"
}

</script>
<template>
<div>
    <h1>{{ currentPatch }}</h1>
    <div>
        <button @click="toggleVoicePatch">Voice</button>
        <button @click="toggleMainPatch">Main</button>
    </div>
    <PatchEditor v-model:patch="voicePatch" v-show="currentPatch === 'voice'"></PatchEditor>
    <PatchEditor v-model:patch="mainPatch" v-show="currentPatch === 'main'"></PatchEditor>

    <pre>
        {{ voicePatch }}
    </pre>
    <pre>
        {{ mainPatch }}
    </pre>
   
</div>
</template>