<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue"
import Swal from "sweetalert2"
import MidiController from "./MidiController.vue"
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
  <div class="synth-patch-manager">
    <span class="spm-title">synthéthiseur complet</span>
    <button class="spm-btn" :disabled="!hasVoiceModules || !selected" @click="savePatch">Enregistrer</button>
    <button class="spm-btn" :disabled="!hasVoiceModules" @click="savePatchAs">Enregistrer sous</button>
    

    <button class="spm-btn spm-nav" :disabled="!availableSynths.length" @click="cycleSynth(-1)">◀</button>
    <button class="spm-btn spm-select" @click="openModal">
      {{ selected || "— Sélectionner synthéthiseur —" }}
    </button>
    <button class="spm-btn spm-nav" :disabled="!availableSynths.length" @click="cycleSynth(1)">▶</button>
    <button v-if="selected" class="spm-btn" @click="exportFile">Exporter</button>
    <button v-if="false" class="spm-btn" :disabled="!selected" @click="loadSelected">Recharger</button>
    <button v-if="false" class="spm-btn danger" :disabled="!selected" @click="deletePatch">Supprimer</button>
    <div class="spm-midi-sep"></div>
    <MidiController :patch="props.patch" />
  </div>

  <div v-if="modalOpen" class="spm-modal" @click.self="modalOpen = false">
    <div class="spm-modal-box">
      <div class="spm-modal-head">
        <label class="spm-import">
          Importer
          <input type="file" accept=".json" hidden @change="importFile" />
        </label>
        <span>Liste des synthéthiseurs</span>
        <button class="spm-btn" @click="modalOpen = false">✕</button>
      </div>
      <input
        v-model="filter"
        class="spm-search"
        type="text"
        placeholder="Filtrer"
      />
      <div class="spm-table-wrap">
<table class="spm-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!availableSynths.length" class="spm-empty">
              <td colspan="2">Aucun synthé enregistré</td>
            </tr>
            <tr v-else-if="!filteredSynths.length" class="spm-empty">
              <td colspan="2">Aucun résultat pour « {{ filter }} »</td>
            </tr>
            <tr
              v-for="name in filteredSynths"
              :key="name"
              :class="{ current: name === selected }"
              @click="selectSynth(name)"
            >
              <td class="spm-name-cell">{{ name }}</td>
              <td>
                <button
                  class="spm-del"
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

<style scoped>
.synth-patch-manager {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 6px 12px;
  background: #12332b;
  border-bottom: 1px solid #0b3a2f;
  color: #cfd8d4;
  font-size: 13px;
}
.spm-title {
  font-weight: bold;
  color: #00ffd0;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-right: 4px;
}

.spm-midi-sep {
  width: 1px;
  align-self: stretch;
  background: rgba(255, 255, 255, 0.15);
  margin: 0 2px;
}
.synth-patch-manager :deep(.midi-controller) {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 2px 0;
  border: none;
  border-radius: 0;
  background: transparent;
}
.synth-patch-manager :deep(.midi-hint),
.synth-patch-manager :deep(.midi-error) {
  display: none;
}
.synth-patch-manager :deep(.midi-status) {
  color: #8fb3a8;
  font-size: 12px;
}
.synth-patch-manager :deep(.midi-status.ok) {
  color: #00ffd0;
}
.synth-patch-manager :deep(.midi-select) {
  min-width: 180px;
  padding: 3px 6px;
  border: 1px solid #2c5a4c;
  border-radius: 4px;
  background: #0b211a;
  color: #d6e7e0;
}
.synth-patch-manager :deep(.midi-btn) {
  padding: 3px 10px;
  border: 1px solid #2c5a4c;
  border-radius: 4px;
  background: #174035;
  color: #cfd8d4;
}
.synth-patch-manager :deep(.midi-btn:disabled) {
  opacity: 0.6;
  cursor: default;
}
.synth-patch-manager :deep(.midi-btn.request) {
  background: #0e7a60;
  border-color: #0a5a46;
  color: white;
}
.synth-patch-manager :deep(.midi-btn.request:disabled) {
  background: #1d4d40;
}
.synth-patch-manager :deep(.midi-btn.connect.active) {
  background: #a33d47;
  border-color: #7d2c34;
  color: white;
}
.spm-name,
.spm-select {
  padding: 4px 6px;
  border: 1px solid #2c5a4c;
  border-radius: 4px;
  background: #0b211a;
  color: #d6e7e0;
}
.spm-select {
  min-width: 180px;
}
.spm-btn {
  padding: 4px 12px;
  border: 1px solid #2c5a4c;
  border-radius: 4px;
  background: #174035;
  color: #d6e7e0;
  cursor: pointer;
  font-weight: bold;
}
.spm-btn:hover:not(:disabled) {
  background: #1f5547;
  border-color: #00ffd0;
}
.spm-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.spm-btn.danger {
  background: #4a1f1f;
  border-color: #7a3a3a;
}
.spm-btn.danger:hover:not(:disabled) {
  background: #662b2b;
}
.spm-import {
  padding: 4px 12px;
  border: 1px solid #2c5a4c;
  border-radius: 4px;
  background: #174035;
  color: #d6e7e0;
  cursor: pointer;
  font-weight: bold;
}
.spm-import:hover {
  background: #1f5547;
  border-color: #00ffd0;
}
.spm-select {
  min-width: 180px;
  text-align: left;
  cursor: pointer;
}
.spm-nav {
  width: 28px;
  padding: 4px 0;
  text-align: center;
}
.spm-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.spm-modal-box {
  width: auto;
  min-width: 80vw;
  max-width: 85vw;
  height: fit-content;
  min-height: 80vh;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: #0e2b22;
  border: 1px solid #2c5a4c;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}
.spm-modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid #2c5a4c;
  color: #00ffd0;
  font-weight: bold;
}
.spm-search {
  margin: 8px 12px;
  padding: 4px 8px;
  border: 1px solid #2c5a4c;
  border-radius: 4px;
  background: #0b211a;
  color: #d6e7e0;
  font-size: 12px;
}
.spm-table-wrap {
  flex: 0 1 auto;
  min-height: 0;
  max-height: 60%;
  overflow-y: auto;
}
.spm-table {
  width: 100%;
  border-collapse: collapse;
}
.spm-table th {
  color: #6fa08f;
  font-size: 11px;
  font-weight: normal;
  text-align: left;
  padding: 6px 12px;
  border-bottom: 1px solid #1f4538;
}
.spm-table td {
  padding: 8px 12px;
  cursor: pointer;
  color: #d6e7e0;
  border-bottom: 1px solid #1f4538;
}
.spm-name-cell {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 0;
}
.spm-del {
  width: 24px;
  height: 22px;
  line-height: 1;
  padding: 0;
  font-size: 12px;
  background: #4a1f1f;
  color: #f0b6b6;
  border: 1px solid #7a3a3a;
  border-radius: 3px;
  cursor: pointer;
}
.spm-del:hover {
  background: #662b2b;
}
.spm-table tr:hover td {
  background: #174035;
  color: #00ffd0;
}
.spm-table tr.current td {
  background: #00ffd0;
  color: #0b211a;
  font-weight: bold;
}
.spm-table tr.spm-empty {
  cursor: default;
}
.spm-table tr.spm-empty td {
  color: #6fa08f;
}
.spm-table tr.spm-empty:hover td {
  background: transparent;
  color: #6fa08f;
}
</style>