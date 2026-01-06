<script setup>
import { reactive, watch } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'

const props = defineProps({
  module: { type: Object, default: null }
})

const emit = defineEmits(['param-changed'])

// Réactif pour l'affichage
const params = reactive({})
const paramDefs = reactive({})

const { getModuleByType } = useModuleCatalog()

// Quand module sélectionné change
watch(() => props.module, (mod) => {
  if (!mod) {
    Object.keys(params).forEach(k => delete params[k])
    Object.keys(paramDefs).forEach(k => delete paramDefs[k])
    return
  }

  const def = getModuleByType(mod.type)
  if (!def) return

  // Copier les définitions
  Object.keys(paramDefs).forEach(k => delete paramDefs[k])
  Object.keys(def.params).forEach(key => {
    paramDefs[key] = def.params[key]
  })

  // Copier les valeurs existantes depuis module.params si elles existent
  Object.keys(paramDefs).forEach(key => {
    //Si la valeur existe déjà dans params, on ne l’écrase pas
    if (params[key] === undefined) {
      if (mod.params[key] === undefined) {
        // Premier affichage → prendre la valeur default
        mod.params[key] = paramDefs[key].default
      }
      params[key] = mod.params[key]
    } else {
      // params[key] contient déjà la valeur modifiée → on la laisse telle quelle
      mod.params[key] = params[key]
    }
  })
}, { immediate: true })

// Émettre les changements
const emitChange = (key, value) => {
  params[key] = value
  emit('param-changed', { key, value })
}
</script>

<template>
  <div v-if="module" class="property-panel">
    <h3>{{ module.type }} Parameters</h3>
    <div v-for="(def, key) in paramDefs" :key="key" class="param-row">
      <label>{{ key }}</label>

      <!-- Number slider -->
      <input v-if="def.type === 'number'"
             type="number"
             :min="def.min"
             :max="def.max"
             :step="def.step"
             v-model.number="params[key]"
             @input="emitChange(key, params[key])" />
      <span v-if="def.type === 'number'">{{ params[key] }}</span>

      <!-- Enum dropdown -->
      <select v-else-if="def.type === 'enum'"
              v-model="params[key]"
              @change="emitChange(key, params[key])">
        <option v-for="v in def.values" :key="v" :value="v">{{ v }}</option>
      </select>

      <!-- Boolean checkbox -->
      <input v-else-if="def.type === 'boolean'"
             type="checkbox"
             v-model="params[key]"
             @change="emitChange(key, params[key])" />
    </div>
  </div>
</template>

<style scoped>
.property-panel {
  border: 1px solid #ddd;
  padding: 8px;
  border-radius: 4px;
  margin-top: 8px;
  width: 220px;
  background-color: #f9f9f9;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

label {
  flex: 1;
  font-weight: bold;
}
</style>
