<script setup>
import { ref, computed } from "vue"
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

const deepClone = (v) => JSON.parse(JSON.stringify(v ?? {}))

const availableSynths = computed(() => {
  saveCounter.value // reactive dependency
  return storage.names().sort((a, b) => a.localeCompare(b))
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
const savePatch = () => {
  if (!patchName.value) {
    alert("Nom du synthé requis")
    return
  }
  if (storage.names().includes(patchName.value) && !confirm("Remplacer le synthé existant ?")) return
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

/* =========================
 * DELETE
 * ========================= */
const deletePatch = () => {
  if (!selected.value) return
  if (!confirm("Supprimer ce synthé complet ?")) return
  storage.remove(selected.value)
  selected.value = ""
  saveCounter.value++
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
      alert("Fichier invalide : un synthé complet doit contenir voicePatch et mainPatch.")
      return
    }
    patchName.value = data.name || ""
    emit("load", data)
  } catch (err) {
    alert("Lecture du fichier impossible : " + err.message)
  }

  e.target.value = ""
}
</script>

<template>
  <div class="synth-patch-manager">
    <span class="spm-title">Synthé complet</span>
    <input v-model="patchName" placeholder="Nom du synthé" class="spm-name" @keyup.enter="savePatch" />
    <button class="spm-btn" @click="savePatch">Enregistrer</button>
    <button class="spm-btn" @click="exportFile">Exporter</button>
    <label class="spm-import">
      Importer
      <input type="file" accept=".json" hidden @change="importFile" />
    </label>

    <select v-model="selected" class="spm-select">
      <option value="" disabled>— Choisir un synthé —</option>
      <option v-for="name in availableSynths" :key="name" :value="name">{{ name }}</option>
    </select>
    <button class="spm-btn" :disabled="!selected" @click="loadSelected">Charger</button>
    <button class="spm-btn danger" :disabled="!selected" @click="deletePatch">Supprimer</button>
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
</style>