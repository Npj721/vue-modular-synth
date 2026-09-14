<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue"
import { getAudioBuffer } from "../composables/useAudioBufferCache"
import { ensureSharedPatchBuffer } from "../composables/useSharedVoice"

const props = defineProps({
  bufferKey: { type: String, default: null },
  start: { type: Number, default: 0 },
  end: { type: Number, default: 0 },
})
const emit = defineEmits(["update"])

const canvasRef = ref(null)
const buffer = ref(null)
const HEIGHT = 140

const durationMs = computed(() =>
  buffer.value ? buffer.value.duration * 1000 : 0
)
const startMs = computed(() =>
  Math.min(Math.max(props.start || 0, 0), durationMs.value)
)
const endMs = computed(() =>
  props.end > 0
    ? Math.min(Math.max(props.end, startMs.value), durationMs.value)
    : durationMs.value
)
const hasBuffer = computed(() => !!buffer.value)
const selectionMs = computed(() => Math.max(0, endMs.value - startMs.value))
// une plage a été choisie dès que start ou end est explicitement renseigné
const hasRegion = computed(() => (props.start > 0) || (props.end > 0))
const playedMs = computed(() =>
  hasRegion.value ? selectionMs.value : durationMs.value
)

/* ---------------------------------------------------------
 * Pics min/max du signal (résolution fixe), mis en cache par buffer
 * --------------------------------------------------------- */
const peaksCache = new WeakMap()
function computePeaks(buf, bins = 2048) {
  if (peaksCache.has(buf)) return peaksCache.get(buf)
  const n = Math.floor(buf.duration * buf.sampleRate)
  const chans = []
  for (let c = 0; c < buf.numberOfChannels; c++) {
    chans.push(buf.getChannelData(c))
  }
  const peaks = new Array(bins)
  for (let b = 0; b < bins; b++) {
    const i0 = Math.floor((b * n) / bins)
    const i1 = Math.floor(((b + 1) * n) / bins)
    let mn = 1
    let mx = -1
    for (let c = 0; c < chans.length; c++) {
      const data = chans[c]
      for (let i = i0; i < i1; i++) {
        const v = data[i]
        if (v < mn) mn = v
        if (v > mx) mx = v
      }
    }
    peaks[b] = { min: mn, max: mx }
  }
  peaksCache.set(buf, peaks)
  return peaks
}

/* ---------------------------------------------------------
 * Hydratation : récupère le buffer du cache / depuis IndexedDB
 * --------------------------------------------------------- */
async function hydrate() {
  if (!props.bufferKey) {
    buffer.value = null
    return
  }
  buffer.value = getAudioBuffer(props.bufferKey)
  if (!buffer.value) {
    try {
      await ensureSharedPatchBuffer(props.bufferKey)
      buffer.value = getAudioBuffer(props.bufferKey)
    } catch {
      buffer.value = null
    }
  }
}
watch(() => props.bufferKey, hydrate, { immediate: true })

/* ---------------------------------------------------------
 * Dessin
 * --------------------------------------------------------- */
function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const w = Math.max(1, rect.width)
  const h = HEIGHT
  const dpr = window.devicePixelRatio || 1
  if (
    canvas.width !== Math.round(w * dpr) ||
    canvas.height !== Math.round(h * dpr)
  ) {
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
  }
  const ctx = canvas.getContext("2d")
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)

  ctx.fillStyle = "#1b1e24"
  ctx.fillRect(0, 0, w, h)

  if (!hasBuffer.value) {
    ctx.fillStyle = "#667"
    ctx.font = "12px monospace"
    ctx.textAlign = "center"
    ctx.fillText(
      "Charger un fichier audio pour afficher la forme d'onde",
      w / 2,
      h / 2
    )
    return
  }

  const peaks = computePeaks(buffer.value)
  const mid = h / 2
  const amp = (h / 2) * 0.92

  // ligne centrale
  ctx.fillStyle = "#3a4150"
  ctx.fillRect(0, mid, w, 1)

  // forme d'onde
  const n = peaks.length
  ctx.fillStyle = "#9aa7b5"
  for (let x = 0; x < w; x++) {
    const b = Math.min(Math.floor((x / w) * n), n - 1)
    const p = peaks[b]
    const y0 = mid - p.max * amp
    const y1 = mid - p.min * amp
    ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0))
  }

  // région de lecture (start -> end)
  const sx = xForMs(startMs.value)
  const ex = xForMs(endMs.value)
  if (ex > sx) {
    ctx.fillStyle = "rgba(46,139,87,0.35)"
    ctx.fillRect(sx, 0, ex - sx, h)
  }

  // marqueurs début / fin
  drawHandle(ctx, sx, "#4ade80", true)
  drawHandle(ctx, ex, "#f87171", false)
}

function drawHandle(ctx, x, color, isStart) {
  ctx.fillStyle = color
  ctx.fillRect(x - 1, 0, 3, HEIGHT)
  const cw = 9
  const ch = 7
  ctx.beginPath()
  if (isStart) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x + cw, 0)
    ctx.lineTo(x, ch)
  } else {
    ctx.moveTo(x - cw, 0)
    ctx.lineTo(x, 0)
    ctx.lineTo(x, ch)
  }
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  if (isStart) {
    ctx.moveTo(x, HEIGHT)
    ctx.lineTo(x + cw, HEIGHT)
    ctx.lineTo(x, HEIGHT - ch)
  } else {
    ctx.moveTo(x - cw, HEIGHT)
    ctx.lineTo(x, HEIGHT)
    ctx.lineTo(x, HEIGHT - ch)
  }
  ctx.closePath()
  ctx.fill()
}

