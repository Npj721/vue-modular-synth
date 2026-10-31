<script setup>
// components/SynthPatchBank.vue
//
// Sauvegarde / chargement / import / export d'un SynthPatch complet
// (couche voice + couche main + synthés embarqués).
//
// Format exporté : { version: 2, name, voice, main, superModule?, FX? }
// Les anciens fichiers .synth.json ({ voicePatch, mainPatch }) restent
// importables : ils sont normalisés en SynthPatch contenant un seul Synth.

import { ref, computed, watch, onBeforeUnmount } from "vue"
import Swal from "sweetalert2"
import { usePatchStorage } from "../composables/usePatchStorage"
import { collectSuperModules } from "../composables/superModuleTransfer.js"
import { buildAudioPayload } from "../composables/audioTransfer.js"
import { installSynthDependencies } from "../composables/synthTransfer.js"
import { normalizeSynthPatch } from "../composables/useSynthPatch.js"

const emit = defineEmits(["load"])

const props = defineProps({
  patch: { type: Object, required: true },
})

const STORAGE_KEY = "modular-synthpatches"
const storage = usePatchStorage(STORAGE_KEY)

const selected = ref("")
const saveCounter = ref(0)
const modalOpen = ref(false)
const filter = ref("")

const deepClone = (v) => JSON.parse(JSON.stringify(v ?? {}))

const available = computed(() => {
  saveCounter.value // dépendance réactive
  return storage.names().sort((a, b) => a.localeCompare(b))
})

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return available.value.filter((n) => !q || n.toLowerCase().includes(q))
})

watch(modalOpen, (open) => {
  document.body.style.overflow = open ? "hidden" : ""
})
onBeforeUnmount(() => {
  document.body.style.overflow = ""
})

/** Parcourt les couches voice/main et tous les graphes imbriqués. */
function eachGraph(patch, fn) {
  for (const layer of [patch?.voice, patch?.main]) {
    if (!layer) continue
    fn(layer)
    for (const mod of layer.modules ?? []) {
      if (mod?.type === "synth") {
        if (mod.params?.voicePatch) fn(mod.params.voicePatch)
        if (mod.params?.mainPatch) fn(mod.params.mainPatch)
      } else if (mod?.type === "superSynth") {
        eachGraph(mod.params?.synthPatch, fn)
      }
    }
  }
}

function buildSynthPatch(name = selected.value || "SynthPatch") {
  return {
    version: 2,
    name,
    voice: deepClone(props.patch.voice ?? { modules: [], connections: [] }),
    main: deepClone(props.patch.main ?? { modules: [], connections: [] }),
  }
}

/* =========================
 * SAVE
 * ========================= */
const savePatch = () => {
  if (!selected.value) return
  storage.save(selected.value, buildSynthPatch(selected.value))
  saveCounter.value++
}

