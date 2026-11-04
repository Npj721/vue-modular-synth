<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue"
import Swal from "sweetalert2"
//import MidiController from "./MidiController.vue"
import { usePatchStorage } from "../composables/usePatchStorage"
import {
  collectSuperModules,
} from "../composables/superModuleTransfer.js"
import {
  buildAudioPayload,
} from "../composables/audioTransfer.js"
import {
  parseSynthText,
  installSynthDependencies,
} from "../composables/synthTransfer.js"

/* =========================================================
 * Synthé complet (patch complet) : enregistre le VOICE + MAIN
 * patch en un seul objet pour sauvegarder/recharger le synthé
 * entier d'un coup. À distinguer du Patch Manager classique,
 * qui ne gère qu'un patch (voice OU main) à la fois.
 *
 * Format sauvegardé :
 *   { version, name, voicePatch: {modules, connections},
 *     mainPatch: {modules, connections},
 *     superModule?: [définitions de super-modules utilisés],
 *     FX?: { nomFichier -> base64 des fichiers audio utilisés } }
 * ========================================================= */

const emit = defineEmits(["load"])

const props = defineProps({
  patch: { type: Object, required: true },
  voicePatch: { type: Object, required: true },
  mainPatch: { type: Object, required: true },
})

const STORAGE_KEY = "modular-synth-patches"
const storage = usePatchStorage(STORAGE_KEY)

const selected = ref("")
const saveCounter = ref(0)
const modalOpen = ref(false)

const deepClone = (v) => JSON.parse(JSON.stringify(v ?? {}))

const availableSynths = computed(() => {
  saveCounter.value // reactive dependency
  return storage.names().sort((a, b) => a.localeCompare(b))
})

const filter = ref("")
const filteredSynths = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return availableSynths.value.filter((n) => !q || n.toLowerCase().includes(q))
})

const openModal = () => {
  filter.value = ""
  modalOpen.value = true
}

/* Enregistrer / Enregistrer sous ne sont possibles qu'avec au moins 1 module
   chargé dans le paper voice. */
const hasVoiceModules = computed(() => !!(props.voicePatch?.modules?.length))

watch(modalOpen, (open) => {
  document.body.style.overflow = open ? "hidden" : ""
})
onBeforeUnmount(() => {
  document.body.style.overflow = ""
})

const buildSynthPatch = (name = selected.value || "synth") => ({
  version: 1,
  name,
  voicePatch: deepClone(props.voicePatch),
  mainPatch: deepClone(props.mainPatch),
})

/* =========================
 * SAVE : écrase le synthé sélectionné
 * ========================= */
const savePatch = () => {
  if (!selected.value) return
  storage.save(selected.value, buildSynthPatch(selected.value))
  saveCounter.value++
}

/* =========================
 * SAVE AS : demande un nom (sweetalert2)
 * ========================= */
const savePatchAs = async () => {
  const { value: name, isConfirmed } = await Swal.fire({
    title: "Enregistrer sous",
    input: "text",
    inputPlaceholder: "Nom du synthéthiseur",
    inputValue: selected.value ? `${selected.value} - ` : '',
    inputValidator: (v) => (v && v.trim() ? undefined : "Nom requis"),
    showCancelButton: true,
    confirmButtonText: "Enregistrer",
    cancelButtonText: "Annuler",
  })
  if (!isConfirmed || !name) return
  const cleanName = name.trim()
  if (storage.names().includes(cleanName)) {
    const res = await Swal.fire({
      title: "Remplacer le synthéthiseur existant ?",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Remplacer",
      cancelButtonText: "Annuler",
    })
    if (!res.isConfirmed) return
  }
  storage.save(cleanName, buildSynthPatch(cleanName))
  selected.value = cleanName
  saveCounter.value++
}

/* =========================
 * LOAD
 * ========================= */
const loadSelected = () => {
  const data = storage.load(selected.value)
  if (!data) return
  emit("load", data)
}

const selectSynth = (name) => {
  selected.value = name
  modalOpen.value = false
  loadSelected()
}

/* Navigation circulaire dans la liste des synthés */
const cycleSynth = (delta) => {
  const list = availableSynths.value
  if (!list.length) return
  const current = selected.value ? list.indexOf(selected.value) : -1
  const next = (current + delta + list.length) % list.length
  selectSynth(list[next])
}

/* =========================
 * DELETE
 * ========================= */
