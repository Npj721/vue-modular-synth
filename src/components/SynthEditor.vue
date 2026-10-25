<script setup>
import { ref, reactive, watch } from "vue"
import Swal from "sweetalert2"
import PatchEditor from "./PatchEditor.vue";
import SuperModuleEditor from "./SuperModuleEditor.vue";
import SynthPatchManager from "./SynthPatchManager.vue";
import LmStudioChat from "./LmStudioChat.vue";

import { useDockState } from "../composables/useDockState";
import { useModuleCatalog } from "../composables/useModuleCatalog";
const { showVisualizer, showKeyboard } = useDockState()
const { getCatalog } = useModuleCatalog()

const currentPatch = ref("voice")
const patchManagerOpen = ref(false)
const aiOpen = ref(false)

const voiceEditor = ref(null)
const mainEditor = ref(null)
const chatRef = ref(null)

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

/* =========================
 * Chargement d'un patch proposé par l'IA.
 * Le modèle encadre parfois le JSON de texte ou de Markdown : on repère
 * la première accolade ouvrante, puis on tente les accolades fermantes
 * de la dernière vers la première pour retrouver l'objet complet.
 * ========================= */
const extractJsonObject = (text) => {
  if (typeof text !== "string") return null
  const start = text.indexOf("{")
  if (start === -1) return null

  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      // accolade trop précoce (JSON imbriqué) : on essaie la précédente
    }
  }
  return null
}

/* =========================
 * Validation du patch proposé par l'IA avant import.
 * Retourne une liste de messages d'erreur lisibles par le modèle :
 * ces messages lui sont renvoyés pour qu'il corrige sa proposition.
 * ========================= */
const validateSynthPatch = (synthPatch) => {
  const errors = []
  const catalog = getCatalog()

  if (!synthPatch || typeof synthPatch !== "object" || Array.isArray(synthPatch)) {
    return ["La réponse ne contient pas un objet patch JSON valide."]
  }

  const graphs = [
    ["voicePatch", synthPatch.voicePatch],
    ["mainPatch", synthPatch.mainPatch],
  ]

  for (const [graphName, graph] of graphs) {
    if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
      errors.push(`${graphName} est absent ou n'est pas un objet.`)
      continue
    }

    const modules = Array.isArray(graph.modules) ? graph.modules : null
    const connections = Array.isArray(graph.connections) ? graph.connections : null

    if (!modules) errors.push(`${graphName}.modules doit être un tableau.`)
    if (!connections) errors.push(`${graphName}.connections doit être un tableau.`)
    if (!modules || !connections) continue

    const moduleIds = new Set()

    for (const [index, module] of modules.entries()) {
      const where = `${graphName}.modules[${index}]`

      if (!module || typeof module !== "object") {
        errors.push(`${where} n'est pas un objet.`)
        continue
      }

      if (typeof module.id !== "string" || !module.id) {
        errors.push(`${where}.id doit être une chaîne non vide.`)
      } else if (moduleIds.has(module.id)) {
        errors.push(`${where}.id "${module.id}" est dupliqué dans ${graphName}.`)
      } else {
        moduleIds.add(module.id)
      }

      if (typeof module.type !== "string" || !catalog[module.type]) {
        errors.push(`${where}.type "${module.type}" n'existe pas dans le catalogue.`)
      }

      if (
        !module.position ||
        !Number.isFinite(module.position.x) ||
        !Number.isFinite(module.position.y)
      ) {
        errors.push(`${where}.position doit contenir des coordonnées x et y numériques.`)
      }

      if (
        module.params !== undefined &&
        (!module.params || typeof module.params !== "object" || Array.isArray(module.params))
      ) {
        errors.push(`${where}.params doit être un objet.`)
      }
    }

    for (const [index, connection] of connections.entries()) {
      const where = `${graphName}.connections[${index}]`

      if (!connection || typeof connection !== "object") {
        errors.push(`${where} n'est pas un objet.`)
        continue
      }

      const endpoints = [
        ["from", connection.from, "outputs", "out"],
        ["to", connection.to, "inputs", "in"],
      ]

      for (const [side, endpoint, portCollection, portPrefix] of endpoints) {
        if (!endpoint || typeof endpoint !== "object") {
          errors.push(`${where}.${side} est absent.`)
          continue
        }

        if (typeof endpoint.id !== "string" || !endpoint.id) {
          errors.push(`${where}.${side}.id est absent.`)
          continue
        }

        const module = modules.find((m) => m?.id === endpoint.id)
        if (!module) {
          errors.push(
            `${where}.${side}.id "${endpoint.id}" ne correspond à aucun module de ${graphName}.`
          )
          continue
        }

        const definition = catalog[module.type]
        if (!definition) continue

        if (typeof endpoint.port !== "string" || !endpoint.port) {
          errors.push(`${where}.${side}.port est absent.`)
          continue
        }

        const ports = definition.ports?.[portCollection] ?? []
        if (!ports.some((port) => endpoint.port === `${portPrefix}:${port.id}`)) {
          const available = ports.map((port) => `${portPrefix}:${port.id}`).join(", ")
          errors.push(
            `${where}.${side}.port "${endpoint.port}" n'existe pas sur le module "${endpoint.id}" (${module.type}). Ports valides : ${available || "aucun"}.`
          )
        }
      }
    }
  }

  return errors
}

