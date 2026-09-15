<script setup>
import { reactive, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'
import {
  getWavetableBundle,
  subscribeWavetableFrame,
  getWavetableFrameState,
} from '../composables/usePatchVoice'
import GraphEnvelopeEditor from './GraphEnvelopeEditor.vue'
import AudioFilePicker from './AudioFilePicker.vue'
import SampleWaveformEditor from './SampleWaveformEditor.vue'

const props = defineProps({
  module: { type: Object, default: null }
})

const emit = defineEmits(['param-changed', 'label-changed'])

// Réactif pour l'affichage
const params = reactive({})
const paramDefs = reactive({})
const label = ref("")

// Validation JSON différée : re-parser un gros JSON (wavetable / wavetableS)
// à chaque frappe bloquerait la saisie → résultat calculé ~350 ms après le
// dernier input, "validation…" affiché dans l'intervalle.
const jsonResults = reactive({})
const jsonValidating = reactive({})
const jsonTimers = {}
const scheduleJsonValidation = (key) => {
  clearTimeout(jsonTimers[key])
  jsonTimers[key] = undefined
  jsonValidating[key] = true
  jsonTimers[key] = setTimeout(() => {
    jsonResults[key] = jsonStatus(paramDefs[key], params[key])
    jsonValidating[key] = false
  }, 350)
}
const jsonStatusView = (key) => {
  if (jsonValidating[key]) {
    return { pending: true, ok: false, message: "validation…" }
  }
  return {
    pending: false,
    ok: !!jsonResults[key]?.ok,
    message: jsonResults[key]?.message ?? "",
  }
}

// Édition JSON en MODALE : le gros JSON (wavetableS : jusqu'à des centaines
// de milliers de lignes) ne doit jamais être rendu en dur dans le panneau —
// un textarea de ~500 000 lignes rend l'interface inutilisable même fermé.
// Le panneau n'affiche qu'un bouton + un résumé ; le textarea n'existe que
// lorsque la modale est ouverte. Tant qu'elle est fermée, le panneau reste
// fluide ; dans la modale, la validation du brouillon est débouncée.
const jsonModalKey = ref(null)
const jsonDraft = ref("")
const jsonDraftStatus = ref({ pending: false, ok: false, message: "" })
let jsonDraftTimer = 0

const openJsonModal = (key) => {
  jsonModalKey.value = key
  jsonDraft.value = params[key] ?? ""
  refreshJsonDraft()
}
const refreshJsonDraft = () => {
  clearTimeout(jsonDraftTimer)
  if (jsonModalKey.value == null) return
  jsonDraftStatus.value = { pending: true, ok: false, message: "validation…" }
  jsonDraftTimer = setTimeout(() => {
    jsonDraftStatus.value = jsonStatus(
      paramDefs[jsonModalKey.value],
      jsonDraft.value
    )
  }, 40)
}
const onJsonDraftInput = (e) => {
  jsonDraft.value = e.target.value
  refreshJsonDraft()
}
const applyJsonModal = () => {
  const key = jsonModalKey.value
  if (key == null) return
  emitChange(key, jsonDraft.value)
  closeJsonModal()
}
const closeJsonModal = () => {
  clearTimeout(jsonDraftTimer)
  jsonModalKey.value = null
  jsonDraft.value = ""
  jsonDraftStatus.value = { pending: false, ok: false, message: "" }
}

const { getModuleByType } = useModuleCatalog()

// Quand module sélectionné change
watch(
  () => props.module,
  (mod) => {
    // reset complet
    Object.keys(params).forEach(k => delete params[k])
    Object.keys(paramDefs).forEach(k => delete paramDefs[k])
    Object.keys(jsonResults).forEach(k => delete jsonResults[k])
    Object.keys(jsonValidating).forEach(k => delete jsonValidating[k])
    Object.keys(jsonTimers).forEach(k => clearTimeout(jsonTimers[k]))
    closeJsonModal()

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

      if (defParam.type === "json") {
        scheduleJsonValidation(key)
      }
    })
  },
  { immediate: true }
)

