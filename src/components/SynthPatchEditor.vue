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

import { ref, computed, nextTick, watch } from "vue"
import Swal from "sweetalert2"
import PatchEditor from "./PatchEditor.vue"
import SynthEditor from "./SynthEditor.vue"
import SynthPatchBank from "./SynthPatchBank.vue"
import { useDockState } from "../composables/useDockState"
import { useSuperSynthBank } from "../composables/useSuperSynthBank.js"
import { useSynthBank } from "../composables/useSynthBank.js"
import {
  getSynthModules,
  getSuperSynthModules,
  normalizeSynthPatch,
  createSuperSynthDefinition,
  emptySynthPatch,
  applySynthToModule,
  emptyGraph,
} from "../composables/useSynthPatch.js"

const NOTE_DRIVEN = ["voice", "wavetable", "wavetableS"]

const props = defineProps({
  patch: { type: Object, required: true },
  // Éditeur imbriqué (définition d'un SuperSynth) : pas de banque de
  // SynthPatch, interface super.in/super.out dans la couche main.
  nested: { type: Boolean, default: false },
  closeable: { type: Boolean, default: false },
})

// Les sources d'événements (clavier, séquenceur) n'ont de sens qu'au niveau
// supérieur : un SuperSynth reçoit ses notes par son entrée Events. On les
// masque donc dans l'éditeur imbriqué pour éviter des sources inertes.
const voiceExcludeCategories = computed(() =>
  props.nested ? ["super", "event"] : ["super"]
)

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
 * Banque de synthés complets (modular-synth-patches)
 * ========================================================= */

const synthBank = useSynthBank()
const synthBankNames = computed(() => synthBank.names())
const selectedBankSynth = ref("")

// Pré-sélectionne le premier synthé dès que la banque est disponible (le
// seed des synthés de base est asynchrone au démarrage).
watch(
  synthBankNames,
  (names) => {
    if (!selectedBankSynth.value && names.length) {
      selectedBankSynth.value = names[0]
    }
  },
  { immediate: true }
)

const addSynthFromBank = () => {
  const name = selectedBankSynth.value
  if (!name) return

  const synth = synthBank.get(name)
  if (!synth) return

  const count = (props.patch.voice.modules ?? []).filter(
    (m) => m.type === "synth"
  ).length
  const position = {
    x: 80 + (count % 4) * 200,
    y: 80 + Math.floor(count / 4) * 180,
  }

  const id = voiceEditor.value?.addModule(
    "synth",
    {
      name: synth.name ?? name,
      voicePatch: synth.voicePatch ?? emptyGraph(),
      mainPatch: synth.mainPatch ?? emptyGraph(),
    },
    position
  )

  if (id) {
    voiceEditor.value?.setModuleLabel(id, synth.name ?? name)
  }
  tab.value = "voice"
}

