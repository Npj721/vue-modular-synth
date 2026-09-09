<script setup>
import { ref, onMounted, onUnmounted } from "vue"
import { getSharedAnalyser, initSharedVoice } from "../composables/useSharedVoice"

/* =========================================================
 * Visualisation audio (oscilloscope, spectre, spectrogramme)
 *
 * S'appuie sur l'AnalyserNode branché juste avant la sortie
 * (voir usePatchVoice.ensureMasterAnalyser). Il n'est pas une
 * partie du patch : il observe le mix final réellement entendu.
 * ========================================================= */

const oscCanvas = ref(null)
const spectrumCanvas = ref(null)
const specCanvas = ref(null)

const debug = false

const OSC_HEIGHT = 80
const SPECTRUM_HEIGHT = 80
const SPEC_HEIGHT = 80

let analyser = null
let rafId = 0
let timeData = null
let freqData = null
let specImage = null
let running = false

// HUD de diagnostic : état live de l'analyzer et niveaux de signal
const debugState = ref("initialisation…")

/* ------------------------------------------------------------------
 * Détection de la note jouée (pitch tracking par autocorrélation
 * sur le signal temporel de l'analyser, en sortie réelle du mix).
 * Fonctionne bien en monophonie ; en polyphonie le fondamental
 * dominant est affiché.
 * ------------------------------------------------------------------ */

const noteLabel = ref("—")
const noteCents = ref(null)

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
const MIN_FREQ = 40 // plage utile du tracking (40 Hz → 4 kHz)
const MAX_FREQ = 4000
const SILENCE_MS = 250 // efface la note après ce délai de silence
const CORRELATION_MIN = 0.8 // confiance minimale de l'autocorrélation
const VOICED_MIN = 0.004 // énergie RMS minimale (signal quasi nul = silence)
const SMOOTH_FRAMES = 8 // médiane glissante pour stabiliser l'affichage

let pitchBuffer = []
let pitchLastVoicedAt = 0
let pitchSamples = null
let pitchCorr = null

/* fréquence → note la plus proche + cents d'écart */
function freqToNote(freq) {
  const midi = 69 + 12 * Math.log2(freq / 440)
  const rounded = Math.round(midi)
  const cents = Math.round((midi - rounded) * 100)
  const idx = ((rounded % 12) + 12) % 12
  return {
    label: `${NOTE_NAMES[idx]}${Math.floor(rounded / 12) - 1}`,
    cents,
  }
}

/* autocorrélation → fréquence fondamentale, ou null si silence/infiable */
function detectPitch() {
  const n = timeData ? timeData.length : 0
  if (!n || !analyser) return null

  if (!pitchSamples || pitchSamples.length < n) pitchSamples = new Float32Array(n)
  if (!pitchCorr || pitchCorr.length < n) pitchCorr = new Float32Array(n)

  // signal centré (128 = zéro dans un Uint8Array) + énergie
  const sr = analyser.context.sampleRate
  let energy = 0
  analyser.getByteTimeDomainData(timeData)
  for (let i = 0; i < n; i++) {
    const s = (timeData[i] - 128) / 128
    pitchSamples[i] = s
    energy += s * s
  }
  const rms = Math.sqrt(energy / n)
  if (rms < VOICED_MIN) return null // silence

  const minLag = Math.max(2, Math.round(sr / MAX_FREQ))
  const maxLag = Math.min(n - 2, Math.round(sr / MIN_FREQ))

  let bestLag = -1
  let bestCorr = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    const lim = n - lag
    for (let i = 0; i < lim; i++) sum += pitchSamples[i] * pitchSamples[i + lag]
    pitchCorr[lag] = sum
    if (sum > bestCorr) {
      bestCorr = sum
      bestLag = lag
    }
  }

  if (bestLag < 0 || bestCorr / energy < CORRELATION_MIN) return null

  // interpolation parabolique autour du pic pour une précision sub-échantillon
  let lag = bestLag
  if (bestLag > minLag && bestLag < maxLag) {
    const r1 = pitchCorr[bestLag - 1]
    const r2 = pitchCorr[bestLag + 1]
    const denom = r1 - 2 * bestCorr + r2
    if (Math.abs(denom) > 1e-9) {
      const delta = 0.5 * (r1 - r2) / denom
      if (delta > -1 && delta < 1) lag = bestLag + delta
    }
  }

  const freq = sr / lag
  if (!isFinite(freq) || freq <= 0) return null
  return freq
}

/* ------------------------------------------------------------------
 * Palette du spectrogramme (noir → bleu → vert → jaune → rouge)
 * ------------------------------------------------------------------ */
function specColor(v) {
  // v dans [0,1]. Gradient inspiré de l'arc-en-ciel condensé.
  const i = Math.min(1, Math.max(0, v)) * 255
  if (i < 64) {
    return [0, Math.round(i * 2), 128 + Math.round(i * 2)]
  } else if (i < 128) {
    const t = (i - 64) / 64
    return [0, 128 + Math.round(t * 127), 255 - Math.round(t * 128)]
  } else if (i < 192) {
    const t = (i - 128) / 64
    return [Math.round(t * 255), 255, Math.round((1 - t) * 255)]
  } else {
    const t = (i - 192) / 63
    return [255, Math.round((1 - t) * 255), 64 + Math.round(t * 191)]
  }
}