// Émettre les changements
const emitChange = (key, value) => {
  params[key] = value
  if (paramDefs[key]?.type === "json") scheduleJsonValidation(key)
  emit('param-changed', { key, value })
}

const emitLabel = () => {
  emit('label-changed', label.value)
}

const updateEnveloppe= (key, value) => {
  // le GraphEnvelopeEditor n'émet que { press, release } :
  // préserver le drapeau "loop" du modèle
  const loop = params.stages?.loop ?? false
  params.stages = { ...value, loop }
  emit('param-changed', { key, value: params.stages })
}

const toggleLoop = () => {
  const value = !(params.stages?.loop ?? false)
  params.stages = { ...(params.stages || {}), loop: value }
  emit('param-changed', { key: 'stages', value: params.stages })
}

// Plages de lecture du module FX : les positions choisies sur l'onde sont
// reportées sur les paramètres numériques "start"/"end" (ms).
const onSampleRegionUpdate = ({ start, end }) => {
  emitChange('start', start)
  emitChange('end', end)
}

// Validation d'un paramètre JSON (ex: wavetable) à l'édition :
// - le contenu doit être un JSON valide
// - les clés désignées par def.jsonKeys doivent exister et être des tableaux
// - ils doivent contenir au moins une valeur et avoir tous la même taille
const jsonStatus = (def, value) => {
  if (!def || def.type !== 'json') return null
  const raw = value == null ? '' : String(value)
  if (!raw.trim()) return { ok: false, message: 'JSON vide' }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, message: 'JSON invalide' }
  }

  // wavetableS : tableau de frames [ { real, imag }, ... ] homogènes
  if (def.jsonFrames) {
    if (!Array.isArray(parsed)) {
      return { ok: false, message: 'doit être un tableau de frames' }
    }
    if (parsed.length === 0) {
      return {
        ok: false,
        message: 'tableau vide (repli sur une onde par défaut)',
      }
    }
    let coeffs = -1
    for (let i = 0; i < parsed.length; i++) {
      const f = parsed[i]
      if (!f || typeof f !== 'object') {
        return { ok: false, message: `frame ${i} : objet attendu` }
      }
      for (const k of ['real', 'imag']) {
        if (!Array.isArray(f[k])) {
          return {
            ok: false,
            message: `frame ${i} : "${k}" doit être un tableau`,
          }
        }
        if (f[k].length === 0) {
          return { ok: false, message: `frame ${i} : "${k}" vide` }
        }
      }
      if (f.real.length !== f.imag.length) {
        return {
          ok: false,
          message: `frame ${i} : real/imag de tailles différentes`,
        }
      }
      if (coeffs === -1) coeffs = f.real.length
      else if (f.real.length !== coeffs) {
        return {
          ok: false,
          message: `frame ${i} : ${f.real.length} coeffs au lieu de ${coeffs}`,
        }
      }
    }
    return {
      ok: true,
      message: `JSON valide : ${parsed.length} frame(s) × ${coeffs} coeffs`,
    }
  }

  const keys = def.jsonKeys || []
  for (const k of keys) {
    if (!(k in parsed)) return { ok: false, message: `clé "${k}" manquante` }
    if (!Array.isArray(parsed[k])) {
      return { ok: false, message: `"${k}" doit être un tableau` }
    }
  }
  if (keys.length) {
    const lens = keys.map((k) => parsed[k].length)
    if (lens.some((l) => l === 0)) {
      return { ok: false, message: 'tableaux vides (repli sur une onde par défaut)' }
    }
    if (new Set(lens).size > 1) {
      return {
        ok: false,
        message: `${keys.join(' et ')} doivent avoir la même taille`,
      }
    }
    return {
      ok: true,
      message: `JSON valide : ${keys.join(', ')} = ${lens[0]} valeurs`,
    }
  }
  return { ok: true, message: 'JSON valide' }
}

// Un paramètre JSON "onde" expose des clés amplifiables (real + imag).
const isWaveParam = (def) =>
  Array.isArray(def?.jsonKeys) &&
  def.jsonKeys.includes('real') &&
  def.jsonKeys.includes('imag')

