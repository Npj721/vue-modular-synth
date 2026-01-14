<script setup>
import { reactive, watch } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'
import EnvelopeEditor from './EnvelopeEditor.vue'
import AudioFilePicker from './AudioFilePicker.vue'

const props = defineProps({
  module: { type: Object, default: null }
})

const emit = defineEmits(['param-changed'])

// Réactif pour l'affichage
const params = reactive({})
const paramDefs = reactive({})

const { getModuleByType } = useModuleCatalog()

// Quand module sélectionné change
watch(
  () => props.module,
  (mod) => {
    // reset complet
    Object.keys(params).forEach(k => delete params[k])
    Object.keys(paramDefs).forEach(k => delete paramDefs[k])

    if (!mod) return

    const def = getModuleByType(mod.type)
    if (!def) return

    // copier defs
    Object.entries(def.params).forEach(([key, defParam]) => {
      paramDefs[key] = defParam

      // initialisation par INSTANCE
      if (mod.params[key] === undefined) {
        mod.params[key] = defParam.default
      }

      // copie locale pour l’UI
      params[key] = mod.params[key]
    })
  },
  { immediate: true }
)

// Émettre les changements
const emitChange = (key, value) => {
  params[key] = value
  emit('param-changed', { key, value })
}

const updateEnveloppe= (key, value) => {
  params.stages = value
  emit('param-changed', { key, value })
}
</script>

<template>
  <div v-if="module" class="property-panel">
    {{ module }}
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
      <!-- Enveloppe -->
      <EnvelopeEditor
        v-else-if="def.type === 'envelope'"
        :stages="params.stages"
        @update="val => updateEnveloppe(key, val)"
      />
      <AudioFilePicker
        v-else-if="def.type === 'audioFile'"
        :value="params[key]"
        @update="val => emitChange(key, val)"
      />

    </div>
  </div>
</template>

<style scoped>
.property-panel {
  border: 1px solid #ddd;
  padding: 8px;
  border-radius: 4px;
  margin-top: 8px;
  background-color: #f9f9f9;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}


</style>