/* ------------------------------------------------------------------
 * Setup des canvases (taille × devicePixelRatio)
 * ------------------------------------------------------------------ */
function setupCanvas(canvas, heightCss) {
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  canvas.width = Math.max(1, Math.round(w * dpr))
  canvas.height = Math.max(1, Math.round(heightCss * dpr))
  const ctx = canvas.getContext("2d")
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h: heightCss }
}

function setupSpectrogram() {
  const canvas = specCanvas.value
  const w = Math.max(1, canvas.clientWidth)
  const h = SPEC_HEIGHT
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(w * dpr)
  canvas.height = Math.round(h * dpr)
  const ctx = canvas.getContext("2d")
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // tampon plein résolution (device pixels) : une ligne "pixel" par colonne
  specImage = ctx.createImageData(canvas.width, canvas.height)
  specImage.data.fill(0)
}

/* ------------------------------------------------------------------
 * Rendu (une passe = une frame)
 * ------------------------------------------------------------------ */
function canvasCssWidth(canvas) {
  return canvas.clientWidth || Math.round(canvas.width / (window.devicePixelRatio || 1))
}

function drawOscilloscope(canvas, heightCss) {
  const ctx = canvas.getContext("2d")
  const w = canvasCssWidth(canvas)
  ctx.clearRect(0, 0, w, heightCss)

  // ligne médiane
  ctx.strokeStyle = "rgba(0,201,167,0.25)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(0, heightCss / 2)
  ctx.lineTo(w, heightCss / 2)
  ctx.stroke()

  analyser.getByteTimeDomainData(timeData)
  ctx.strokeStyle = "#00ffd0"
  ctx.lineWidth = 1.5
  ctx.beginPath()
  const n = timeData.length
  for (let i = 0; i < n; i++) {
    const x = (i / n) * w
    const y = (timeData[i] / 255) * heightCss
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

function drawSpectrum(canvas, heightCss) {
  const ctx = canvas.getContext("2d")
  const w = canvasCssWidth(canvas)
  ctx.clearRect(0, 0, w, heightCss)

  analyser.getByteFrequencyData(freqData)
  const n = freqData.length
  const barWidth = Math.max(1, w / n)
  for (let i = 0; i < n; i++) {
    const v = freqData[i] / 255
    const h = Math.max(0, v * heightCss)
    const green = 150 + Math.round(v * 105)
    ctx.fillStyle = `rgb(${Math.round(v * 255)},${green},${200 + Math.round((1 - v) * 55)})`
    ctx.fillRect(i * barWidth, heightCss - h, barWidth + 0.5, h)
  }
}

function drawSpectrogram() {
  const canvas = specCanvas.value
  const devW = canvas.width
  const devH = canvas.height
  if (!devW || !devH || !specImage) return
  const ctx = canvas.getContext("2d")

  const bytesPerRow = devW * 4
  const scroll = Math.max(1, Math.round((window.devicePixelRatio || 1)))

  // fait défiler vers le haut : recopie les lignes du tampon
  specImage.data.copyWithin(0, scroll * bytesPerRow)
  specImage.data.fill(0, (devH - scroll) * bytesPerRow)

  analyser.getByteFrequencyData(freqData)
  const n = freqData.length
  for (let dx = 0; dx < devW; dx++) {
    const bin = Math.min(n - 1, Math.floor((dx / devW) * (n - 1)))
    const v = freqData[bin] / 255
    const [r, g, b] = specColor(v)
    for (let rStep = 0; rStep < scroll; rStep++) {
      const row = devH - scroll + rStep
      const off = (row * devW + dx) * 4
      specImage.data[off] = r
      specImage.data[off + 1] = g
      specImage.data[off + 2] = b
      specImage.data[off + 3] = 255
    }
  }

  ctx.putImageData(specImage, 0, 0)
}

function frame() {
  if (!running) return
  try {
    if (!analyser) {
      analyser = getSharedAnalyser()
      if (!analyser) {
        debugState.value = "analyzer absent (contexte audio non créé)"
        rafId = requestAnimationFrame(frame)
        return
      }
      const bins = analyser.frequencyBinCount
      const fft = analyser.fftSize
      timeData = new Uint8Array(fft)
      freqData = new Uint8Array(bins)
      debugState.value = `analyzer OK fft=${fft} bins=${bins}`
    }

    if (oscCanvas.value) drawOscilloscope(oscCanvas.value, OSC_HEIGHT)
    if (spectrumCanvas.value) drawSpectrum(spectrumCanvas.value, SPECTRUM_HEIGHT)
    if (specCanvas.value) drawSpectrogram()

    // --- détection de la note courante ---
    let freq = null
    try {
      freq = detectPitch()
    } catch {
      /* analyseur trop récent : on attend la frame suivante */
    }
    if (freq !== null) {
      pitchBuffer.push(freq)
      if (pitchBuffer.length > SMOOTH_FRAMES) pitchBuffer.shift()
      pitchLastVoicedAt = performance.now()
    } else if (performance.now() - pitchLastVoicedAt > SILENCE_MS) {
      pitchBuffer.length = 0
    }

    if (pitchBuffer.length) {
      const sorted = pitchBuffer.slice().sort((a, b) => a - b)
      const { label, cents } = freqToNote(sorted[Math.floor(sorted.length / 2)])
      noteLabel.value = label
      noteCents.value = cents
    } else {
      noteLabel.value = "—"
      noteCents.value = null
    }

    // mesure des niveaux pour le HUD (temps + spectre)
    let tmin = 255
    let tmax = 0
    let fsum = 0
    for (let i = 0; i < timeData.length; i++) {
      const v = timeData[i]
      if (v < tmin) tmin = v
      if (v > tmax) tmax = v
    }
    for (let i = 0; i < freqData.length; i++) fsum += freqData[i]
    debugState.value =
      `analyzer OK fft=${analyser.fftSize} | temps[${tmin}..${tmax}] | spectre=${fsum}`
  } catch (e) {
    /* on ne plante pas le rendu si l'analyser n'est pas prêt */
  }

  rafId = requestAnimationFrame(frame)
}

function handleResize() {
  if (oscCanvas.value) setupCanvas(oscCanvas.value, OSC_HEIGHT)
  if (spectrumCanvas.value) setupCanvas(spectrumCanvas.value, SPECTRUM_HEIGHT)
  if (specCanvas.value) setupSpectrogram()
}

onMounted(() => {
  handleResize()
  window.addEventListener("resize", handleResize)

  // Démarre la boucle de rendu AVANT toute opération audio : elle récupérera
  // l'analyser dès qu'il existera. On NE DOIT PAS attendre l'audio ici :
  // resume() de l'AudioContext peut rester bloqué par la politique d'autoplay
  // jusqu'au premier geste utilisateur, ce qui figeait l'initialisation.
  running = true
  rafId = requestAnimationFrame(frame)

  // Crée le contexte audio + l'analyser de façon synchrone (fire-and-forget :
  // l'ensureMasterAnalyser est exécuté avant tout await de resume()).
  initSharedVoice().catch(() => {
    /* le contexte sera créé/relancé à la première note */
  })
})

onUnmounted(() => {
  running = false
  cancelAnimationFrame(rafId)
  window.removeEventListener("resize", handleResize)
})
</script>

<template>
  <div class="audio-visualizer">
    <div v-if="debug" class="viz-title">Visualisation de la sortie</div>
    <div v-if="debug" class="viz-debug">{{ debugState }}</div>
    <div class="viz-note-panel">
      <span class="viz-label">Note jouée</span>
      <span class="viz-note-name">{{ noteLabel }}</span>
      <span v-if="noteCents != null" class="viz-note-cents">
        {{ noteCents > 0 ? "+" : "" }}{{ noteCents }}¢
      </span>
    </div>
    <div class="viz-grid">
      <div class="viz-panel">
        <div class="viz-label">Oscilloscope</div>
        <canvas ref="oscCanvas" class="viz-canvas" :style="{ height: OSC_HEIGHT + 'px' }"></canvas>
      </div>
      <div class="viz-panel">
        <div class="viz-label">Spectre</div>
        <canvas ref="spectrumCanvas" class="viz-canvas" :style="{ height: SPECTRUM_HEIGHT + 'px' }"></canvas>
      </div>
      <div class="viz-panel">
        <div class="viz-label">Spectrogramme</div>
        <canvas ref="specCanvas" class="viz-canvas" :style="{ height: SPEC_HEIGHT + 'px' }"></canvas>
      </div>
    </div>
  </div>
</template>

<style scoped>
.audio-visualizer {
  background: #0c1410;
  color: #cfd8d4;
}
.viz-title {
  font-weight: bold;
  margin-bottom: 8px;
  color: #00ffd0;
}
.viz-debug {
  font-family: monospace;
  font-size: 11px;
  color: #ffb000;
  margin-bottom: 6px;
  white-space: pre-wrap;
}
.viz-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.viz-panel {
  flex: 1 1 280px;
  min-width: 260px;
}
.viz-note-panel {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
  background: #04120e;
  border: 1px solid #1e3a30;
  border-radius: 4px;
  padding: 6px 10px;
}
.viz-note-name {
  font-size: 22px;
  font-weight: bold;
  font-family: monospace;
  color: #00ffd0;
  min-width: 64px;
}
.viz-note-cents {
  font-family: monospace;
  font-size: 12px;
  color: #7ad4c0;
}
.viz-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
  color: #7ad4c0;
}
.viz-canvas {
  display: block;
  width: 100%;
  background: #04120e;
  border: 1px solid #1e3a30;
  border-radius: 4px;
}
</style>