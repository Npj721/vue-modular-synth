<script setup>
const props = defineProps({
  stages: {
    type: Object,
    required: true,
    default: () => ({
      press: [],
      release: [],
    }),
  },
})

const emit = defineEmits(["update"])

/* =========================
 * Helpers
 * ========================= */
const emptyStage = () => ({
  from: "current",
  to: 0,
  duration: 0.1,
  curve: "linear",
})

const updatePhase = (phase, nextStages) => {
  emit("update", {
    press: phase === "press" ? nextStages : props.stages.press,
    release: phase === "release" ? nextStages : props.stages.release,
  })
}

const updateStage = (phase, index, patch) => {
  const next = props.stages[phase].map((s, i) =>
    i === index ? { ...s, ...patch } : s
  )
  updatePhase(phase, next)
}

const addStage = (phase) => {
  updatePhase(phase, [...props.stages[phase], emptyStage()])
}

const removeStage = (phase, index) => {
  updatePhase(
    phase,
    props.stages[phase].filter((_, i) => i !== index)
  )
}
</script>

<template>
  <div class="envelope-editor-root">

    <!-- =========================
     PRESS
    ========================== -->
    <section>
      <h3>Press (Note On)</h3>

      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Duration</th>
            <th>Curve</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(stage, i) in stages.press" :key="i">
            <td>
              <select
                :value="stage.from === 'current' ? 'current' : 'value'"
                @change="e =>
                  updateStage('press', i, {
                    from: e.target.value === 'current' ? 'current' : 0
                  })"
              >
                <option value="current">current</option>
                <option value="value">value</option>
              </select>

              <input
                v-if="stage.from !== 'current'"
                type="number"
                :value="stage.from"
                @input="e =>
                  updateStage('press', i, { from: Number(e.target.value) })"
              />
            </td>

            <td>
              <select
                :value="stage.to === 'current' ? 'current' : 'value'"
                @change="e =>
                  updateStage('press', i, {
                    to: e.target.value === 'current' ? 'current' : 0
                  })"
              >
                <option value="current">current</option>
                <option value="value">value</option>
              </select>

              <input
                v-if="stage.to !== 'current'"
                type="number"
                :value="stage.to"
                @input="e =>
                  updateStage('press', i, { to: Number(e.target.value) })"
              />
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                :value="stage.duration"
                @input="e =>
                  updateStage('press', i, { duration: Number(e.target.value) })"
              />
            </td>

            <td>
              <select
                :value="stage.curve"
                @change="e =>
                  updateStage('press', i, { curve: e.target.value })"
              >
                <option value="linear">linear</option>
                <option value="exponential">exponential</option>
              </select>
            </td>

            <td>
              <button @click="removeStage('press', i)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>

      <button @click="addStage('press')">+ Add press stage</button>
    </section>

    <!-- =========================
     RELEASE
    ========================== -->
    <section>
      <h3>Release (Note Off)</h3>

      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th>Duration</th>
            <th>Curve</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          <tr v-for="(stage, i) in stages.release" :key="i">
            <td>
              <select
                :value="stage.from === 'current' ? 'current' : 'value'"
                @change="e =>
                  updateStage('release', i, {
                    from: e.target.value === 'current' ? 'current' : 0
                  })"
              >
                <option value="current">current</option>
                <option value="value">value</option>
              </select>

              <input
                v-if="stage.from !== 'current'"
                type="number"
                :value="stage.from"
                @input="e =>
                  updateStage('release', i, { from: Number(e.target.value) })"
              />
            </td>

            <td>
              <select
                :value="stage.to === 'current' ? 'current' : 'value'"
                @change="e =>
                  updateStage('release', i, {
                    to: e.target.value === 'current' ? 'current' : 0
                  })"
              >
                <option value="current">current</option>
                <option value="value">value</option>
              </select>

              <input
                v-if="stage.to !== 'current'"
                type="number"
                :value="stage.to"
                @input="e =>
                  updateStage('release', i, { to: Number(e.target.value) })"
              />
            </td>

            <td>
              <input
                type="number"
                min="0"
                step="0.01"
                :value="stage.duration"
                @input="e =>
                  updateStage('release', i, { duration: Number(e.target.value) })"
              />
            </td>

            <td>
              <select
                :value="stage.curve"
                @change="e =>
                  updateStage('release', i, { curve: e.target.value })"
              >
                <option value="linear">linear</option>
                <option value="exponential">exponential</option>
              </select>
            </td>

            <td>
              <button @click="removeStage('release', i)">✕</button>
            </td>
          </tr>
        </tbody>
      </table>

      <button @click="addStage('release')">+ Add release stage</button>
    </section>

  </div>
</template>

<style scoped>
.envelope-editor-root {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th {
  text-align: left;
  font-size: 12px;
  opacity: 0.7;
}

td {
  padding: 4px;
}

input,
select {
  width: 100%;
}

button {
  cursor: pointer;
}
</style>