function xForMs(ms) {
  if (durationMs.value <= 0) return 0
  const w = canvasRef.value.getBoundingClientRect().width
  return (ms / durationMs.value) * w
}

watch([startMs, endMs, buffer], draw)
watch(hasBuffer, () => {
  if (hasBuffer.value) draw()
})

/* ---------------------------------------------------------
 * Interaction clavier/souris : déplacer les marqueurs
 * --------------------------------------------------------- */
let drag = null // { type: 'start' | 'end' | 'region', grabOffsetX }

function onPointerDown(e) {
  if (!hasBuffer.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const x = e.clientX - rect.left
  const sx = xForMs(startMs.value)
  const ex = xForMs(endMs.value)
  const tol = 7
  if (Math.abs(x - ex) <= tol) drag = { type: "end" }
  else if (Math.abs(x - sx) <= tol) drag = { type: "start" }
  else if (x >= sx && x <= ex) {
    drag = { type: "region", grabOffsetX: x - sx }
  } else {
    drag =
      Math.abs(x - sx) <= Math.abs(x - ex)
        ? { type: "start" }
        : { type: "end" }
  }
  canvasRef.value.setPointerCapture(e.pointerId)
}

function onPointerMove(e) {
  if (!drag || !hasBuffer.value) return
  const canvas = canvasRef.value
  const rect = canvas.getBoundingClientRect()
  const x = e.clientX - rect.left
  const atMs = (x / rect.width) * durationMs.value
  let s = startMs.value
  let ed = endMs.value

  if (drag.type === "start") {
    s = Math.min(Math.max(atMs, 0), ed)
  } else if (drag.type === "end") {
    ed = Math.min(Math.max(atMs, s), durationMs.value)
  } else if (drag.type === "region") {
    const len = endMs.value - startMs.value
    const grabMs = (drag.grabOffsetX / rect.width) * durationMs.value
    s = atMs - grabMs
    s = Math.min(Math.max(s, 0), durationMs.value - len)
    ed = s + len
  }

  emit("update", { start: Math.round(s), end: Math.round(ed) })
  draw()
}

function onPointerUp(e) {
  drag = null
  try {
    if (canvasRef.value.hasPointerCapture(e.pointerId)) {
      canvasRef.value.releasePointerCapture(e.pointerId)
    }
  } catch {}
}

const setFull = () => emit("update", { start: 0, end: 0 })

/* ---------------------------------------------------------
 * Redimensionnement
 * --------------------------------------------------------- */
let ro = null
onMounted(() => {
  ro = new ResizeObserver(() => draw())
  ro.observe(canvasRef.value)
})
onBeforeUnmount(() => ro && ro.disconnect())

const fmtMs = (ms) => `${Math.round(ms)} ms`
const fmtSec = (ms) => `${(ms / 1000).toFixed(2)} s`
</script>

<template>
  <div class="waveform-editor">
    <canvas
      ref="canvasRef"
      class="waveform-canvas"
      :style="{ height: HEIGHT + 'px' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    ></canvas>

    <div class="waveform-info" v-if="hasBuffer">
      <span class="waveform-duration">
        Durée du son
        <b>{{ fmtMs(playedMs) }}</b>
        <i>({{ fmtSec(playedMs) }})</i>
        <em v-if="hasRegion">de {{ fmtMs(startMs) }} à {{ fmtMs(endMs) }}</em>
        <em v-else>fichier entier</em>
      </span>
      <span class="waveform-pos">début {{ fmtMs(startMs) }}</span>
      <span class="waveform-pos">fin {{ fmtMs(endMs) }}</span>
      <button class="waveform-reset" title="Lecture complète du fichier" @click="setFull">↺ complet</button>
    </div>
  </div>
</template>

<style scoped>
.waveform-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.waveform-canvas {
  width: 100%;
  border: 1px solid #3a4150;
  border-radius: 4px;
  cursor: ew-resize;
  display: block;
  touch-action: none;
}

.waveform-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: #888;
}

.waveform-pos {
  font-family: monospace;
}

.waveform-duration {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 8px;
  background: rgba(46, 139, 87, 0.12);
  border: 1px solid rgba(46, 139, 87, 0.4);
  border-radius: 4px;
  font-size: 12px;
  color: #cde3d8;
}

.waveform-duration b {
  font-family: monospace;
  font-size: 14px;
  color: #4ade80;
}

.waveform-duration i {
  font-style: normal;
  color: #6b9a7f;
}

.waveform-duration em {
  font-style: normal;
  color: #e2e8f0;
}

.waveform-reset {
  margin-left: auto;
  border: 1px solid #3a4150;
  background: none;
  color: #9aa7b5;
  border-radius: 4px;
  font-size: 11px;
  padding: 2px 6px;
  cursor: pointer;
}
.waveform-reset:hover {
  color: #e2e8f0;
  border-color: #64748b;
}
</style>