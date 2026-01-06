<script setup>
import { computed } from 'vue'

const props = defineProps({
  stages: {
    type: Array,
    required: true
  }
})

const emit = defineEmits(['update'])

const updateStage = (index, key, value) => {
  const next = props.stages.map((s, i) =>
    i === index ? { ...s, [key]: value } : s
  )
  emit('update', next)
}

const addStage = () => {
  const last = props.stages.at(-1) ?? { to: 0 }
  emit('update', [
    ...props.stages,
    { from: last.to, to: last.to, duration: 0.1 }
  ])
}

const removeStage = (index) => {
  const next = props.stages.filter((_, i) => i !== index)
  emit('update', next)
}
</script>

<template>
  <div class="envelope-editor">
    <div
      v-for="(stage, i) in stages"
      :key="i"
      class="stage-row"
    >
      <span class="stage-index">#{{ i + 1 }}</span>

      <input
        type="number"
        step="0.01"
        v-model.number="stage.from"
        @input="updateStage(i, 'from', stage.from)"
        title="From"
      />

      <input
        type="number"
        step="0.01"
        v-model.number="stage.to"
        @input="updateStage(i, 'to', stage.to)"
        title="To"
      />

      <input
        type="number"
        step="0.01"
        min="0"
        v-model.number="stage.duration"
        @input="updateStage(i, 'duration', stage.duration)"
        title="Duration (s)"
      />

      <button @click="removeStage(i)">✕</button>
    </div>

    <button class="add-stage" @click="addStage">
      + Add stage
    </button>
  </div>
</template>

<style scoped>
.envelope-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stage-row {
  display: grid;
  grid-template-columns: 24px 1fr 1fr 1fr auto;
  gap: 4px;
  align-items: center;
}

.stage-index {
  font-size: 11px;
  opacity: 0.6;
}

input {
  width: 100%;
}

.add-stage {
  margin-top: 6px;
}
</style>
