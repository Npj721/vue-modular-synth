<script setup>
import { computed } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'

// Props ou emits
const emit = defineEmits(['add-module'])

const props = defineProps({
  // catégories à masquer (ex: ["interface"] hors éditeur de super-module)
  excludeCategories: { type: Array, default: () => [] },
})

// Récupération du catalogue
const { getCatalog, getModuleTypes } = useModuleCatalog()
const catalog = getCatalog()

const CATEGORY_LABELS = {
  source: 'Sources',
  utility: 'Utility',
  time: 'Time',
  filter: 'Filters',
  dynamics: 'Dynamics',
  effect: 'Effects',
  control: 'Control',
  input: 'I/O',
  output: 'I/O',
  interface: 'Interface',
  super: 'Super Modules',
}

// Modules groupés par catégorie
const groups = computed(() => {
  const byCategory = new Map()

  for (const type of getModuleTypes()) {
    const def = catalog[type]
    if (!def) continue
    if (props.excludeCategories.includes(def.category)) continue

    const category = def.category ?? 'other'
    if (!byCategory.has(category)) byCategory.set(category, [])
    byCategory.get(category).push({
      type,
      label: def.label,
      color: def.color,
    })
  }

  return [...byCategory.entries()].map(([category, modules]) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    modules,
  }))
})

// Handler clic sur un module
const handleAddModule = (type) => {
  emit('add-module', type)
}
</script>

<template>
  <div class="toolbar">
    <div
      v-for="(group, gi) in groups"
      :key="group.category"
      class="toolbar-group"
    >
      <span v-if="gi > 0" class="toolbar-separator"></span>
      <span class="toolbar-category">{{ group.label }}</span>
      <button
        v-for="mod in group.modules"
        :key="mod.type"
        :style="{ backgroundColor: mod.color }"
        class="toolbar-button"
        @click="handleAddModule(mod.type)"
      >
        {{ mod.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-separator {
  width: 1px;
  height: 22px;
  background: #bbb;
  margin-right: 4px;
}

.toolbar-category {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #666;
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
