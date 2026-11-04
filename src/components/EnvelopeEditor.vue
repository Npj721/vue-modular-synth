<script setup>
import { ENVELOPE_CURVES } from "../composables/envelopeCurves"

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
  <div class="envelope-editor-root d-flex flex-column gap-4">

    <!-- =========================
     PRESS
    ========================== -->
    <section>
      <h3 class="h6">Press (Note On)</h3>

      <div class="table-responsive">
        <table class="table table-sm align-middle">
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
                  class="form-select form-select-sm mb-1"
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
                  class="form-control form-control-sm"
                  type="number"
                  :value="stage.from"
                  @input="e =>
                    updateStage('press', i, { from: Number(e.target.value) })"
                />
              </td>

              <td>
                <select
                  class="form-select form-select-sm mb-1"
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
                  class="form-control form-control-sm"
                  type="number"
                  :value="stage.to"
                  @input="e =>
                    updateStage('press', i, { to: Number(e.target.value) })"
                />
              </td>

              <td>
                <input
                  class="form-control form-control-sm"
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
                  class="form-select form-select-sm"
                  :value="stage.curve"
                  @change="e =>
                    updateStage('press', i, { curve: e.target.value })"
                >
                  <option v-for="c in ENVELOPE_CURVES" :key="c" :value="c">{{ c }}</option>
                </select>
              </td>

              <td>
                <button class="btn btn-sm btn-outline-danger" @click="removeStage('press', i)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <button class="btn btn-sm btn-outline-primary" @click="addStage('press')">+ Add press stage</button>
    </section>

    <!-- =========================
     RELEASE
    ========================== -->
    <section>
      <h3 class="h6">Release (Note Off)</h3>

      <div class="table-responsive">
        <table class="table table-sm align-middle">
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
                  class="form-select form-select-sm mb-1"
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
                  class="form-control form-control-sm"
                  type="number"
                  :value="stage.from"
                  @input="e =>
                    updateStage('release', i, { from: Number(e.target.value) })"
                />
              </td>

              <td>
                <select
                  class="form-select form-select-sm mb-1"
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
                  class="form-control form-control-sm"
                  type="number"
                  :value="stage.to"
                  @input="e =>
                    updateStage('release', i, { to: Number(e.target.value) })"
                />
              </td>

              <td>
                <input
                  class="form-control form-control-sm"
                  type="number"
                  min="0"
                  step="0.001"
                  :value="stage.duration"
                  @input="e =>
                    updateStage('release', i, { duration: Number(e.target.value) })"
                />
              </td>

              <td>
                <select
                  class="form-select form-select-sm"
                  :value="stage.curve"
                  @change="e =>
                    updateStage('release', i, { curve: e.target.value })"
                >
                  <option v-for="c in ENVELOPE_CURVES" :key="c" :value="c">{{ c }}</option>
                </select>
              </td>

              <td>
                <button class="btn btn-sm btn-outline-danger" @click="removeStage('release', i)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <button class="btn btn-sm btn-outline-primary" @click="addStage('release')">+ Add release stage</button>
    </section>

  </div>
</template>