// Amplificateur : multiplie chaque valeur de real/imag et clampe dans [-1, 1].
// Écrit le résultat directement dans le paramètre "wave" (réécrit le JSON),
// pour que l'amplification soit "cuite" dans la wavetable (pas de recalcul
// à chaque note).
const ampFactor = ref(1)
const applyAmp = (def, key) => {
  if (!isWaveParam(def)) return
  const raw = params[key]
  if (!raw) return
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(parsed.real) || !Array.isArray(parsed.imag)) return

  const f = Number(ampFactor.value)
  if (!isFinite(f) || f <= 0) return

  const clamp01 = (v) => Math.max(-1, Math.min(1, v * f))
  const next = {
    ...parsed,
    real: parsed.real.map(clamp01),
    imag: parsed.imag.map(clamp01),
  }

  ampFactor.value = 1
  emitChange(key, JSON.stringify(next))
}

/* =========================================================
 * Visualiseur pseudo-3D de la table du module wavetableS
 * ---------------------------------------------------------
 * Reconstruit chaque frame par somme d'harmoniques (real·cos + imag·sin,
 * bornée à DRAW_HARMONICS pour éviter le repliement visuel et limiter le
 * coût), normalise au pic, puis empile les ondes en perspective vers un
 * POINT DE FUITE : frame 0 au premier plan, les suivantes qui fuient vers
 * le haut (échelle, amplitude et luminosité décroissantes). La frame EN
 * COURS DE LECTURE (notifiée par startMorphScan → subscribeWavetableFrame)
 * est tracée en clair avec sa ligne de temps. Le dessin est rAF-coalescé :
 * jamais plus d'un redraw par image, zéro travail quand rien ne bouge.
 * ========================================================= */
const MAX_VISIBLE_ROWS = 512
const DRAW_SAMPLES = 256
const DRAW_HARMONICS = 128

const viewer = ref(null)
const currentFrame = ref(0)
const scanActive = ref(false)
const rowFrameCount = ref(0)
const wavetableRows = reactive([])
let viewerUnsub = null
let viewerRaf = 0
let viewerResizeObs = null

// Reconstruit M échantillons d'une frame depuis ses coefficients.
function frameSamples(real, imag) {
  const K = Math.max(
    0,
    Math.min(Math.min(real?.length ?? 0, imag?.length ?? 0) - 1, DRAW_HARMONICS)
  )
  const out = new Float32Array(DRAW_SAMPLES)
  let peak = 0
  for (let i = 0; i < DRAW_SAMPLES; i++) {
    const phi = (2 * Math.PI * i) / DRAW_SAMPLES
    let v = 0
    for (let k = 1; k <= K; k++) {
      v += (real[k] || 0) * Math.cos(k * phi) + (imag[k] || 0) * Math.sin(k * phi)
    }
    if (Math.abs(v) > peak) peak = Math.abs(v)
    out[i] = v
  }
  if (peak > 1e-9) for (let i = 0; i < DRAW_SAMPLES; i++) out[i] /= peak
  return out
}

const scheduleViewerDraw = () => {
  if (viewerRaf || !viewer.value) return
  viewerRaf = requestAnimationFrame(() => {
    viewerRaf = 0
    drawWavetableViewer()
  })
}

// Échantillons déjà synthétisés par index de frame : le cache évite de
// re-synthétiser une frame à chaque changement. TOUTES les frames de la
// table sont dessinées (jusqu'à MAX_VISIBLE_ROWS ; au-delà, un pas de
// sous-échantillonnage conserve la silhouette globale) et la frame EN COURS
// DE LECTURE est toujours garantie présente dans la liste.
// La table de repli correspond à l'onde par défaut du moteur (dents de scie 1/n).
const FALLBACK_WAVE = (() => {
  const real = new Array(10).fill(0)
  const imag = [0, 1, 0.5, 0.333, 0.25, 0.2, 0.167, 0.143, 0.125, 0.111]
  return { index: 0, samples: frameSamples(real, imag) }
})()

let rowFramesCache = []
let rowSamplesCache = new Map()
let lastWaveSource = null

