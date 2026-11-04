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
  routing: 'Routing',
  spatial: 'Spatial',
  input: 'I/O',
  output: 'I/O',
  interface: 'Interface',
  super: 'Super Modules',
  code: 'Code',
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
  <div class="d-flex align-items-center gap-3 flex-wrap mb-2">
    <div
      v-for="(group, gi) in groups"
      :key="group.category"
      class="d-flex align-items-center gap-2"
    >
      <span v-if="gi > 0" class="vr mx-1"></span>
      <span class="text-uppercase small text-body-secondary" style="letter-spacing: 0.5px">{{ group.label }}</span>
      <button
        v-for="mod in group.modules"
        :key="mod.type"
        :style="{ backgroundColor: mod.color, color: '#fff' }"
        class="btn btn-sm border-0 fw-bold"
        @click="handleAddModule(mod.type)"
      >
        {{ mod.label }}
      </button>
    </div>
  </div>
</template>