const deleteSynth = async (name) => {
  if (!name) return
  const res = await Swal.fire({
    title: `Supprimer le synthé « ${name} » ?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Supprimer",
    cancelButtonText: "Annuler",
    confirmButtonColor: "#d33",
  })
  if (!res.isConfirmed) return
  storage.remove(name)
  if (name === selected.value) selected.value = ""
  saveCounter.value++
}

const deletePatch = async () => {
  await deleteSynth(selected.value)
}

/* =========================
 * EXPORT FILE
 * ========================= */
const exportFile = async () => {
  const data = buildSynthPatch()

  // Emporter les super-modules utilisés (récursivement) pour permettre
  // l'importation sur un poste qui ne les connaît pas encore.
  const byType = new Map(
    [
      ...collectSuperModules(data.voicePatch),
      ...collectSuperModules(data.mainPatch),
    ].map((d) => [d.type, d])
  )
  if (byType.size) data.superModule = [...byType.values()]

  // Emporter les fichiers audio (samples / IR) utilisés par les modules FX,
  // y compris ceux utilisés à l'intérieur des super-modules.
  const audio = await buildAudioPayload([data.voicePatch, data.mainPatch])
  if (Object.keys(audio).length) data.FX = audio

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${data.name}.synth.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* =========================
 * IMPORT FILE
 * ========================= */
const importFile = async (e) => {
  const file = e.target.files[0]
  if (!file) return

  try {
    const data = parseSynthText(await file.text())

    // Crée d'abord les super-modules du fichier (avec confirmation en cas
    // de collision de nom), puis les fichiers audio, et seulement ensuite
    // le synthé qui les référence.
    if (!(await installSynthDependencies(data))) return

    emit("load", data)
  } catch (err) {
    Swal.fire({
      title: "Lecture impossible",
      text: err.message,
      icon: "error",
      confirmButtonText: "OK",
    })
  }

  e.target.value = ""
}
</script>

<template>
  <div class="d-flex align-items-center flex-wrap gap-2 px-3 py-2 border-bottom bg-body-tertiary">
    <span class="fw-bold text-uppercase text-primary-emphasis me-1" style="letter-spacing: 1px">synthéthiseur complet</span>
    <button class="btn btn-sm btn-outline-dark" :disabled="!hasVoiceModules || !selected" @click="savePatch">Enregistrer</button>
    <button class="btn btn-sm btn-outline-dark" :disabled="!hasVoiceModules" @click="savePatchAs">Enregistrer sous</button>

    <button class="btn btn-sm btn-outline-dark" :disabled="!availableSynths.length" @click="cycleSynth(-1)">◀</button>
    <button class="btn btn-sm btn-outline-dark text-start" style="min-width: 180px" @click="openModal">
      {{ selected || "— Sélectionner synthéthiseur —" }}
    </button>
    <button class="btn btn-sm btn-outline-dark" :disabled="!availableSynths.length" @click="cycleSynth(1)">▶</button>
    <button v-if="hasVoiceModules" class="btn btn-sm btn-outline-dark" @click="exportFile">Exporter</button>
    <button v-if="false" class="btn btn-sm btn-outline-dark" :disabled="!selected" @click="loadSelected">Recharger</button>
    <button v-if="false" class="btn btn-sm btn-danger" :disabled="!selected" @click="deletePatch">Supprimer</button>
  </div>

  <div
    v-if="modalOpen"
    class="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
    style="z-index: 1000; background: rgba(0, 0, 0, 0.55)"
    @click.self="modalOpen = false"
  >
    <div
      class="d-flex flex-column bg-body border rounded-3 shadow-lg overflow-hidden"
      style="width: auto; min-width: 80vw; max-width: 85vw; height: fit-content; min-height: 80vh; max-height: 85vh"
    >
      <div class="d-flex align-items-center justify-content-between px-3 py-2 border-bottom fw-bold">
        <label class="btn btn-sm btn-outline-dark mb-0">
          Importer
          <input type="file" accept=".json" hidden @change="importFile" />
        </label>
        <span>Liste des synthéthiseurs</span>
        <button class="btn-close" type="button" aria-label="Fermer" @click="modalOpen = false"></button>
      </div>
      <input
        v-model="filter"
        class="form-control form-control-sm mx-3 my-2"
        style="width: auto"
        type="text"
        placeholder="Filtrer"
      />
      <div class="overflow-auto" style="max-height: 60%">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Nom</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!availableSynths.length">
              <td colspan="2" class="text-center text-body-secondary">Aucun synthé enregistré</td>
            </tr>
            <tr v-else-if="!filteredSynths.length">
              <td colspan="2" class="text-center text-body-secondary">Aucun résultat pour « {{ filter }} »</td>
            </tr>
            <tr
              v-for="name in filteredSynths"
              :key="name"
              :class="{ 'table-primary': name === selected }"
              style="cursor: pointer"
              @click="selectSynth(name)"
            >
              <td class="text-truncate fw-semibold" style="max-width: 0">{{ name }}</td>
              <td>
                <button
                  class="btn btn-sm btn-link text-danger-emphasis p-0 border-0"
                  title="Supprimer ce synthé"
                  @click.stop="deleteSynth(name)"
                >✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
