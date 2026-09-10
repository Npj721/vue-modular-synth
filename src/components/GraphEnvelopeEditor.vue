<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount } from "vue"

/* =========================================================
 * Composant : éditeur d'enveloppe graphique (canvas)
 *
 * Représentation interne : pour chaque phase (press/release)
 * une liste de POINTS (x = temps, y = valeur).
 * Deux points consécutifs = un "stage" {from, to, duration, curve}.
 *   - from     = valeur Y du point i
 *   - to       = valeur Y du point i+1
 *   - duration = différence X entre les deux points
 *   - curve    = courbe du segment menant au point i+1
 *
 * Notion de "current" : le premier point d'une phase peut porter
 * l'indicateur fromCurrent (repris du modèle stages, où l'on a par
 * ex. release[0].from === "current"). Dans le dessin, ce point est
 * une ancre visuelle en losange ; dans le modèle généré on conserve
 * from = "current" pour que le moteur audio utilise la valeur réelle.
 * ========================================================= */

const props = defineProps({
  stages: {
    type: Object,
    required: true,
    default: () => ({ press: [], release: [] }),
  },
  min: { type: Number, default: 0 },
  max: { type: Number, default: 1 },
  step: { type: Number, default: 0.0001 },
  unit: { type: String, default: "" },
  presetsKey: { type: String, default: "graphEnvelopes" },
})

const emit = defineEmits(["update"])

const PAD = 40
const M = Math
const TOOL_LABELS = { line: "Ligne", scurve: "S-curve", arc: "Arc", exp: "Exp", log: "Log" }

const yFormat = (v) => +v.toFixed(4) + props.unit
const clamp = (v, lo, hi) => M.max(lo, M.min(hi, v))
const round = (v) => (typeof v === "number" ? +v.toFixed(6) : v)
const clampDuration = (d) => M.max(0.0001, +d.toFixed(6))

/* ------------------------------------------------------------------
 * État interne
 * ------------------------------------------------------------------ */
const yMin = ref(props.min)
const yMax = ref(props.max)
const yMinVisible = ref(props.min)
const yMaxVisible = ref(props.max)

const phases = reactive({ press: [], release: [] })

let draggedPoint = null
let toolMode = null
let toolStart = null

const currentPhase = ref("press")
const viewMode = ref("graph")
const presetName = ref("Default")
const presetList = ref([])

const pressCanvas = ref(null)
const releaseCanvas = ref(null)
const tooltipEl = ref(null)

/* ------------------------------------------------------------------
 * Conversion stages -> points
 * ------------------------------------------------------------------ */
function fallbackAnchor() {
  return (yMaxVisible.value + yMinVisible.value) / 2
}

function stagesToPoints(stages) {
  if (!stages || !stages.length) return []
  const pts = []
  let t = 0
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]
    const isCurrent = typeof s.from === "string" && s.from === "current"
    if (i === 0) {
      pts.push({
        t: 0,
        v: isCurrent ? fallbackAnchor() : (typeof s.from === "number" ? s.from : fallbackAnchor()),
        current: isCurrent,
        fromCurrentSet: isCurrent,
        curve: undefined,
      })
    }
    const v = typeof s.to === "number" ? s.to : pts[pts.length - 1].v
    t += clampDuration(+s.duration || 0.05)
    pts.push({ t, v, current: false, curve: s.curve })
  }
  return pts
}

/* ------------------------------------------------------------------
 * Conversion points -> stages
 * ------------------------------------------------------------------ */
function pointsToStages(pts, forceStartCurrent) {
  const out = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const duration = clampDuration(b.t - a.t)
    const from =
      i === 0 && (forceStartCurrent || (a.current && a.fromCurrentSet))
        ? "current"
        : round(a.v)
    out.push({
      from,
      to: round(b.v),
      duration,
      curve: b.curve === "exponential" ? "exponential" : "linear",
    })
  }
  return out
}

/* ------------------------------------------------------------------
 * Gestion de la phase courante
 * ------------------------------------------------------------------ */
const phasePoints = (p) => (p === "press" ? phases.press : phases.release)