function frameSamplesAt(index) {
  const f = rowFramesCache[index]
  if (!f) return null
  let samples = rowSamplesCache.get(index)
  if (!samples) {
    samples = frameSamples(f.real, f.imag)
    rowSamplesCache.set(index, samples)
  }
  return samples
}

function rebuildWavetableRows() {
  wavetableRows.splice(0, wavetableRows.length)
  const mod = props.module
  if (!mod || mod.type !== "wavetableS") return

  const frames = getWavetableBundle(null, params.wave)?.frames ?? []
  if (params.wave !== lastWaveSource) {
    lastWaveSource = params.wave
    rowFramesCache = frames
    rowSamplesCache = new Map()
  }

  if (!frames.length) {
    rowFrameCount.value = 1
    wavetableRows.push(FALLBACK_WAVE)
    scheduleViewerDraw()
    return
  }

  const N = frames.length
  rowFrameCount.value = N
  const step = N > MAX_VISIBLE_ROWS ? Math.ceil(N / MAX_VISIBLE_ROWS) : 1
  const idxs = new Set()
  if (step > 1) {
    for (let i = 0; i < N; i += step) idxs.add(i)
    // la frame actuellement jouée est toujours dessinée
    idxs.add(Math.max(0, Math.min(N - 1, Math.round(currentFrame.value))))
  } else {
    for (let i = 0; i < N; i++) idxs.add(i)
  }

  for (const i of [...idxs].sort((a, b) => a - b)) {
    const samples = frameSamplesAt(i)
    if (samples) wavetableRows.push({ index: i, samples })
  }
  scheduleViewerDraw()
}

const onViewerFrame = ({ frame, active }) => {
  currentFrame.value = frame
  scanActive.value = active
  ensureActiveRow()
  scheduleViewerDraw()
}

// Tables très grandes (> MAX_VISIBLE_ROWS) : si la frame jouée manque dans
// l'échantillonnage, on l'ajoute à la volée (échantillons déjà en cache).
function ensureActiveRow() {
  const N = rowFramesCache.length
  const cur = Math.round(currentFrame.value)
  if (cur < 0 || cur >= N) return
  if (wavetableRows.some((r) => r.index === cur)) return
  const samples = frameSamplesAt(cur)
  if (!samples) return
  wavetableRows.push({ index: cur, samples })
  wavetableRows.sort((a, b) => a.index - b.index)
}

function bindWavetableViewer() {
  if (viewerUnsub) {
    viewerUnsub()
    viewerUnsub = null
  }
  const mod = props.module
  if (!mod || mod.type !== "wavetableS" || mod.id == null) {
    currentFrame.value = 0
    scanActive.value = false
    return
  }
  const st = getWavetableFrameState(mod.id)
  currentFrame.value = st ? st.frame : 0
  scanActive.value = st ? st.active : false
  viewerUnsub = subscribeWavetableFrame(mod.id, onViewerFrame)
  scheduleViewerDraw()
}

