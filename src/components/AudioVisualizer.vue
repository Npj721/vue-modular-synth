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
    <div class="viz-title">Visualisation de la sortie</div>
    <div class="viz-debug">{{ debugState }}</div>
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
  margin-top: 16px;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
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