function phaseDuration(p) {
  const pts = phasePoints(p)
  if (!pts.length) return 2
  return M.max(0.001, pts[pts.length - 1].t)
}

function normalizePoints(pts) {
  pts.sort((a, b) => a.t - b.t)
  // supprime les doublons de temps (garde le premier : l'ancre "current")
  const kept = []
  for (const pt of pts) {
    const last = kept[kept.length - 1]
    if (!last || Math.abs(pt.t - last.t) > 1e-9) kept.push(pt)
  }
  for (const pt of kept) pt.v = clamp(pt.v, yMinVisible.value, yMaxVisible.value)
  pts.splice(0, pts.length, ...kept)
  return pts
}

/* ------------------------------------------------------------------
 * Synchronisation avec le modèle externe (stages)
 * ------------------------------------------------------------------ */
function syncFromProps(initRange) {
  const st = props.stages || {}
  // la plage min/max est persistée DANS les stages (st.min / st.max) :
  // on la restaure donc au montage à la place des défauts min=0 / max=1
  if (initRange === true) {
    const mn = typeof st.min === "number" ? st.min : props.min
    const mx = typeof st.max === "number" ? st.max : props.max
    yMinVisible.value = mn
    yMaxVisible.value = mx
    yMin.value = mn
    yMax.value = mx
  }
  phases.press = normalizePoints(stagesToPoints(st.press))
  phases.release = normalizePoints(stagesToPoints(st.release))
  refreshTableData()
  requestAnimationFrame(draw)
}

/* ------------------------------------------------------------------
 * Diffusion du modèle mis à jour
 * ------------------------------------------------------------------ */
function commit() {
  const press = pointsToStages(phases.press)
  const release = pointsToStages(phases.release)
  refreshTableData()
  // la plage min/max fait partie du modèle (persistée dans le patch)
  emit("update", { press, release, min: yMinVisible.value, max: yMaxVisible.value })
}

/* ------------------------------------------------------------------
 * Vue tableau : stages dérivés des points + édition par inputs
 * Le 1er stage peut démarrer sur "current" (from === "current").
 * Pour les stages suivants, from = to du stage précédent (continuité).
 * ------------------------------------------------------------------ */
const tableData = reactive({ press: [], release: [] })

const tablePhaseConfigs = [
  { key: "press", label: "Press (Note On)" },
  { key: "release", label: "Release (Note Off)" },
]

function refreshTableData() {
  tableData.press = pointsToStages(phases.press)
  tableData.release = pointsToStages(phases.release)
}

const isCurrentFrom = (st) => typeof st?.from === "string" && st.from === "current"

function setStartFrom(p, mode) {
  const row = tableData[p][0]
  if (!row) return
  if (mode === "current") {
    row.from = "current"
  } else {
    row.from = fallbackAnchor()
  }
  applyTableEdits(p)
}

function setStageField(p, i, field, val) {
  const row = tableData[p][i]
  if (!row) return
  row[field] = val
  applyTableEdits(p)
}

function addStageRow(p) {
  const rows = tableData[p]
  const last = rows[rows.length - 1]
  const v = last ? last.to : yMinVisible.value
  rows.push({ from: v, to: v, duration: 0.1, curve: "linear" })
  applyTableEdits(p)
}

function removeStageRow(p, i) {
  if (tableData[p].length <= 1) return
  tableData[p].splice(i, 1)
  applyTableEdits(p)
}

function applyTableEdits(p) {
  // le tableau est la source : on reconstruit les points du graphe
  phases[p] = normalizePoints(stagesToPoints(tableData[p]))
  // re-dérive le tableau depuis les points (force la continuité from = to précédent)
  refreshTableData()
  commit()
  requestAnimationFrame(draw)
}

/* ------------------------------------------------------------------
 * Manipulation des points
 * ------------------------------------------------------------------ */
function addPoint(p, sx, sy) {
  const pts = phasePoints(p)
  const d = screenToData(sx, sy, p)
  const pt = { t: d.t, v: d.v, current: false, curve: "linear" }
  pts.push(pt)
  normalizePoints(pts)
  return pt
}

function removePoint(p, index) {
  const pts = phasePoints(p)
  if (pts.length <= 1) return
  pts.splice(index, 1)
}

