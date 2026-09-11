<script setup>
import { ref, reactive, watch } from "vue"
import Swal from "sweetalert2"
import PatchEditor from "./PatchEditor.vue";
import SuperModuleEditor from "./SuperModuleEditor.vue";
import SynthPatchManager from "./SynthPatchManager.vue";

const currentPatch = ref("voice")

const voiceEditor = ref(null)
const mainEditor = ref(null)

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

const toggleSuperModules = () => {
    currentPatch.value = "super"
}

const clearCurrentPatch = async () => {
  const editor = currentPatch.value === "voice" ? voiceEditor.value : mainEditor.value
  if (!editor) return
  const res = await Swal.fire({
    title: `Effacer entièrement le patch ${currentPatch.value} ?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Effacer",
    cancelButtonText: "Annuler",
    confirmButtonColor: "#d33",
  })
  if (!res.isConfirmed) return
  editor.clearPatch()
}

/* =========================
 * Synthé complet (voice + main) : chargement dans les deux éditeurs.
 * Chaque PatchEditor redessine son paper puis resynchronise sa source
 * de vérité ; le watch deep de SynthEditor propage le nouveau synthé
 * à l'App (MidiController, MultiTrackSequencer) et déclenche le
 * rebuild du moteur audio partagé.
 * ========================= */
const handleSynthPatchLoaded = (synthPatch) => {
  const voiceData = synthPatch.voicePatch || { modules: [], connections: [] };
  const mainData = synthPatch.mainPatch || { modules: [], connections: [] };
  //if (confirm("Charger ce synthé complet ? Les patches voice et main actuels seront remplacés.")) {
    voiceEditor.value?.loadPatch(voiceData);
    mainEditor.value?.loadPatch(mainData);
  //}
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
    <SynthPatchManager
      :voice-patch="voicePatch"
      :main-patch="mainPatch"
      @load="handleSynthPatchLoaded"
    />
    <div class="top-panel">
        <button :class="currentPatch === 'voice' ? 'button actif' : 'button'" @click="toggleVoicePatch">Voice</button>
        <button :class="currentPatch === 'main' ? 'button actif' : 'button'" class="button" @click="toggleMainPatch">Main</button>
        <button :class="currentPatch === 'super' ? 'button actif' : 'button'" class="button" @click="toggleSuperModules">Super Modules</button>
        <button
          class="button clear"
          :disabled="currentPatch === 'super'"
          @click="clearCurrentPatch"
        >Effacer</button>
    </div>
    <PatchEditor ref="voiceEditor" v-model:patch="voicePatch" v-show="currentPatch === 'voice'"></PatchEditor>
    <PatchEditor ref="mainEditor" v-model:patch="mainPatch" v-show="currentPatch === 'main'"></PatchEditor>
    <SuperModuleEditor v-show="currentPatch === 'super'"></SuperModuleEditor>
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

.button.clear {
  background: #c0392b;
  margin-left: 24px;
}

.button.clear:disabled {
  background: #aaa;
  cursor: not-allowed;
  transform: none;
}

.top-panel{
  background-color: #aaa;
}
</style>