function drawWavetableViewer() {
  const canvas = viewer.value
  if (!canvas) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth || 0
  const h = canvas.clientHeight || 0
  if (!w || !h) return
  const bw = Math.round(w * dpr)
  const bh = Math.round(h * dpr)
  if (canvas.width !== bw) canvas.width = bw
  if (canvas.height !== bh) canvas.height = bh
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.fillStyle = "#0a1016"
  ctx.fillRect(0, 0, w, h)

  const rows = wavetableRows
  if (rows.length) {
    // point de fuite en haut-centre ; frame 0 au premier plan (bas, pleine
    // échelle), les suivantes fuient vers le lointain (échelle × amplitude ×
    // luminosité décroissants en 1/(1+k·z), z = profondeur = index/(N-1)).
    const VPX = w / 2
    const VPY = Math.max(20, h * 0.12)
    const yFront = h * 0.86
    const halfWFront = w * 0.46
    const AMP = 0.3
    const PERSP = 2.6

    const N = Math.max(1, rowFramesCache.length || rows.length)
    const cur = scanActive.value ? Math.round(currentFrame.value) : -1
    const activeRow = cur >= 0 ? rows.find((r) => r.index === cur) : null

    // géométrie d'une frame depuis son INDEX dans la table (le point de fuite
    // est au-dessus : y · s avec s = 1/(1+PERSP·depth))
    const scaled = (rowIndex) => {
      const depth = N > 1 ? rowIndex / (N - 1) : 0
      const s = 1 / (1 + PERSP * depth)
      return {
        depth,
        s,
        y: VPY + (yFront - VPY) * s,
        x0: VPX - halfWFront * s,
        x1: VPX + halfWFront * s,
      }
    }

    const drawRow = (row, isActive, geo) => {
      // les frames lointaines sont dessinées avec moins de points (détail
      // invisible) : on garde un temps de dessin raisonnable à haute vitesse
      const src = row.samples
      const n = Math.max(24, Math.round(src.length * (0.3 + 0.7 * geo.s)))
      const amp = (yFront - VPY) * AMP * geo.s
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const k = Math.floor((i / (n - 1)) * (src.length - 1))
        const x = geo.x0 + (i / (n - 1)) * (geo.x1 - geo.x0)
        const yv = geo.y - src[k] * amp
        if (i === 0) ctx.moveTo(x, yv)
        else ctx.lineTo(x, yv)
      }
      ctx.strokeStyle = isActive
        ? "rgb(255, 199, 88)"
        : `rgba(96, 184, 162, ${0.16 + 0.34 * (1 - geo.depth)})`
      ctx.lineWidth = isActive ? 2 : 1
      if (isActive) {
        ctx.shadowColor = "rgba(255, 199, 88, 0.85)"
        ctx.shadowBlur = 8
      }
      ctx.stroke()
      if (isActive) {
        ctx.shadowBlur = 0
        // ligne de temps (playhead) sous la frame en cours
        ctx.beginPath()
        ctx.moveTo(geo.x0, geo.y)
        ctx.lineTo(geo.x1, geo.y)
        ctx.strokeStyle = "rgba(255, 199, 88, 0.4)"
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    // 1) toutes les frames, dans l'ordre avant → arrière (front → lointain)
    for (const row of rows) {
      if (row === activeRow) continue
      drawRow(row, false, scaled(row.index))
    }

    // 2) la frame EN COURS DE LECTURE revient PAR-DESSUS, à sa propre
    //    profondeur (donc devant ou derrière selon son index) : elle reste
    //    bien visible même proche du point de fuite
    if (activeRow) drawRow(activeRow, true, scaled(activeRow.index))
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.75)"
  ctx.font = "11px system-ui, sans-serif"
  ctx.textAlign = "left"
  ctx.fillText(
    `frame ${currentFrame.value}${scanActive.value ? " — lecture" : " — arrêt"}`,
    8,
    16
  )
}

const startViewer = () => {
  stopViewer()
  const canvas = viewer.value
  if (!canvas) return
  viewerResizeObs = new ResizeObserver(() => scheduleViewerDraw())
  viewerResizeObs.observe(canvas)
  scheduleViewerDraw()
}

const stopViewer = () => {
  if (viewerUnsub) {
    viewerUnsub()
    viewerUnsub = null
  }
  if (viewerResizeObs) {
    viewerResizeObs.disconnect()
    viewerResizeObs = null
  }
  if (viewerRaf) {
    cancelAnimationFrame(viewerRaf)
    viewerRaf = 0
  }
}

// (Ré)initialisation du visualiseur quand le module sélectionné change
// (le nextTick attend que son <canvas> soit monté).
watch(
  () => props.module,
  () => {
    nextTick(() => {
      bindWavetableViewer()
      rebuildWavetableRows()
      startViewer()
    })
  },
  { immediate: true }
)

// Redessin quand la table elle-même change (édition JSON du module).
watch(
  () => (props.module?.type === "wavetableS" ? params.wave : null),
  () => {
    if (props.module?.type === "wavetableS") rebuildWavetableRows()
  }
)

onBeforeUnmount(stopViewer)
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

    <!-- Visualiseur pseudo-3D de la table (module wavetableS uniquement) :
         les frames fuient vers un point de fuite, la frame en cours de
         lecture est surlignée en clair avec sa ligne de temps. -->
    <div v-if="module.type === 'wavetableS'" class="wavetable-3d-viewer">
      <h4>Table d'ondes</h4>
      <canvas ref="viewer" class="wavetable-3d-canvas"></canvas>
      <div class="wavetable-3d-meta">
        <span class="wavetable-3d-frame" :class="{ off: !scanActive }">
          frame <strong>{{ currentFrame }}</strong>
          <template v-if="rowFrameCount > 1"> / {{ rowFrameCount - 1 }}</template>
          <em>{{ scanActive ? "lecture" : "arrêt" }}</em>
        </span>
        <span class="wavetable-3d-count">
          {{ wavetableRows.length }} ligne(s)
        </span>
      </div>
    </div>

    <div v-for="(def, key) in paramDefs" :key="key" class="param-row" :class="{ 'param-envelope': def.type === 'envelope' || def.type === 'json' }">
      <label>{{ key }}</label>  
      <!-- Number slider -->
      <input v-if="def.type === 'number'"
             type="number"
             :min="def.min"
             :max="def.max"
             :step="def.step"
             v-model.number="params[key]"
             @input="emitChange(key, params[key])" />
      <span v-if="def.type === 'number'">{{ params[key] }}<template v-if="def.unit"> {{ def.unit }}</template></span>

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

      <!-- JSON (ex: wavetable) : bouton + résumé ici, le textarea géant n'est
           rendu QUE dans la modale (jamais en dur dans le panneau) -->
      <template v-else-if="def.type === 'json'">
        <div class="json-field">
          <button class="json-button" @click="openJsonModal(key)">
            Charger / éditer le JSON…
          </button>
          <span
            v-if="jsonStatusView(key).pending || jsonStatusView(key).message"
            class="json-status"
            :class="jsonStatusView(key).pending ? 'pending' : jsonStatusView(key).ok ? 'ok' : 'err'">
            {{ jsonStatusView(key).message }}
          </span>
          <!-- Amplificateur : multiplie def.jsonKeys et réécrit le JSON -->
          <div
            v-if="isWaveParam(def)"
            class="amp-row">
            <label>Amplifier ×</label>
            <input
              type="number"
              v-model.number="ampFactor"
              min="0.01"
              step="0.1"
              placeholder="1"
            />
            <button
              class="amp-apply"
              :disabled="!(ampFactor > 0)"
              @click="applyAmp(def, key)">
              appliquer
            </button>
          </div>
        </div>
      </template>

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
      <label v-if="def.type === 'envelope'" class="param-loop">
        <input
          type="checkbox"
          :checked="!!(params.stages && params.stages.loop)"
          @change="toggleLoop"
        />
        <span>Loop continue (sustain très long)</span>
      </label>
      <AudioFilePicker
        v-else-if="def.type === 'audioFile'"
        :value="params[key]"
        @update="val => emitChange(key, val)"
      />

    </div>

    <!-- Éditeur de plage de lecture pour les samples (module FX) -->
    <div v-if="module.type === 'fx'" class="sample-region-editor">
      <h4>Plage de lecture</h4>
      <SampleWaveformEditor
        :buffer-key="params.buffer || null"
        :start="Number(params.start) || 0"
        :end="Number(params.end) || 0"
        @update="onSampleRegionUpdate"
      />
    </div>

    <!-- Modale d'édition du JSON des wavetables : seul endroit où le gros
         textarea est rendu (donc uniquement quand on en a besoin). Le
         Teleport envoie le contenu sur <body>, la position DOM n'a aucune
         incidence. ⚠️ rester à l'INTÉRIEUR de la div racine : un second root
         casserait l'héritage des attrs (class="editor-properties"). -->
    <Teleport to="body">
      <div
        v-if="jsonModalKey != null"
        class="json-modal-backdrop"
        @click.self="closeJsonModal">
        <div class="json-modal">
          <div class="json-modal-head">
            <strong>{{ jsonModalKey }}</strong>
            <button
              class="json-modal-close"
              title="Fermer (Esc)"
              @click="closeJsonModal">✕</button>
          </div>
          <div
            class="json-modal-status"
            :class="jsonDraftStatus.pending ? 'pending' : jsonDraftStatus.ok ? 'ok' : 'err'">
            {{ jsonDraftStatus.message }}
          </div>
          <textarea
            class="json-modal-textarea"
            spellcheck="false"
            :value="jsonDraft"
            @input="onJsonDraftInput"
            @keydown.esc="closeJsonModal"></textarea>
          <div class="json-modal-actions">
            <span class="json-modal-count">
              {{ jsonDraft.length.toLocaleString('fr-FR') }} caractères
            </span>
            <button @click="closeJsonModal">Annuler</button>
            <button
              class="json-modal-apply"
              :disabled="jsonDraftStatus.pending || !jsonDraftStatus.ok"
              @click="applyJsonModal">
              Charger
            </button>
          </div>
        </div>
      </div>
    </Teleport>
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

.json-button {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}

.json-button:hover {
  background: #f0f0f0;
}

.json-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.json-modal {
  width: min(92vw, 900px);
  height: min(88vh, 720px);
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  box-sizing: border-box;
  overflow: hidden;
}

.json-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.json-modal-close {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
  color: #666;
}

.json-modal-status {
  font-size: 11px;
  font-family: monospace;
  min-height: 15px;
}

.json-modal-status.pending {
  color: #7f8c8d;
  font-style: italic;
}

.json-modal-status.ok {
  color: #27ae60;
}

.json-modal-status.err {
  color: #c0392b;
}

.json-modal-textarea {
  flex: 1;
  width: 100%;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.4;
  border: 1px solid #ccc;
  border-radius: 4px;
  padding: 8px;
  box-sizing: border-box;
  resize: none;
}

.json-modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}