function clearPhase(p) {
  const pts = phasePoints(p)
  const mn = yMinVisible.value
  const flat =
    p === "press"
      ? [
          { t: 0, v: mn, current: false, curve: undefined },
          { t: 0.5, v: mn, current: false, curve: "linear" },
        ]
      : [
          { t: 0, v: fallbackAnchor(), current: true, fromCurrentSet: true, curve: undefined },
          { t: 0.5, v: mn, current: false, curve: "linear" },
        ]
  pts.splice(0, pts.length, ...flat)
}

/* ------------------------------------------------------------------
 * Coordonnées écran <-> données
 * ------------------------------------------------------------------ */
function canvasOf(p) {
  return p === "press" ? pressCanvas.value : releaseCanvas.value
}

function screenToData(sx, sy, p) {
  const cv = canvasOf(p)
  const dur = Math.max(0.001, phaseDuration(p))
  const pw = cv.width - PAD * 2
  const ph = cv.height - PAD * 2
  const mn = yMinVisible.value
  const mx = yMaxVisible.value
  const rng = mx - mn || 1
  return {
    t: clamp((sx - PAD) / pw, 0, 1) * dur,
    v: clamp(((1 - (sy - PAD) / ph) * rng) + mn, mn, mx),
  }
}

function dataToScreen(t, v, p) {
  const cv = canvasOf(p)
  const dur = Math.max(0.001, phaseDuration(p))
  const pw = cv.width - PAD * 2
  const ph = cv.height - PAD * 2
  const mn = yMinVisible.value
  const mx = yMaxVisible.value
  const rng = mx - mn || 1
  return {
    x: PAD + (t / dur) * pw,
    y: PAD + ph * (1 - (v - mn) / rng),
  }
}

function hitTest(sx, sy, p) {
  const pts = phasePoints(p)
  let best = null
  let bd = 16
  for (let i = 0; i < pts.length; i++) {
    const s = dataToScreen(pts[i].t, pts[i].v, p)
    const d = M.hypot(s.x - sx, s.y - sy)
    if (d < bd) { bd = d; best = i }
  }
  return best
}

function canvasCoords(e, p) {
  const cv = canvasOf(p)
  const rect = cv.getBoundingClientRect()
  return {
    sx: (e.clientX - rect.left) * (cv.width / rect.width),
    sy: (e.clientY - rect.top) * (cv.height / rect.height),
  }
}

/* ------------------------------------------------------------------
 * Événements souris
 * ------------------------------------------------------------------ */
function onMouseDown(e, p) {
  const { sx, sy } = canvasCoords(e, p)
  const pts = phasePoints(p)

  if (e.button === 2) {
    const idx = hitTest(sx, sy, p)
    if (idx !== null && pts.length > 1) {
      removePoint(p, idx)
      commit()
      requestAnimationFrame(draw)
    }
    hideTooltip()
    return
  }

  if (toolMode) {
    toolStart = screenToData(sx, sy, p)
    return
  }

  const idx = hitTest(sx, sy, p)
  if (idx !== null) {
    draggedPoint = { p, point: pts[idx] }
  } else {
    const pt = addPoint(p, sx, sy)
    draggedPoint = { p, point: pt }
  }
  requestAnimationFrame(draw)
}

function onMouseMove(e, p) {
  const { sx, sy } = canvasCoords(e, p)
  const pts = phasePoints(p)

  if (toolMode && toolStart) {
    const cur = screenToData(sx, sy, p)
    requestAnimationFrame(draw)
    const ghost = genCurve(toolStart, cur, toolMode)
    const ctx = canvasOf(p).getContext("2d")
    ctx.strokeStyle = "rgba(255,255,255,.55)"
    ctx.lineWidth = 2
    ctx.beginPath()
    for (let i = 0; i < ghost.length; i++) {
      const s = dataToScreen(ghost[i].t, ghost[i].v, p)
      i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)
    }
    ctx.stroke()
    showTooltip(e, cur.t, cur.v)
    return
  }

  if (draggedPoint && draggedPoint.p === p) {
    const d = screenToData(sx, sy, p)
    const idx = pts.indexOf(draggedPoint.point)
    // Le dernier point est ancré à la durée totale de la phase : déplacer le
    // point ne change que sa valeur (vertical), jamais la durée totale.
    const isLast = idx === pts.length - 1
    draggedPoint.point.t = isLast ? pts[pts.length - 1].t : d.t
    draggedPoint.point.v = d.v
    normalizePoints(pts)
    requestAnimationFrame(draw)
    showTooltip(e, draggedPoint.point.t, draggedPoint.point.v)
  } else {
    const idx = hitTest(sx, sy, p)
    if (idx !== null) showTooltip(e, pts[idx].t, pts[idx].v)
    else hideTooltip()
  }
}

