<script setup>
import { reactive, ref, watch } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'
import GraphEnvelopeEditor from './GraphEnvelopeEditor.vue'
import AudioFilePicker from './AudioFilePicker.vue'

const props = defineProps({
  module: { type: Object, default: null }
})

const emit = defineEmits(['param-changed', 'label-changed'])

// Réactif pour l'affichage
const params = reactive({})
const paramDefs = reactive({})
const label = ref("")

const { getModuleByType } = useModuleCatalog()

// Quand module sélectionné change
watch(
  () => props.module,
  (mod) => {
    // reset complet
    Object.keys(params).forEach(k => delete params[k])
    Object.keys(paramDefs).forEach(k => delete paramDefs[k])

    if (!mod) return

    label.value = mod.label || ""

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

const emitLabel = () => {
  emit('label-changed', label.value)
}

const updateEnveloppe= (key, value) => {
  params.stages = value
  emit('param-changed', { key, value })
}
</script>

<template>
  <div v-if="module" class="property-panel">
    <h3>{{ module.type }} Parameters</h3>
    <div class="module-label">
      <input
        v-model="label"
        type="text"
        placeholder="Label du module (ex: lead)"
        @input="emitLabel"
      />
      <span v-if="label" class="hint">utilisé comme préfixe des paramètres exposés</span>
    </div>
    <div v-for="(def, key) in paramDefs" :key="key" class="param-row" :class="{ 'param-envelope': def.type === 'envelope' }">
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

      <!-- String text input -->
      <input v-else-if="def.type === 'string'"
             type="text"
             v-model="params[key]"
             @change="emitChange(key, params[key])" />

      <!-- Boolean checkbox -->
      <input v-else-if="def.type === 'boolean'"
             type="checkbox"
             v-model="params[key]"
             @change="emitChange(key, params[key])" />
      <!-- Enveloppe : éditeur graphique -->
      <GraphEnvelopeEditor
        v-else-if="def.type === 'envelope'"
        :stages="params.stages"
        :min="def.min != null ? def.min : 0"
        :max="def.max != null ? def.max : 1"
        :step="def.step != null ? def.step : 0.0001"
        :unit="def.unit || ''"
        :presets-key="'env:' + module.type"
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
  height: 100%;
  padding: 12px;
  background-color: #f9f9f9;
  overflow-y: auto;
  box-sizing: border-box;
}

.property-panel h3 {
  margin-top: 0;
  font-size: 14px;
  text-transform: capitalize;
  border-bottom: 1px solid #ddd;
  padding-bottom: 8px;
}

.module-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 12px;
}

.module-label input {
  padding: 5px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 13px;
}

.module-label .hint {
  font-size: 11px;
  color: #888;
}

.param-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.param-envelope {
  flex-direction: column;
  align-items: stretch;
  width: 100%;
}
.param-envelope > label {
  align-self: flex-start;
}


</style>
