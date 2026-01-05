<script setup>
import { ref, reactive, watch } from 'vue'
import ModuleToolbar from './ModuleToolbar.vue'
import ModulePaper from './ModulePaper.vue'
import ModulePropertyPanel from './ModulePropertyPanel.vue'
// Ref vers le paper
const paperRef = ref(null)

// Patch JSON global
const patch = reactive({
  modules: [],
  connections: []
})

// Module actuellement sélectionné
const selectedModule = ref(null)

// ------------------------
// ⚡ Handlers d'événements
// ------------------------

// Toolbar émet 'add-module'
const handleAddModule = (type) => {
  // Ajouter module sur le paper
  const id = paperRef.value.addModule(type, 150, 100)
  // Ajouter au patch JSON
  patch.modules.push({
    id,
    type,
    params: { ...paperRef.value.modulesById.get(id).params }
  })
}

// Paper émet 'module-selected'
const handleModuleSelected = (module) => {
  selectedModule.value = module
}

// Paper émet 'module-removed'
const handleModuleRemoved = (module) => {
  // Supprimer du patch JSON
  const idx = patch.modules.findIndex(m => m.id === module.id)
  if (idx !== -1) patch.modules.splice(idx, 1)

  // Supprimer les connexions liées
  patch.connections = patch.connections.filter(
    c => c.from !== module.id && c.to !== module.id
  )

  if (selectedModule.value?.id === module.id) selectedModule.value = null
}

// Paper émet 'connection-added'
const handleConnectionAdded = (conn) => {
  patch.connections.push(conn)
}

// Paper émet 'connection-removed'
const handleConnectionRemoved = (conn) => {
  patch.connections = patch.connections.filter(
    c => !(c.from === conn.from && c.to === conn.to)
  )
}

// Debug : observer le patch JSON
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

    <ModulePropertyPanel
    :module="selectedModule"
    @param-changed="(data) => {
        if (selectedModule.value) {
        // Mettre à jour le module sélectionné
        selectedModule.value.params[data.key] = data.value

        // Mettre à jour patch JSON
        const idx = patch.modules.findIndex(m => m.id === selectedModule.value.id)
        if(idx !== -1) patch.modules[idx].params[data.key] = data.value
        }
    }"
    />



    <!-- Infos debug sélection -->
    <div v-if="selectedModule" style="margin-top:8px;">
      <strong>Selected:</strong> {{ selectedModule.type }} (ID: {{ selectedModule.id }})
    </div>
  </div>
</template>

<style scoped>
/* Optionnel : styling simple */
</style>