function onMouseUp(e, p) {
  if (toolMode && toolStart) {
    const { sx, sy } = canvasCoords(e, p)
    applyCurveTo(p, screenToData(sx, sy, p))
    toolStart = null
    toolMode = null
    commit()
    requestAnimationFrame(draw)
    hideTooltip()
    return
  }
  if (draggedPoint) commit()
  draggedPoint = null
  hideTooltip()
}

/* ------------------------------------------------------------------
 * Courbes (outils) : génération de multiples segments
 * ------------------------------------------------------------------ */
function genCurve(a, b, mode) {
  if (!a || !b) return []
  const n = 20
  const ta = M.min(a.t, b.t)
  const tb = M.max(a.t, b.t)
  const va = a.t < b.t ? a.v : b.v
  const vb = a.t < b.t ? b.v : a.v
  const dx = tb - ta || 0.0001
  const pts = []
  for (let i = 0; i <= n; i++) {
    const f = i / n
    let v
    switch (mode) {
      case "line": v = va + (vb - va) * f; break
      case "scurve": v = va + (vb - va) * (1 - M.cos(M.PI * f)) / 2; break
      case "arc": v = va + (vb - va) * M.sin(M.PI * f / 2); break
      case "exp": v = va + (vb - va) * (M.pow(M.E, 4 * f) - 1) / (M.pow(M.E, 4) - 1); break
      case "log": v = va + (vb - va) * M.log(1 + 4 * f) / M.log(5); break
      default: v = va + (vb - va) * f; break
    }
    pts.push({ t: ta + dx * f, v })
  }
  return pts
}

function applyCurveTo(p, end) {
  if (!toolStart || !end) return
  const pts = phasePoints(p)
  const ta = M.min(toolStart.t, end.t)
  const tb = M.max(toolStart.t, end.t)
  const gen = genCurve(toolStart, end, toolMode)
  for (let i = pts.length - 1; i >= 0; i--) {
    if (pts[i].t > ta && pts[i].t < tb) pts.splice(i, 1)
  }
  for (const pt of gen) {
    pts.push({ t: pt.t, v: pt.v, current: false, curve: toolMode === "exp" ? "exponential" : "linear" })
  }
  normalizePoints(pts)
}

/* ------------------------------------------------------------------
 * Tooltip
 * ------------------------------------------------------------------ */
function showTooltip(e, t, v) {
  if (!tooltipEl.value) return
  tooltipEl.value.textContent = "t: " + t.toFixed(3) + "s   v: " + yFormat(v)
  tooltipEl.value.style.display = "block"
  tooltipEl.value.style.left = (e.clientX + 14) + "px"
  tooltipEl.value.style.top = (e.clientY - 34) + "px"
}
function hideTooltip() {
  if (tooltipEl.value) tooltipEl.value.style.display = "none"
}

/* ------------------------------------------------------------------
 * Min / Max
 * ------------------------------------------------------------------ */
function applyMinMax() {
  const mn = +yMin.value
  const mx = +yMax.value
  if (!Number.isFinite(mn) || !Number.isFinite(mx) || mn > mx) return
  yMinVisible.value = mn
  yMaxVisible.value = mx
  for (const p of ["press", "release"]) {
    for (const pt of phasePoints(p)) pt.v = clamp(pt.v, mn, mx)
  }
  commit()
  requestAnimationFrame(draw)
}

function selectTool(tool) {
  toolMode = toolMode === tool ? null : tool
  toolStart = null
}

