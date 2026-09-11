<script setup>
import { ref, computed, watch, onBeforeUnmount } from "vue"
import Swal from "sweetalert2"
import { usePatchStorage } from "../composables/usePatchStorage"

/* =========================================================
 * Synthé complet (patch complet) : enregistre le VOICE + MAIN
 * patch en un seul objet pour sauvegarder/recharger le synthé
 * entier d'un coup. À distinguer du Patch Manager classique,
 * qui ne gère qu'un patch (voice OU main) à la fois.
 *
 * Format sauvegardé :
 *   { version, name, voicePatch: {modules, connections},
 *     mainPatch: {modules, connections} }
 * ========================================================= */

const emit = defineEmits(["load"])

const props = defineProps({
  voicePatch: { type: Object, required: true },
  mainPatch: { type: Object, required: true },
})

const STORAGE_KEY = "modular-synth-patches"
const storage = usePatchStorage(STORAGE_KEY)

const patchName = ref("")
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

watch(modalOpen, (open) => {
  document.body.style.overflow = open ? "hidden" : ""
})
onBeforeUnmount(() => {
  document.body.style.overflow = ""
})

const buildSynthPatch = () => ({
  version: 1,
  name: patchName.value || "synth",
  voicePatch: deepClone(props.voicePatch),
  mainPatch: deepClone(props.mainPatch),
})

/* =========================
 * SAVE
 * ========================= */
const savePatch = async () => {
  if (!patchName.value) {
    Swal.fire({ title: "Nom du synthéthiseur requis", icon: "warning", confirmButtonText: "OK" })
    return
  }
  if (storage.names().includes(patchName.value)) {
    const res = await Swal.fire({
      title: "Remplacer le synthéthiseur existant ?",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Remplacer",
      cancelButtonText: "Annuler",
    })
    if (!res.isConfirmed) return
  }
  storage.save(patchName.value, buildSynthPatch())
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
const exportFile = () => {
  const data = buildSynthPatch()
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
    const text = await file.text()
    const data = JSON.parse(text)
    if (!data.voicePatch || !data.mainPatch) {
      Swal.fire({
        title: "Fichier invalide",
        text: "Un synthéthiseur complet doit contenir voicePatch et mainPatch.",
        icon: "error",
        confirmButtonText: "OK",
      })
      return
    }
    patchName.value = data.name || ""
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
    <input v-model="patchName" placeholder="Nom du synthéthiseur" class="spm-name" @keyup.enter="savePatch" />
    <button class="spm-btn" @click="savePatch">Enregistrer</button>
    <button class="spm-btn" @click="exportFile">Exporter</button>
    <label class="spm-import">
      Importer
      <input type="file" accept=".json" hidden @change="importFile" />
    </label>

    <button class="spm-btn spm-select" @click="openModal">
      {{ selected || "— Sélectionner synthéthiseur —" }}
    </button>
    <button class="spm-btn" :disabled="!selected" @click="loadSelected">Recharger</button>
    <button class="spm-btn danger" :disabled="!selected" @click="deletePatch">Supprimer</button>
  </div>

  <div v-if="modalOpen" class="spm-modal" @click.self="modalOpen = false">
    <div class="spm-modal-box">
      <div class="spm-modal-head">
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