/**
 * Tente de charger le patch proposé par l'IA. En cas d'échec, les erreurs
 * sont renvoyées au modèle via LmStudioChat pour qu'il corrige sa réponse.
 */
const handleAiPatchReceived = (answer) => {
  const synthPatch = extractJsonObject(answer)

  // Réponse purement conversationnelle : rien à charger.
  if (!synthPatch) return

  const errors = validateSynthPatch(synthPatch)

  if (!errors.length) {
    try {
      handleSynthPatchLoaded(synthPatch)
    } catch (err) {
      errors.push(`Erreur pendant l'importation du patch : ${err.message}`)
    }
  }

  if (errors.length) {
    chatRef.value?.requestCorrection(errors)
    return
  }

  chatRef.value?.resetCorrectionAttempts()
  currentPatch.value = "voice"
  Swal.fire({
    toast: true,
    position: "bottom-end",
    icon: "success",
    title: `Patch « ${synthPatch.name || "IA"} » chargé`,
    timer: 2500,
    showConfirmButton: false,
  })
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
      :patch="patch"
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
        <button
          class="button toggle-manager"
          :disabled="currentPatch === 'super'"
          @click="patchManagerOpen = !patchManagerOpen"
        >{{ patchManagerOpen ? "◀ Patch Manager" : "▶ Patch Manager" }}</button>

        <button
          class="button toggle-manager"
          :disabled="currentPatch === 'super'"
          @click="showVisualizer = !showVisualizer"
        >{{ showVisualizer ? "◀ Spectrum" : "▶ Spectrum" }}</button>

        <button
          class="button toggle-manager"
          :disabled="currentPatch === 'super'"
          @click="showKeyboard = !showKeyboard"
        >{{ showKeyboard ? "◀ Keyboard" : "▶ Keyboard" }}</button>

        <button
          class="button toggle-manager"
          :class="{ actif: aiOpen }"
          @click="aiOpen = !aiOpen"
        >{{ aiOpen ? "◀ IA" : "▶ IA" }}</button>
    </div>
    <PatchEditor ref="voiceEditor" v-model:patch="voicePatch" :manager-open="patchManagerOpen" v-show="currentPatch === 'voice'"></PatchEditor>
    <PatchEditor ref="mainEditor" v-model:patch="mainPatch" :manager-open="patchManagerOpen" v-show="currentPatch === 'main'"></PatchEditor>
    <SuperModuleEditor v-show="currentPatch === 'super'"></SuperModuleEditor>

    <aside v-if="aiOpen" class="ai-panel">
      <div class="ai-panel-header">
        <span>Assistant IA</span>
        <button class="ai-close" type="button" aria-label="Fermer l'assistant" @click="aiOpen = false">✕</button>
      </div>
      <LmStudioChat
        ref="chatRef"
        class="ai-chat"
        :voice-patch="voicePatch"
        :main-patch="mainPatch"
        @patch-received="handleAiPatchReceived"
      />
    </aside>
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

.button.toggle-manager {
  background: #34495e;
  margin-left: 12px;
}

.button.toggle-manager.actif {
  background: #00c9a7;
}

.button.clear:disabled {
  background: #aaa;
  cursor: not-allowed;
  transform: none;
}

.top-panel{
  background: #12332b;
  border-top:1px solid rgba(255,255,255, .1);
  padding-top:2px;
  padding-bottom:2px;
}

/* =========================
 * Panneau Assistant IA (LmStudioChat)
 * Superposé à droite pour ne pas réduire la surface du patch.
 * ========================= */
.ai-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: var(--dock-height, 0px);
  z-index: 200;
  display: flex;
  flex-direction: column;
  width: min(520px, 100vw);
  background: #fff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.35);
}

.ai-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  background: #12332b;
  color: #fff;
  font-weight: bold;
}

.ai-close {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.ai-panel .ai-chat {
  flex: 1;
  height: auto;
  max-width: none;
  margin: 0;
  border: none;
  border-radius: 0;
  min-height: 0;
}
</style>