/* ------------------------------------------------------------------
 * Étirer / rétrécir : applique un offset (s) à la durée de chaque stage.
 * Les valeurs restent identiques, seuls les instants sont décalés.
 * ------------------------------------------------------------------ */
function offsetPhaseDuration(p, deltaSec) {
  const pts = phasePoints(p)
  if (pts.length < 2) return
  const MIN = 0.0001
  const durs = []
  for (let i = 1; i < pts.length; i++) durs.push(pts[i].t - pts[i - 1].t)
  let t = 0
  pts[0].t = 0
  for (let i = 0; i < durs.length; i++) {
    // chaque stage ne peut pas descendre sous la durée minimale
    t += Math.max(MIN, durs[i] + deltaSec)
    pts[i + 1].t = t
  }
  commit()
  requestAnimationFrame(draw)
}

function offsetBy(p, ms) {
  offsetPhaseDuration(p, ms / 1000)
}

/* ------------------------------------------------------------------
 * Presets (localStorage)
 * ------------------------------------------------------------------ */
function loadPresets() {
  try {
    return JSON.parse(localStorage.getItem(props.presetsKey) || "{}")
  } catch { return {} }
}
function refreshPresetList() {
  presetList.value = Object.keys(loadPresets())
}
function savePreset() {
  const name = (presetName.value || "").trim()
  if (!name) return
  const all = loadPresets()
  all[name] = {
    press: pointsToStages(phases.press),
    release: pointsToStages(phases.release),
    min: yMinVisible.value,
    max: yMaxVisible.value,
  }
  localStorage.setItem(props.presetsKey, JSON.stringify(all))
  refreshPresetList()
}
function loadPreset() {
  const sel = document.getElementById(props.presetsKey + "-list")
  const name = sel && sel.value
  if (!name) return
  const data = loadPresets()[name]
  if (!data) return
  yMinVisible.value = data.min ?? props.min
  yMaxVisible.value = data.max ?? props.max
  yMin.value = data.min ?? props.min
  yMax.value = data.max ?? props.max
  phases.press = normalizePoints(stagesToPoints(data.press))
  phases.release = normalizePoints(stagesToPoints(data.release))
  presetName.value = name
  commit()
  requestAnimationFrame(draw)
}
function deletePreset() {
  const sel = document.getElementById(props.presetsKey + "-list")
  const name = sel && sel.value
  if (!name) return
  const all = loadPresets()
  delete all[name]
  localStorage.setItem(props.presetsKey, JSON.stringify(all))
  refreshPresetList()
}

/* ------------------------------------------------------------------
 * Dessin
 * ------------------------------------------------------------------ */
function draw() {
  drawPhase("press")
  drawPhase("release")
}

function drawPhase(p) {
  const cv = canvasOf(p)
  if (!cv) return
  const ctx = cv.getContext("2d")
  const w = cv.width
  const h = cv.height
  const dur = Math.max(0.001, phaseDuration(p))
  const mn = yMinVisible.value
  const mx = yMaxVisible.value
  const rng = mx - mn || 1
  const pw = w - PAD * 2
  const ph = h - PAD * 2

  const color = p === "press" ? "#00ff88" : "#ffb84d"
  const fill = p === "press" ? "rgba(0,255,136,.12)" : "rgba(255,184,77,.12)"
  const zeroY = mn <= 0 && mx >= 0 ? PAD + ph * (1 - (0 - mn) / rng) : PAD + ph

  ctx.fillStyle = "#111"
  ctx.fillRect(0, 0, w, h)

  const steps = 4
  ctx.strokeStyle = "#333"
  ctx.lineWidth = 1
  ctx.fillStyle = "#888"
  ctx.font = "11px Arial"
  ctx.textAlign = "right"
  for (let i = 0; i <= steps; i++) {
    const y = PAD + ph * (1 - i / steps)
    ctx.beginPath(); ctx.moveTo(PAD, y); ctx.lineTo(w - PAD, y); ctx.stroke()
    ctx.fillText(yFormat(mn + rng * i / steps), PAD - 4, y + 4)
  }

  ctx.strokeStyle = "#555"
  ctx.beginPath(); ctx.moveTo(PAD, zeroY); ctx.lineTo(w - PAD, zeroY); ctx.stroke()

  ctx.fillStyle = "#888"
  ctx.textAlign = "center"
  ctx.fillText(dur.toFixed(2) + "s", w - PAD, h - 8)

  const pts = phasePoints(p)
  if (!pts.length) return

  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(PAD, zeroY)
  for (const pt of pts) {
    const s = dataToScreen(pt.t, pt.v, p)
    ctx.lineTo(s.x, s.y)
  }
  ctx.lineTo(PAD + pw, zeroY)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    const s = dataToScreen(pts[i].t, pts[i].v, p)
    i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)
  }
  ctx.stroke()

  for (const pt of pts) {
    const s = dataToScreen(pt.t, pt.v, p)
    const isDrag = draggedPoint && draggedPoint.point === pt
    if (pt.current) {
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(s.x, s.y - 6)
      ctx.lineTo(s.x + 6, s.y)
      ctx.lineTo(s.x, s.y + 6)
      ctx.lineTo(s.x - 6, s.y)
      ctx.closePath()
      ctx.stroke()
      ctx.fillStyle = "rgba(255,255,255,.15)"
      ctx.fill()
    } else {
      ctx.fillStyle = isDrag ? "#ff0" : color
      ctx.beginPath(); ctx.arc(s.x, s.y, 5, 0, M.PI * 2); ctx.fill()
    }
  }
}

