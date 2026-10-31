<script setup>
// components/SynthPatchEditor.vue
//
// Éditeur de niveau supérieur : un SynthPatch contient des nœuds Synth /
// SuperSynth (chacun avec ses graphes internes) et des modules non pilotés
// par les notes. Deux couches :
//   voice : Synth + SuperSynth + modules non note-driven -> destination
//   main  : modules non note-driven -> destination finale (analyser)
//
// Un clic sur "Ouvrir le synthé" ouvre l'éditeur voice/main d'un Synth.
// Un clic sur "Ouvrir le SuperSynth" ouvre un SynthPatchEditor récursif sur
// la définition embarquée dans le module.

import { ref, computed, nextTick } from "vue"
import Swal from "sweetalert2"
import PatchEditor from "./PatchEditor.vue"
import SynthEditor from "./SynthEditor.vue"
import SynthPatchBank from "./SynthPatchBank.vue"
import { useDockState } from "../composables/useDockState"
import { useSuperSynthBank } from "../composables/useSuperSynthBank.js"
import {
  getSynthModules,
  getSuperSynthModules,
  normalizeSynthPatch,
  createSuperSynthDefinition,
  emptySynthPatch,
} from "../composables/useSynthPatch.js"

const NOTE_DRIVEN = ["voice", "wavetable", "wavetableS"]

const props = defineProps({
  patch: { type: Object, required: true },
  // Éditeur imbriqué (définition d'un SuperSynth) : pas de banque de
  // SynthPatch, interface super.in/super.out dans la couche main.
  nested: { type: Boolean, default: false },
  closeable: { type: Boolean, default: false },
})

const emit = defineEmits(["close"])

const { showVisualizer, showKeyboard } = useDockState()

const tab = ref("voice")
const voiceEditor = ref(null)
const mainEditor = ref(null)

const synthModalOpen = ref(false)
const selectedSynthId = ref(null)

const superModalOpen = ref(false)
const editingSuperModule = ref(null)

const deepClone = (v) => JSON.parse(JSON.stringify(v ?? {}))

const synthModules = computed(() => getSynthModules(props.patch))
const superModules = computed(() => getSuperSynthModules(props.patch))

const selectedSynth = computed(() => {
  if (!selectedSynthId.value) return null
  const found = synthModules.value.find((s) => s.id === selectedSynthId.value)
  return found?.module?.params ?? null
})

const editingSuperPatch = computed(
  () => editingSuperModule.value?.params?.synthPatch ?? null
)

/* =========================================================
 * Synth nodes
 * ========================================================= */

const openSynth = (moduleOrId) => {
  const id = typeof moduleOrId === "string" ? moduleOrId : moduleOrId?.id
  if (!id) return
  selectedSynthId.value = id
  synthModalOpen.value = true
}

const closeSynth = () => {
  synthModalOpen.value = false
  selectedSynthId.value = null
}

/**
 * Le SynthEditor émet une définition complète (graphes clonés). On l'applique
 * en place sur le module pour ne pas changer l'identité de `module.params`
 * (sinon le watcher de SynthEditor se relancerait en boucle).
 */
const handleSynthUpdate = (synthData) => {
  const module = props.patch.voice.modules.find(
    (m) => m.id === selectedSynthId.value && m.type === "synth"
  )
  if (!module) return
  if (!module.params) module.params = {}
  Object.assign(module.params, synthData)
}

/* =========================================================
 * SuperSynth nodes
 * ========================================================= */

const openSuper = (module) => {
  if (!module) return
  editingSuperModule.value = module
  superModalOpen.value = true
}

const closeSuper = () => {
  superModalOpen.value = false
  editingSuperModule.value = null
}

const handleEditSynth = (module) => {
  if (!module) return
  if (module.type === "superSynth") openSuper(module)
  else openSynth(module)
}

const handleLoadSuperSynth = async (module) => {
  if (!module) return
  const bank = useSuperSynthBank()
  const names = bank.names()

  if (!names.length) {
    Swal.fire({
      title: "Aucun SuperSynth enregistré",
      text: "Créez d'abord un SuperSynth depuis un SynthPatch (bouton « Créer un SuperSynth »).",
      icon: "info",
      confirmButtonText: "OK",
    })
    return
  }

  const { value: name, isConfirmed } = await Swal.fire({
    title: "Charger un SuperSynth",
    input: "select",
    inputOptions: Object.fromEntries(names.map((n) => [n, n])),
    inputPlaceholder: "Choisir un SuperSynth",
    showCancelButton: true,
    confirmButtonText: "Charger",
    cancelButtonText: "Annuler",
  })
  if (!isConfirmed || !name) return

  const def = bank.get(name)
  if (!def) return

  if (!module.params) module.params = {}
  module.params.synthPatch = deepClone(def)
  module.params.name = def.name ?? name
}

