<script setup>
import { ref, computed } from "vue"
import Swal from "sweetalert2"
import { usePatchStorage } from "../composables/usePatchStorage"
import {
  collectSuperModules,
  installSuperModulesFromFile,
} from "../composables/superModuleTransfer.js"
import {
  buildAudioPayload,
  installAudioFilesFromFile,
} from "../composables/audioTransfer.js"

const emit = defineEmits(['patch-loaded'])

const props = defineProps({
  paperRef: { type: Object, required: false },
  patch: { type: Object, required: false },
})

const {
  save,
  load,
  remove,
  names
} = usePatchStorage()

const patchName = ref("")
const filter = ref("")
const selected = ref(null)
const saveCounter = ref(0)

const availablePatches = computed(() => {
  saveCounter.value // reactive dependency
  return names().filter(n =>
    n.toLowerCase().includes(filter.value.toLowerCase())
  )
})

/* =========================
 * SAVE
 * ========================= */
const savePatch = async () => {
  if (!patchName.value) {
    Swal.fire({ title: "Patch name required", icon: "warning", confirmButtonText: "OK" })
    return
  }

  const exists = names().includes(patchName.value)
  if (exists) {
    const res = await Swal.fire({
      title: "Overwrite existing patch?",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Overwrite",
      cancelButtonText: "Cancel",
    })
    if (!res.isConfirmed) return
  }
  save(patchName.value, props.patch)
  saveCounter.value++
}

/* =========================
 * LOAD
 * ========================= */

const loadPatchByName = (name) => {
  const patch = load(name)
  if (!patch) return

  props.paperRef.loadPatch(patch)

   emit('patch-loaded', patch)
}


/* =========================
 * DELETE
 * ========================= */
const deletePatch = async () => {
  if (!selected.value) return
  const res = await Swal.fire({
    title: "Delete patch?",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Delete",
    cancelButtonText: "Cancel",
    confirmButtonColor: "#d33",
  })
  if (!res.isConfirmed) return

  remove(selected.value)
  selected.value = null
  saveCounter.value++
}

/* =========================
 * EXPORT FILE
 * ========================= */
const exportFile = async () => {
  const patch = props.paperRef.exportPatch()
  patch.name = patchName.value || "patch"

  // Emporter les super-modules utilisés par le patch pour permettre
  // l'importation sur un poste qui ne les connaît pas encore.
  const defs = collectSuperModules(patch)
  if (defs.length) patch.superModule = defs

  // Emporter les fichiers audio (samples / IR) utilisés par les modules FX,
  // y compris ceux utilisés à l'intérieur des super-modules.
  const audio = await buildAudioPayload([patch])
  if (Object.keys(audio).length) patch.FX = audio

  const blob = new Blob(
    [JSON.stringify(patch, null, 2)],
    { type: "application/json" }
  )

  const a = document.createElement("a")
  a.href = URL.createObjectURL(blob)
  a.download = `${patch.name}.json`
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
    const patch = JSON.parse(text)

    // Crée d'abord les super-modules du fichier (avec confirmation en cas
    // de collision de nom), puis les fichiers audio, et seulement ensuite
    // le patch qui les référence.
    const proceedSuper = await installSuperModulesFromFile(patch.superModule)
    if (!proceedSuper) return
    const proceedAudio = await installAudioFilesFromFile(patch.FX)
    if (!proceedAudio) return

    patchName.value = patch.name || ""
    props.paperRef.importPatch(patch)
  } catch (err) {
    Swal.fire({
      title: "Import impossible",
      text: err.message,
      icon: "error",
      confirmButtonText: "OK",
    })
  }
}
</script>

<template>
  <div class="d-flex flex-column gap-2 border rounded p-3 bg-body-tertiary">
    <h3 class="h6 mb-0">Patch Manager</h3>

    <!-- Name -->
    <input
      v-model="patchName"
      placeholder="Patch name"
      class="form-control form-control-sm"
    />

    <!-- Actions -->
    <div class="d-flex gap-2 flex-wrap">
      <button class="btn btn-sm btn-primary" @click="savePatch">Save</button>
      <button class="btn btn-sm btn-outline-primary" @click="exportFile">Export</button>

      <label class="btn btn-sm btn-outline-dark mb-0">
        Import
        <input type="file" accept=".json" hidden @change="importFile" />
      </label>
    </div>

    <!-- Filter -->
    <input
      v-model="filter"
      placeholder="Filter patches"
      class="form-control form-control-sm"
    />

    <!-- Patch list -->
    <ul class="list-group overflow-auto" style="max-height: 140px">
      <li
        v-for="name in availablePatches"
        :key="name"
        class="list-group-item list-group-item-action py-1"
        :class="{ active: selected === name }"
        style="cursor: pointer"
        @click="selected = name"
      >
        {{ name }}
      </li>
    </ul>

    <!-- Load/Delete -->
    <div class="d-flex gap-2">
      <button class="btn btn-sm btn-primary" @click="loadPatchByName(selected)">Load</button>
      <button class="btn btn-sm btn-danger" :disabled="!selected" @click="deletePatch">Delete</button>
    </div>
  </div>
</template>
