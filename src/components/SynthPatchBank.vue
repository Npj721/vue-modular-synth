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
  <div class="d-flex align-items-center flex-wrap gap-2 px-3 py-2 border-bottom bg-body-tertiary">
    <span class="fw-bold me-1">SynthPatch</span>

    <button class="btn btn-sm btn-outline-dark" :disabled="!selected" @click="savePatch">
      Enregistrer
    </button>
    <button class="btn btn-sm btn-outline-dark" @click="savePatchAs">Enregistrer sous</button>

    <button
      class="btn btn-sm btn-outline-dark"
      :disabled="!available.length"
      @click="cyclePatch(-1)"
    >◀</button>
    <button class="btn btn-sm btn-outline-dark text-start" style="min-width: 220px" @click="openModal">
      {{ selected || "— Sélectionner un SynthPatch —" }}
    </button>
    <button
      class="btn btn-sm btn-outline-dark"
      :disabled="!available.length"
      @click="cyclePatch(1)"
    >▶</button>

    <button class="btn btn-sm btn-outline-dark" @click="exportFile">Exporter</button>
    <label class="btn btn-sm btn-outline-dark mb-0">
      Importer
      <input type="file" accept=".json" hidden @change="importFile" />
    </label>
  </div>

  <div
    v-if="modalOpen"
    class="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
    style="z-index: 5000; background: rgba(0, 0, 0, 0.45)"
    @click.self="modalOpen = false"
  >
    <div
      class="d-flex flex-column gap-2 p-3 bg-body rounded-3 shadow-lg"
      style="width: min(560px, 92vw); max-height: 80vh"
    >
      <div class="d-flex align-items-center justify-content-between fw-bold">
        <span>Liste des SynthPatches</span>
        <button class="btn-close" type="button" aria-label="Fermer" @click="modalOpen = false"></button>
      </div>
      <input
        v-model="filter"
        class="form-control form-control-sm"
        type="text"
        placeholder="Filtrer"
      />
      <div class="overflow-auto">
        <table class="table table-sm table-hover align-middle mb-0">
          <thead>
            <tr>
              <th>Nom</th>
              <th style="width: 44px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!available.length">
              <td colspan="2" class="text-center text-body-secondary">Aucun SynthPatch enregistré</td>
            </tr>
            <tr v-else-if="!filtered.length">
              <td colspan="2" class="text-center text-body-secondary">Aucun résultat pour « {{ filter }} »</td>
            </tr>
            <tr
              v-for="name in filtered"
              :key="name"
              :class="{ 'table-primary': name === selected }"
              style="cursor: pointer"
              @click="selectPatch(name)"
            >
              <td class="fw-semibold">{{ name }}</td>
              <td>
                <button
                  class="btn btn-sm btn-link text-danger-emphasis p-0 border-0"
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