const handleSaveSuperSynth = async (module) => {
  if (!module) return

  const { value: name, isConfirmed } = await Swal.fire({
    title: "Enregistrer le SuperSynth",
    input: "text",
    inputPlaceholder: "Nom du SuperSynth",
    inputValue: module.params?.name ?? "",
    inputValidator: (v) => (v && v.trim() ? undefined : "Nom requis"),
    showCancelButton: true,
    confirmButtonText: "Enregistrer",
    cancelButtonText: "Annuler",
  })
  if (!isConfirmed || !name) return

  const cleanName = name.trim()
  const bank = useSuperSynthBank()
  const def = deepClone(module.params?.synthPatch ?? emptySynthPatch(cleanName))
  def.name = cleanName
  def.version = 2
  bank.save(cleanName, def)

  Swal.fire({
    toast: true,
    position: "bottom-end",
    icon: "success",
    title: `SuperSynth « ${cleanName} » enregistré`,
    timer: 2500,
    showConfirmButton: false,
  })
}

/** Sauvegarde le SynthPatch courant comme définition réutilisable. */
const createSuperSynth = async () => {
  const { value: name, isConfirmed } = await Swal.fire({
    title: "Créer un SuperSynth",
    input: "text",
    inputPlaceholder: "Nom du SuperSynth",
    inputValue: props.patch.name ? `${props.patch.name} - Super` : "",
    inputValidator: (v) => (v && v.trim() ? undefined : "Nom requis"),
    showCancelButton: true,
    confirmButtonText: "Créer",
    cancelButtonText: "Annuler",
  })
  if (!isConfirmed || !name) return

  const cleanName = name.trim()
  const def = createSuperSynthDefinition(props.patch, cleanName)
  const bank = useSuperSynthBank()
  bank.save(cleanName, def)

  Swal.fire({
    toast: true,
    position: "bottom-end",
    icon: "success",
    title: `SuperSynth « ${cleanName} » créé`,
    html: "Ajoutez un module SuperSynth dans la couche voice pour l'utiliser.",
    timer: 3500,
    showConfirmButton: false,
  })
}

/* =========================================================
 * Chargement d'un SynthPatch complet
 * ========================================================= */

const handleLoad = async (loaded) => {
  const p = normalizeSynthPatch(loaded)
  props.patch.name = p.name ?? props.patch.name
  props.patch.version = 2

  closeSynth()
  closeSuper()
  await nextTick()

  // Les PatchEditor capturent leur graphe au montage : on remplace le contenu
  // de ces graphes stables via leur API loadPatch.
  voiceEditor.value?.loadPatch(p.voice)
  mainEditor.value?.loadPatch(p.main)
  tab.value = "voice"
}
</script>