.json-modal-count {
  margin-right: auto;
  font-size: 11px;
  color: #888;
  font-family: monospace;
}

.json-modal-actions button {
  padding: 6px 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: #fff;
  cursor: pointer;
  font-size: 13px;
}

.json-modal-actions .json-modal-apply {
  background: #2c7a4b;
  border-color: #2c7a4b;
  color: #fff;
}

.json-modal-actions .json-modal-apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.json-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.json-status {
  font-size: 11px;
  font-family: monospace;
}

.json-status.ok {
  color: #27ae60;
}

.json-status.err {
  color: #c0392b;
}

.json-status.pending {
  color: #7f8c8d;
  font-style: italic;
}

.amp-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #333;
}

.amp-row label {
  min-width: max-content;
}

.amp-row input {
  width: 64px;
  padding: 4px 6px;
  border: 1px solid #ccc;
  border-radius: 4px;
  font-size: 12px;
}

.amp-apply {
  border: 1px solid #2E8B57;
  background: rgba(46, 139, 87, 0.1);
  color: #2c6e4f;
  border-radius: 4px;
  font-size: 11px;
  padding: 3px 8px;
  cursor: pointer;
}

.amp-apply:hover:not(:disabled) {
  background: rgba(46, 139, 87, 0.2);
}

.amp-apply:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.param-loop {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #333;
  margin-bottom: 8px;
  user-select: none;
  cursor: pointer;
}

.sample-region-editor {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #ddd;
}

.sample-region-editor h4 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #555;
}

.wavetable-3d-viewer {
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px dashed #ddd;
}

.wavetable-3d-viewer h4 {
  margin: 0 0 6px;
  font-size: 12px;
  color: #555;
}

.wavetable-3d-canvas {
  display: block;
  width: 100%;
  height: 230px;
  border-radius: 6px;
  background: #0a1016;
}

.wavetable-3d-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 11px;
  color: #777;
  margin-top: 4px;
}

.wavetable-3d-frame strong {
  color: #3f8f7b;
  font-variant-numeric: tabular-nums;
}

.wavetable-3d-frame em {
  font-style: normal;
  color: #b8860b;
}

.wavetable-3d-frame.off em {
  color: #999;
}

.wavetable-3d-count {
  font-family: monospace;
}

</style>
