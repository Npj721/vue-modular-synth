<script setup>
import { ref, reactive, watch } from "vue"
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

const props = defineProps({
  patch: {
    type: Object,
    required: true
  }
})
const patch = props.patch

watch(
  voicePatch,
  (newPatch) => {
    patch.value = {
        voicePatch:newPatch,
        mainPatch
    }
    emit("update:patch", patch.value )
  },
  { deep: true }
);

watch(
  mainPatch,
  (newPatch) => {
    patch.value = {
        voicePatch,
        mainPatch:newPatch
    }
    emit("update:patch", patch )
  },
  { deep: true }
);

const emit = defineEmits(["update:patch"])

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
</div>
</template>