<template>
  <div class="syntp-root">
    <SynthPatchBank
      v-if="!nested"
      :patch="props.patch"
      @load="handleLoad"
    />

    <div class="syntp-toolbar">
      <span v-if="nested" class="syntp-title">
        SuperSynth : {{ props.patch.name || "sans nom" }}
      </span>

      <button
        class="syntp-btn"
        :class="{ actif: tab === 'voice' }"
        @click="tab = 'voice'"
      >SynthPatch Voice</button>
      <button
        class="syntp-btn"
        :class="{ actif: tab === 'main' }"
        @click="tab = 'main'"
      >SynthPatch Main</button>

      <span class="syntp-sep"></span>

      <button
        v-if="!nested"
        class="syntp-btn syntp-btn-super"
        @click="createSuperSynth"
      >Créer un SuperSynth</button>

      <button class="syntp-btn" @click="showVisualizer = !showVisualizer">
        {{ showVisualizer ? "◀ Spectrum" : "▶ Spectrum" }}
      </button>
      <button class="syntp-btn" @click="showKeyboard = !showKeyboard">
        {{ showKeyboard ? "◀ Keyboard" : "▶ Keyboard" }}
      </button>

      <button
        v-if="closeable"
        class="syntp-btn syntp-btn-close"
        type="button"
        @click="emit('close')"
      >✕ Fermer</button>
    </div>

    <div class="syntp-synth-strip">
      <span class="syntp-strip-label">Synths :</span>
      <button
        v-for="s in synthModules"
        :key="s.id"
        class="syntp-synth-btn"
        @click="openSynth(s.id)"
      >
        {{ s.name }}
      </button>
      <button
        v-for="s in superModules"
        :key="s.id"
        class="syntp-synth-btn syntp-super-btn"
        @click="openSuper(s.module)"
      >
        ★ {{ s.name }}
      </button>
      <span
        v-if="!synthModules.length && !superModules.length"
        class="syntp-empty"
      >
        aucun — ajoutez un module « Synth » ou « SuperSynth » via le menu contextuel
      </span>
    </div>

    <div class="syntp-editors">
      <PatchEditor
        ref="voiceEditor"
        v-show="tab === 'voice'"
        :patch="props.patch.voice"
        :initial-patch="props.patch.voice"
        :show-patch-manager="false"
        :exclude-types="NOTE_DRIVEN"
        :super-export-enabled="false"
        @edit-synth="handleEditSynth"
        @load-super-synth="handleLoadSuperSynth"
        @save-super-synth="handleSaveSuperSynth"
      />
      <PatchEditor
        ref="mainEditor"
        v-show="tab === 'main'"
        :patch="props.patch.main"
        :initial-patch="props.patch.main"
        :show-patch-manager="false"
        :exclude-types="NOTE_DRIVEN"
        :exclude-categories="['synth']"
        :allow-interface-modules="nested"
        :super-export-enabled="false"
      />
    </div>

    <!-- Éditeur d'un nœud Synth -->
    <div v-if="synthModalOpen && selectedSynth" class="syntp-modal">
      <div class="syntp-modal-inner">
        <SynthEditor
          :patch="selectedSynth"
          :synth="selectedSynth"
          closeable
          @update:synth="handleSynthUpdate"
          @close="closeSynth"
        />
      </div>
    </div>

    <!-- Éditeur récursif d'un nœud SuperSynth -->
    <div
      v-if="superModalOpen && editingSuperPatch"
      class="syntp-modal syntp-super-modal"
    >
      <div class="syntp-modal-inner">
        <SynthPatchEditor
          :key="editingSuperModule?.id"
          :patch="editingSuperPatch"
          nested
          closeable
          @close="closeSuper"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.syntp-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.syntp-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid #ddd;
  background: #fafafa;
}

.syntp-title {
  font-weight: 700;
  color: #5b2c6f;
  margin-right: 6px;
}

.syntp-btn {
  padding: 6px 12px;
  border: 1px solid #bbb;
  border-radius: 4px;
  background: #fff;
  color: #333;
  cursor: pointer;
  font-weight: 600;
  font-size: 13px;
}

.syntp-btn.actif {
  background: #017a66;
  border-color: #017a66;
  color: #fff;
}

.syntp-btn-super {
  border-color: #8e44ad;
  color: #6c3483;
}

.syntp-btn-super:hover {
  background: #8e44ad;
  color: #fff;
}

.syntp-btn-close {
  margin-left: auto;
  background: #444;
  border-color: #444;
  color: #fff;
}

.syntp-sep {
  width: 1px;
  height: 22px;
  background: #ddd;
  margin: 0 4px;
}

.syntp-synth-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 12px;
  border-bottom: 1px solid #eee;
  background: #f8f3fc;
}

.syntp-strip-label {
  font-weight: 700;
  font-size: 12px;
  color: #6c3483;
  margin-right: 2px;
}

.syntp-synth-btn {
  padding: 4px 10px;
  border: 1px solid #8e44ad;
  border-radius: 999px;
  background: #fff;
  color: #6c3483;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.syntp-synth-btn:hover {
  background: #8e44ad;
  color: #fff;
}

.syntp-super-btn {
  border-color: #6c3483;
  background: #f0e6f7;
}

.syntp-empty {
  font-size: 12px;
  color: #888;
}

.syntp-editors {
  position: relative;
  flex: 1;
  min-height: 0;
}

.syntp-modal {
  position: fixed;
  inset: 0;
  z-index: 4000;
  background: #fff;
  overflow: auto;
}

.syntp-super-modal {
  z-index: 4100;
}

.syntp-modal-inner {
  min-height: 100vh;
  background: #fff;
}
</style>
