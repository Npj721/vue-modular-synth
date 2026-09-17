<script setup>
import { ref, computed } from "vue"
import Swal from "sweetalert2"
import { usePatchStorage } from "../composables/usePatchStorage"
import {
  collectSuperModules,
  installSuperModulesFromFile,
} from "../composables/superModuleTransfer.js"

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
const exportFile = () => {
  const patch = props.paperRef.exportPatch()
  patch.name = patchName.value || "patch"

  // Emporter les super-modules utilisés par le patch pour permettre
  // l'importation sur un poste qui ne les connaît pas encore.
  const defs = collectSuperModules(patch)
  if (defs.length) patch.superModule = defs

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
    // de collision de nom), puis seulement le patch qui les référence.
    const proceed = await installSuperModulesFromFile(patch.superModule)
    if (!proceed) return

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
  <div class="patch-manager">
    <h3>Patch Manager</h3>

    <!-- Name -->
    <input
      v-model="patchName"
      placeholder="Patch name"
      class="patch-name"
    />

    <!-- Actions -->
    <div class="actions">
      <button @click="savePatch">Save</button>
      <button @click="exportFile">Export</button>

      <label class="import-btn">
        Import
        <input type="file" accept=".json" hidden @change="importFile" />
      </label>
    </div>

    <!-- Filter -->
    <input
      v-model="filter"
      placeholder="Filter patches"
      class="filter"
    />

    <!-- Patch list -->
    <ul class="patch-list">
      <li
        v-for="name in availablePatches"
        :key="name"
        :class="{ selected: selected === name }"
        @click="selected = name"
      >
        {{ name }}
      </li>
    </ul>

    <!-- Load/Delete -->
    <div class="actions">
      <button @click="loadPatchByName(selected)">Load</button>
      <button :disabled="!selected" @click="deletePatch">Delete</button>
    </div>
  </div>
</template>

<style scoped>
.patch-manager {
  border: 1px solid #ccc;
  padding: 10px;

  background: #fafafa;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.patch-name,
.filter {
  padding: 4px;
}

.actions {
  display: flex;
  gap: 6px;
}

.import-btn {
  background: #eee;
  padding: 4px 8px;
  cursor: pointer;
  border-radius: 4px;
}

.patch-list {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 140px;
  overflow-y: auto;
  border: 1px solid #ddd;
}

.patch-list li {
  padding: 4px 6px;
  cursor: pointer;
}

.patch-list li.selected {
  background: #4da3ff;
  color: white;
}
</style>
