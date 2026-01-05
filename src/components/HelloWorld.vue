<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { dia, shapes } from '@joint/core'

import { useModuleCatalog } from '../composables/useModuleCatalog'
const { getCatalog, getModuleByType, getModuleTypes } = useModuleCatalog()


console.log(getCatalog());
const paperEl = ref(null)

let graph = null
let paper = null

// ===== ZOOM CONFIG =====
const zoom = ref(1)
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.3
const ZOOM_MAX = 2

// ===== CORE ZOOM FUNCTION =====
// Zoom autour d’un point écran (clientX / clientY)
const zoomAtPoint = (newZoom, cx, cy) => {
  const oldScale = paper.scale().sx
  const factor = newZoom / oldScale

  const translate = paper.translate()

  const tx = cx - (cx - translate.tx) * factor
  const ty = cy - (cy - translate.ty) * factor

  paper.translate(tx, ty)
  paper.scale(newZoom, newZoom)

  zoom.value = newZoom
}


// ===== BUTTON HANDLERS =====
const zoomIn = () => {
  zoomAtPoint(
    Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  )
}

const zoomOut = () => {
  zoomAtPoint(
    Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  )
}


onMounted(() => {
  // ===== GRAPH / PAPER =====
  graph = new dia.Graph({}, { cellNamespace: shapes })

  paper = new dia.Paper({
    el: paperEl.value,
    model: graph,
    width: '100%',
    height: '100vh',
    background: { color: '#F5F5F5' },
    cellViewNamespace: shapes,
    gridSize: 10,
    drawGrid: true
  })

  let selected = null

  paper.on('cell:pointerclick', (cellView, evt, x, y) => {
    console.log('Cell clicked:', cellView.model.id)
    if (selected) {
      selected.attr('body/stroke', null) // désélection
    }
    selected = cellView.model
    selected.attr('body/stroke', '#FF0000') // highlight
  })


  // ===== CTRL + WHEEL ZOOM =====
  paperEl.value.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()

      const rect = paperEl.value.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top

      const nextZoom = e.deltaY < 0
        ? Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP)
        : Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP)

      zoomAtPoint(nextZoom, cx, cy)
    },
    { passive: false }
  )


  // ===== SHAPES =====
  const rect1 = new shapes.standard.Rectangle()
  rect1.position(250, 50)
  rect1.resize(100, 40)
  rect1.attr({
    body: { fill: '#FF7BE5' },
    label: { text: 'Osc', fill: 'white' }
  })

  const rect2 = new shapes.standard.Rectangle()
  rect2.position(50, 50)
  rect2.resize(100, 40)
  rect2.attr({
    body: { fill: '#2C7BE5' },
    label: { text: 'Gain', fill: 'white' }
  })

  const link = new shapes.standard.Link()
  link.source(rect1)
  link.target(rect2)

  graph.addCells([rect1, rect2, link])
})

onBeforeUnmount(() => {
  paper?.remove()
  graph?.clear()
})
</script>

<template>
  <div class="toolbar">
    <button @click="zoomOut">−</button>
    <span>{{ Math.round(zoom * 100) }}%</span>
    <button @click="zoomIn">+</button>
  </div>

  <div ref="paperEl" class="paper-container"></div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}

.paper-container {
  width: 100%;
  height: 300px;
  border: 1px solid #ddd;
  overflow: hidden;
}
</style>
