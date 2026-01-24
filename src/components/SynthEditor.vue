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
    <h1>Sélection du patch</h1>
    <div>
        <button :class="currentPatch === 'voice' ? 'button actif' : 'button'" @click="toggleVoicePatch">Voice</button>
        <button :class="currentPatch === 'main' ? 'button actif' : 'button'" class="button" @click="toggleMainPatch">Main</button>
    </div>
    <PatchEditor v-model:patch="voicePatch" v-show="currentPatch === 'voice'"></PatchEditor>
    <PatchEditor v-model:patch="mainPatch" v-show="currentPatch === 'main'"></PatchEditor>
</div>
</template>

<style scoped>

h1{
  color: rgb(0, 39, 33);;
}
.button {
  margin-right: 12px;
  padding: 6px 12px;
  border: none;
  background: rgb(1, 122, 102);
  color: white;
  font-weight: bold;
  font-size: large;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.1s;
}

.button.actif {
  background: #00c9a7;
  color: white;
}

.button:hover {
  transform: scale(1.05);
}
</style>