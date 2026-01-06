<script setup>
import { ref, reactive, watch } from 'vue'
import ModuleToolbar from './ModuleToolbar.vue'
import ModulePaper from './ModulePaper.vue'
import PatchManager from './PatchManager.vue'
import ModulePropertyPanel from './ModulePropertyPanel.vue'

/* --------------------
 * Refs
 * -------------------- */
const paperRef = ref(null)

/* --------------------
 * Patch JSON (source de vérité)
 * -------------------- */
const patch = reactive({
  modules: [],
  connections: []
})

/* --------------------
 * Sélection
 * -------------------- */
const selectedModuleId = ref(null)

/* =========================================================
 * TOOLBAR
 * ========================================================= */
const handleAddModule = (type) => {
  const id = paperRef.value.addModule(type, 150, 100)

  patch.modules.push({
    id,
    type,
    params: { ...paperRef.value.modulesById.get(id).params }
  })

  selectedModuleId.value = id
}

/* =========================================================
 * MODULE SELECTION
 * ========================================================= */
const handleModuleSelected = (module) => {
  selectedModuleId.value = module.id
}

/* =========================================================
 * MODULE REMOVAL
 * ========================================================= */
const handleModuleRemoved = (module) => {
  // modules
  const mIdx = patch.modules.findIndex(m => m.id === module.id)
  if (mIdx !== -1) patch.modules.splice(mIdx, 1)

  // connections (mutation, pas réassignation)
  for (let i = patch.connections.length - 1; i >= 0; i--) {
    const c = patch.connections[i]
    if (
      c.from.moduleId === module.id ||
      c.to.moduleId === module.id
    ) {
      patch.connections.splice(i, 1)
    }
  }

  if (selectedModuleId.value === module.id) {
    selectedModuleId.value = null
  }
}

/* =========================================================
 * CONNECTIONS
 * ========================================================= */
const handleConnectionAdded = (conn) => {
  patch.connections.push(conn)
}

const handleConnectionRemoved = (conn) => {
  const idx = patch.connections.findIndex(c =>
    c.from.moduleId === conn.from.moduleId &&
    c.from.port === conn.from.port &&
    c.to.moduleId === conn.to.moduleId &&
    c.to.port === conn.to.port
  )
  if (idx !== -1) patch.connections.splice(idx, 1)
}

/* =========================================================
 * MODULE PROPERTIES
 * ========================================================= */
const handleParamChanged = ({ key, value }) => {
  if (!selectedModuleId.value) return

  const module = patch.modules.find(m => m.id === selectedModuleId.value)
  if (!module) return

  module.params[key] = value
}

/* =========================================================
 * Derived selected module (pour le panel)
 * ========================================================= */
const selectedModule = () =>
  patch.modules.find(m => m.id === selectedModuleId.value) || null

/* =========================================================
 * Debug
 * ========================================================= */
watch(patch, (newPatch) => {
  console.log('Patch JSON:', JSON.stringify(newPatch, null, 2))
}, { deep: true })
</script>

<template>
  <div>
    <!-- Toolbar -->
    <ModuleToolbar @add-module="handleAddModule" />

    <!-- Paper -->
    <ModulePaper
      ref="paperRef"
      @module-selected="handleModuleSelected"
      @module-removed="handleModuleRemoved"
      @connection-added="handleConnectionAdded"
      @connection-removed="handleConnectionRemoved"
    />

    <PatchManager :paperRef="paperRef" />

    <!-- Properties -->
    <ModulePropertyPanel
      :module="selectedModule()"
      @param-changed="handleParamChanged"
    />

    <!-- Debug sélection -->
    <div v-if="selectedModule()" style="margin-top:8px;">
      <strong>Selected:</strong>
      {{ selectedModule().type }} (ID: {{ selectedModule().id }})
    </div>
  </div>
</template>

<style scoped>
/* styling optionnel */
</style>
