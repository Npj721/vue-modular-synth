<script setup>
import { computed } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'

// Props ou emits
const emit = defineEmits(['add-module'])

// Récupération du catalogue
const { getCatalog, getModuleTypes } = useModuleCatalog()
const catalog = getCatalog()

// Liste des modules à afficher
const modulesList = computed(() =>
  getModuleTypes().map(type => ({
    type,
    label: catalog[type].label,
    color: catalog[type].color
  }))
)

// Handler clic sur un module
const handleAddModule = (type) => {
  emit('add-module', type)
}
</script>

<template>
  <div class="toolbar">
    <button
      v-for="mod in modulesList"
      :key="mod.type"
      :style="{ backgroundColor: mod.color }"
      class="toolbar-button"
      @click="handleAddModule(mod.type)"
    >
      {{ mod.label }}
    </button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.toolbar-button {
  padding: 6px 12px;
  border: none;
  color: white;
  font-weight: bold;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.1s;
}

.toolbar-button:hover {
  transform: scale(1.05);
}
</style>