/* ------------------------------------------------------------------
 * Watchers / lifecycle
 * ------------------------------------------------------------------ */
watch(() => props.stages, () => syncFromProps(false), { deep: true })

onMounted(() => {
  syncFromProps(true)
  refreshPresetList()
})

onBeforeUnmount(() => {
  document.onmousemove = null
  document.onmouseup = null
})
</script>

<template>
  <div class="graph-env-root">
    <div class="env-range">
      <label>Min <input type="number" v-model.number="yMin" :step="step" @change="applyMinMax" /></label>
      <label>Max <input type="number" v-model.number="yMax" :step="step" @change="applyMinMax" /></label>
      <span v-if="unit" class="env-unit">{{ unit }}</span>
    </div>

    <div class="env-view-toggle">
      <button :class="{ active: viewMode === 'graph' }" @click="viewMode = 'graph'; requestAnimationFrame(draw)">Graphique</button>
      <button :class="{ active: viewMode === 'table' }" @click="viewMode = 'table'">Tableau</button>
    </div>

    <div v-show="viewMode === 'graph'">
      <div class="env-editor">
      <div class="env-head">
        <h4>Press (Note On)</h4>
        <span class="env-phase-status">{{ Math.max(0, phases.press.length - 1) }} stage(s) · {{ Math.round(phaseDuration('press') * 1000) }} ms</span>
        <div class="env-stretch-btns">
          <button title="Rétrécir chaque stage (100 ms)" @click="offsetBy('press', -1)">−</button>
          <button title="Étirer chaque stage (100 ms)" @click="offsetBy('press', 1)">+</button>
        </div>
      </div>
      <div class="env-tools">
        <span class="env-tools-label">Courbe :</span>
        <button
          v-for="tool in ['line','scurve','arc','exp','log']"
          :key="tool"
          class="env-tool"
          :class="{ active: toolMode === tool && currentPhase === 'press' }"
          @click="currentPhase='press'; selectTool(tool)"
        >{{ TOOL_LABELS[tool] }}</button>
        <button class="env-tool clear" @click="clearPhase('press'); commit(); requestAnimationFrame(draw)">Clear</button>
      </div>
      <canvas
        ref="pressCanvas"
        width="640"
        height="200"
        class="env-canvas"
        @mousedown="onMouseDown($event,'press')"
        @mousemove="onMouseMove($event,'press')"
        @mouseup="onMouseUp($event,'press')"
        @mouseleave="hideTooltip"
        @contextmenu.prevent
      ></canvas>
      <p class="env-hint">Clic : ajouter · Glisser : déplacer · Clic droit : supprimer · Outil courbe : tracer</p>
    </div>

    <div class="env-editor">
      <div class="env-head">
        <h4>Release (Note Off)</h4>
        <span class="env-phase-status">{{ Math.max(0, phases.release.length - 1) }} stage(s) · {{ Math.round(phaseDuration('release') * 1000) }} ms</span>
        <div class="env-stretch-btns">
          <button title="Rétrécir chaque stage (100 ms)" @click="offsetBy('release', -1)">−</button>
          <button title="Étirer chaque stage (100 ms)" @click="offsetBy('release', 1)">+</button>
        </div>
      </div>
      <div class="env-tools">
        <span class="env-tools-label">Courbe :</span>
        <button
          v-for="tool in ['line','scurve','arc','exp','log']"
          :key="tool"
          class="env-tool"
          :class="{ active: toolMode === tool && currentPhase === 'release' }"
          @click="currentPhase='release'; selectTool(tool)"
        >{{ TOOL_LABELS[tool] }}</button>
        <button class="env-tool clear" @click="clearPhase('release'); commit(); requestAnimationFrame(draw)">Clear</button>
      </div>
      <canvas
        ref="releaseCanvas"
        width="640"
        height="200"
        class="env-canvas"
        @mousedown="onMouseDown($event,'release')"
        @mousemove="onMouseMove($event,'release')"
        @mouseup="onMouseUp($event,'release')"
        @mouseleave="hideTooltip"
        @contextmenu.prevent
      ></canvas>
      <p class="env-hint">1er point = "current" (ancrage visuel) · Clic : ajouter · Glisser : déplacer · Clic droit : supprimer</p>
      </div>
    </div>

    <div v-show="viewMode === 'table'">
      <div class="env-editor" v-for="cfg in tablePhaseConfigs" :key="cfg.key">
        <div class="env-head">
          <h4>{{ cfg.label }}</h4>
          <span class="env-phase-status">{{ tableData[cfg.key].length }} stage(s)</span>
          <div class="env-stretch-btns">
            <button title="Rétrécir chaque stage (1 ms)" @click="offsetBy(cfg.key, -1)">−</button>
            <button title="Étirer chaque stage (1 ms)" @click="offsetBy(cfg.key, 1)">+</button>
          </div>
        </div>
        <table class="env-table">
          <thead>
            <tr>
              <th style="width:26px">#</th>
              <th>From</th>
              <th>To</th>
              <th>Durée (s)</th>
              <th>Courbe</th>
              <th style="width:36px"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(st, i) in tableData[cfg.key]" :key="i">
              <td class="env-table-idx">{{ i }}</td>
              <td>
                <template v-if="i === 0">
                  <label class="env-current">
                    <input
                      type="checkbox"
                      :checked="isCurrentFrom(st)"
                      @change="setStartFrom(cfg.key, $event.target.checked ? 'current' : 'value')"
                    />
                    <span>current</span>
                  </label>
                  <input
                    v-if="!isCurrentFrom(st)"
                    type="number"
                    :value="st.from"
                    :min="yMinVisible"
                    :max="yMaxVisible"
                    :step="step"
                    @input="setStageField(cfg.key, i, 'from', Number($event.target.value))"
                  />
                </template>
                <input v-else type="number" :value="st.from" disabled title="= fin du stage précédent" />
              </td>
              <td>
                <input
                  type="number"
                  :value="st.to"
                  :min="yMinVisible"
                  :max="yMaxVisible"
                  :step="step"
                  @input="setStageField(cfg.key, i, 'to', Number($event.target.value))"
                />
              </td>
              <td>
                <input
                  type="number"
                  :value="st.duration"
                  min="0.0001"
                  step="0.01"
                  @input="setStageField(cfg.key, i, 'duration', Math.max(0.0001, Number($event.target.value)))"
                />
              </td>
              <td>
                <select :value="st.curve" @change="setStageField(cfg.key, i, 'curve', $event.target.value)">
                  <option value="linear">linear</option>
                  <option value="exponential">exponential</option>
                </select>
              </td>
              <td>
                <button class="env-tool clear" :disabled="tableData[cfg.key].length <= 1" @click="removeStageRow(cfg.key, i)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
        <button class="env-tool add" @click="addStageRow(cfg.key)">+ Ajouter un stage</button>
      </div>
    </div>

    <div class="env-saves">
      <label>Nom <input type="text" v-model="presetName" /></label>
      <button @click="savePreset">Sauver</button>
      <select :id="presetsKey + '-list'">
        <option value="">— charger —</option>
        <option v-for="n in presetList" :key="n" :value="n">{{ n }}</option>
      </select>
      <button @click="loadPreset">Charger</button>
      <button @click="deletePreset">Supprimer</button>
    </div>

    <div ref="tooltipEl" class="env-tooltip"></div>
  </div>