/** Remplace la définition d'un nœud Synth par un synthé de la banque. */
const handleLoadSynth = async (module) => {
  if (!module) return

  const names = synthBank.names()
  if (!names.length) {
    Swal.fire({
      title: "Aucun synthé enregistré",
      text: "Enregistrez d'abord un synthé depuis son éditeur (Patch Manager).",
      icon: "info",
      confirmButtonText: "OK",
    })
    return
  }

  const { value: name, isConfirmed } = await Swal.fire({
    title: "Charger un synthé",
    input: "select",
    inputOptions: Object.fromEntries(names.map((n) => [n, n])),
    inputPlaceholder: "Choisir un synthé",
    inputValue: module.params?.name ?? "",
    showCancelButton: true,
    confirmButtonText: "Charger",
    cancelButtonText: "Annuler",
  })
  if (!isConfirmed || !name) return

  const synth = synthBank.get(name)
  if (!synth) return

  applySynthToModule(module, synth)
  module.label = synth.name ?? name
  voiceEditor.value?.setModuleLabel(module.id, module.label)
  voiceEditor.value?.refreshSelectedModule()
}

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
  <div class="d-flex flex-column min-h-0">
    <SynthPatchBank
      v-if="!nested"
      :patch="props.patch"
      @load="handleLoad"
    />

    <div class="d-flex align-items-center flex-wrap gap-2 px-3 py-2 border-bottom bg-body-tertiary">
      <span v-if="nested" class="fw-bold text-primary-emphasis me-2">
        SuperSynth : {{ props.patch.name || "sans nom" }}
      </span>

      <button
        class="btn btn-sm"
        :class="tab === 'voice' ? 'btn-primary' : 'btn-outline-dark'"
        @click="tab = 'voice'"
      >SynthPatch Voice</button>
      <button
        class="btn btn-sm"
        :class="tab === 'main' ? 'btn-primary' : 'btn-outline-dark'"
        @click="tab = 'main'"
      >SynthPatch Main</button>

      <span class="vr mx-1"></span>

      <button
        v-if="!nested"
        class="btn btn-sm btn-outline-primary fw-bold"
        @click="createSuperSynth"
      >Créer un SuperSynth</button>

      <button class="btn btn-sm btn-outline-dark" @click="showVisualizer = !showVisualizer">
        {{ showVisualizer ? "◀ Spectrum" : "▶ Spectrum" }}
      </button>
      <button class="btn btn-sm btn-outline-dark" @click="showKeyboard = !showKeyboard">
        {{ showKeyboard ? "◀ Keyboard" : "▶ Keyboard" }}
      </button>

      <button
        v-if="closeable"
        class="btn btn-sm btn-dark ms-auto"
        type="button"
        @click="emit('close')"
      >✕ Fermer</button>
    </div>

    <div class="d-flex align-items-center flex-wrap gap-2 px-3 py-2 border-bottom bg-body-tertiary">
      <span class="small fw-bold text-primary-emphasis">Synths :</span>
      <button
        v-for="s in synthModules"
        :key="s.id"
        class="btn btn-sm btn-outline-primary rounded-pill"
        @click="openSynth(s.id)"
      >
        {{ s.name }}
      </button>
      <button
        v-for="s in superModules"
        :key="s.id"
        class="btn btn-sm btn-primary rounded-pill"
        @click="openSuper(s.module)"
      >
        ★ {{ s.name }}
      </button>
      <span
        v-if="!synthModules.length && !superModules.length"
        class="small text-body-secondary"
      >
        aucun — ajoutez un module « Synth » ou « SuperSynth » via le menu contextuel
      </span>

      <span class="vr mx-1"></span>
      <span class="small fw-bold text-primary-emphasis">Banque :</span>
      <select v-model="selectedBankSynth" class="form-select form-select-sm" style="min-width: 150px; width: auto">
        <option value="">— choisir —</option>
        <option v-for="n in synthBankNames" :key="n" :value="n">
          {{ n }}
        </option>
      </select>
      <button
        class="btn btn-sm btn-outline-success"
        :disabled="!selectedBankSynth"
        @click="addSynthFromBank"
      >
        Ajouter ce synthé
      </button>
    </div>

    <div class="position-relative flex-grow-1 min-h-0">
      <PatchEditor
        ref="voiceEditor"
        v-show="tab === 'voice'"
        :patch="props.patch.voice"
        :initial-patch="props.patch.voice"
        :show-patch-manager="false"
        :exclude-types="NOTE_DRIVEN"
        :exclude-categories="voiceExcludeCategories"
        :super-export-enabled="false"
        :inactive="synthModalOpen || superModalOpen"
        @edit-synth="handleEditSynth"
        @load-synth="handleLoadSynth"
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
        :exclude-categories="['synth', 'super', 'event']"
        :allow-interface-modules="nested"
        :super-export-enabled="false"
        :inactive="synthModalOpen || superModalOpen"
      />
    </div>

    <!-- Éditeur d'un nœud Synth -->
    <div
      v-if="synthModalOpen && selectedSynth"
      class="position-fixed top-0 start-0 w-100 h-100 bg-body overflow-auto"
      style="z-index: 4000"
    >
      <div class="min-vh-100 bg-body">
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
      class="position-fixed top-0 start-0 w-100 h-100 bg-body overflow-auto"
      style="z-index: 4100"
    >
      <div class="min-vh-100 bg-body">
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