const savePatchAs = async () => {
  const { value: name, isConfirmed } = await Swal.fire({
    title: "Enregistrer le SynthPatch sous",
    input: "text",
    inputPlaceholder: "Nom du SynthPatch",
    inputValue: selected.value ? `${selected.value} - ` : "",
    inputValidator: (v) => (v && v.trim() ? undefined : "Nom requis"),
    showCancelButton: true,
    confirmButtonText: "Enregistrer",
    cancelButtonText: "Annuler",
  })
  if (!isConfirmed || !name) return
  const cleanName = name.trim()
  if (storage.names().includes(cleanName)) {
    const res = await Swal.fire({
      title: "Remplacer le SynthPatch existant ?",
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
  emit("load", normalizeSynthPatch(data))
}

const selectPatch = (name) => {
  selected.value = name
  modalOpen.value = false
  loadSelected()
}

const cyclePatch = (delta) => {
  const list = available.value
  if (!list.length) return
  const current = selected.value ? list.indexOf(selected.value) : -1
  const next = (current + delta + list.length) % list.length
  selectPatch(list[next])
}

/* =========================
 * DELETE
 * ========================= */
const deletePatch = async (name) => {
  if (!name) return
  const res = await Swal.fire({
    title: `Supprimer le SynthPatch « ${name} » ?`,
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

/* =========================
 * EXPORT
 * ========================= */
const exportFile = async () => {
  const data = buildSynthPatch()

  // super-modules utilisés, y compris dans les synthés embarqués
  const defs = []
  eachGraph(data, (graph) => {
    defs.push(...collectSuperModules(graph))
  })
  const byType = new Map(defs.map((d) => [d.type, d]))
  if (byType.size) data.superModule = [...byType.values()]

  // fichiers audio (samples / IR) de tous les graphes
  const graphs = []
  eachGraph(data, (graph) => graphs.push(graph))
  const audio = await buildAudioPayload(graphs)
  if (Object.keys(audio).length) data.FX = audio

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  })
  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${data.name}.synthpatch.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

/* =========================
 * IMPORT
 * ========================= */
const importFile = async (e) => {
  const file = e.target.files[0]
  if (!file) return

  try {
    const data = JSON.parse(await file.text())
    const normalized = normalizeSynthPatch(data)

    if (!(await installSynthDependencies(data))) return

    emit("load", normalized)
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

const openModal = () => {
  filter.value = ""
  modalOpen.value = true
}
</script>

<template>
  <div class="synth-patch-bank">
    <span class="spb-title">SynthPatch</span>

    <button class="spb-btn" :disabled="!selected" @click="savePatch">
      Enregistrer
    </button>
    <button class="spb-btn" @click="savePatchAs">Enregistrer sous</button>

    <button
      class="spb-btn spb-nav"
      :disabled="!available.length"
      @click="cyclePatch(-1)"
    >◀</button>
    <button class="spb-btn spb-select" @click="openModal">
      {{ selected || "— Sélectionner un SynthPatch —" }}
    </button>
    <button
      class="spb-btn spb-nav"
      :disabled="!available.length"
      @click="cyclePatch(1)"
    >▶</button>

    <button class="spb-btn" @click="exportFile">Exporter</button>
    <label class="spb-btn spb-import">
      Importer
      <input type="file" accept=".json" hidden @change="importFile" />
    </label>
  </div>

  <div v-if="modalOpen" class="spb-modal" @click.self="modalOpen = false">
    <div class="spb-modal-box">
      <div class="spb-modal-head">
        <span>Liste des SynthPatches</span>
        <button class="spb-btn" @click="modalOpen = false">✕</button>
      </div>
      <input
        v-model="filter"
        class="spb-search"
        type="text"
        placeholder="Filtrer"
      />
      <div class="spb-table-wrap">
        <table class="spb-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!available.length" class="spb-empty">
              <td colspan="2">Aucun SynthPatch enregistré</td>
            </tr>
            <tr v-else-if="!filtered.length" class="spb-empty">
              <td colspan="2">Aucun résultat pour « {{ filter }} »</td>
            </tr>
            <tr
              v-for="name in filtered"
              :key="name"
              :class="{ current: name === selected }"
              @click="selectPatch(name)"
            >
              <td class="spb-name-cell">{{ name }}</td>
              <td>
                <button
                  class="spb-del"
                  title="Supprimer ce SynthPatch"
                  @click.stop="deletePatch(name)"
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
.synth-patch-bank {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 12px;
  border-bottom: 1px solid #ddd;
  background: #f7f7f7;
}

.spb-title {
  font-weight: 700;
  color: #333;
  margin-right: 4px;
}

.spb-btn {
  padding: 5px 10px;
  border: 1px solid #bbb;
  border-radius: 4px;
  background: #fff;
  color: #333;
  cursor: pointer;
  font-size: 13px;
}

.spb-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.spb-select {
  min-width: 220px;
  text-align: left;
}

.spb-import {
  display: inline-flex;
  align-items: center;
}

.spb-modal {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.spb-modal-box {
  width: min(560px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3);
}

.spb-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 700;
}

.spb-search {
  padding: 6px 9px;
  border: 1px solid #ccc;
  border-radius: 4px;
}

.spb-table-wrap {
  overflow: auto;
}

.spb-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.spb-table th,
.spb-table td {
  padding: 6px 8px;
  border-bottom: 1px solid #eee;
  text-align: left;
}

.spb-table tbody tr {
  cursor: pointer;
}

.spb-table tbody tr:hover,
.spb-table tbody tr.current {
  background: #eef7f4;
}

.spb-name-cell {
  font-weight: 600;
}

.spb-empty {
  color: #888;
  text-align: center;
}

.spb-del {
  border: none;
  background: transparent;
  color: #c0392b;
  cursor: pointer;
  font-size: 14px;
}
</style>