</template>

<style scoped>
.graph-env-root {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  font-size: 12px;
}
.env-range {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.env-range label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #bbb;
}
.env-range input {
  width: 90px;
}
.env-unit {
  color: #666;
}
.env-view-toggle {
  display: flex;
  gap: 6px;
}
.env-view-toggle button {
  padding: 4px 14px;
  font-size: 12px;
  background: #333;
  color: #999;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
}
.env-view-toggle button.active {
  background: #00ff88;
  color: #000;
  border-color: #00ff88;
}
.env-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 8px;
}
.env-table th,
.env-table td {
  padding: 4px 6px;
  text-align: left;
  border-bottom: 1px solid #2a2a2a;
  font-size: 12px;
}
.env-table th {
  color: #888;
  font-weight: normal;
  font-size: 11px;
}
.env-table input[type="number"] {
  width: 100%;
  box-sizing: border-box;
  background: #222;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
}
.env-table input[type="number"]:disabled {
  background: #1b1b1b;
  color: #777;
  opacity: 1;
}
.env-table select {
  background: #222;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
  width: 100%;
  box-sizing: border-box;
}
.env-table button:disabled {
  opacity: 0.35;
  cursor: default;
}
.env-table-idx {
  color: #666;
}
.env-current {
  display: flex;
  align-items: center;
  gap: 5px;
  color: #aaa;
  font-size: 11px;
  white-space: nowrap;
}
.env-current input {
  margin: 0;
}
.env-editor {
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  padding: 8px;
  background: #1b1b1b;
}
.env-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.env-head h4 {
  margin: 0;
  color: #ccc;
  font-size: 13px;
}
.env-phase-status {
  color: #666;
  font-size: 11px;
}
.env-stretch-btns {
  display: flex;
  gap: 4px;
}
.env-stretch-btns button {
  width: 24px;
  height: 22px;
  line-height: 1;
  padding: 0;
  font-size: 14px;
  background: #333;
  color: #ddd;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
}
.env-stretch-btns button:hover {
  background: #444;
}
.env-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  margin-bottom: 6px;
}
.env-tools-label {
  color: #888;
}
.env-tool {
  padding: 2px 10px;
  font-size: 11px;
  background: #333;
  color: #999;
  border: 1px solid #555;
  border-radius: 3px;
  cursor: pointer;
}
.env-tool.active {
  background: #00ff88;
  color: #000;
  border-color: #00ff88;
}
.env-tool.clear {
  color: #f88;
  border-color: #744;
}
.env-canvas {
  width: 100%;
  height: auto;
  background: #111;
  border: 1px solid #333;
  border-radius: 4px;
  cursor: crosshair;
  touch-action: none;
  display: block;
}
.env-hint {
  color: #777;
  font-size: 11px;
  margin: 6px 0 0;
}
.env-saves {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  border-top: 1px solid #2a2a2a;
  padding-top: 10px;
}
.env-saves label {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #bbb;
}
.env-saves input,
.env-saves select {
  background: #222;
  color: #fff;
  border: 1px solid #444;
  border-radius: 3px;
  padding: 3px 6px;
}
.env-saves input {
  width: 110px;
}
.env-saves button {
  padding: 3px 12px;
  font-size: 11px;
  cursor: pointer;
}
.env-tooltip {
  position: fixed;
  background: rgba(0, 0, 0, 0.88);
  color: #00ff88;
  padding: 4px 10px;
  border-radius: 4px;
  font: 11px/1.4 monospace;
  pointer-events: none;
  display: none;
  z-index: 100;
  white-space: nowrap;
  border: 1px solid #00ff8855;
}
</style>
