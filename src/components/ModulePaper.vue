<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { dia, shapes } from '@joint/core'
import { useModuleCatalog } from '../composables/useModuleCatalog'

// Props / emits
const emit = defineEmits(['module-selected', 'module-removed', 'connection-added', 'connection-removed'])

// Réfs DOM
const paperEl = ref(null)

// Graph / Paper
let graph = null
let paper = null

// Modules trackés
const modulesById = new Map()

// Sélection
const selectedModule = ref(null)

// Zoom
const zoom = ref(1)
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.3
const ZOOM_MAX = 2

// Composable catalogue
const { getModuleByType } = useModuleCatalog()

// ------------------------
// ⚡ Fonctions principales
// ------------------------

// Ajout d'un module depuis la toolbar
const addModule = (type, x = 100, y = 100) => {
  const def = getModuleByType(type)
  if (!def) return

  // Générer l'id (ou tu peux passer un id forcé)
  const id = crypto.randomUUID()

  // Créer la shape JointJS
  const shape = new shapes.standard.Rectangle({
    id,
    position: { x, y },
    size: { width: 100, height: 40 },
    attrs: {
      body: { fill: def.color },
      label: { text: def.label, fill: 'white' }
    }
  })

  shape.addTo(graph)

  // Tracker le module
  modulesById.set(id, {
    id,
    type,
    params: Object.fromEntries(
      Object.entries(def.params).map(([k, v]) => [k, v.default])
    ),
    shape
  })

  return id
}

// Suppression d'un module et de ses liens
const removeModule = (id) => {
  const module = modulesById.get(id)
  if (!module) return

  // Supprimer les liens connectés
  const links = graph.getLinks().filter(link => {
    const s = link.get('source')
    const t = link.get('target')
    return s.id === id || t.id === id
  })
  links.forEach(link => {
    link.remove()
    emit('connection-removed', {
      from: link.get('source').id,
      to: link.get('target').id
    })
  })

  // Supprimer la shape
  module.shape.remove()
  modulesById.delete(id)
  emit('module-removed', module)
}

// Sélection visuelle
const selectModule = (id) => {
  if (selectedModule.value) {
    selectedModule.value.shape.attr('body/stroke', null)
  }
  const module = modulesById.get(id)
  if (!module) return
  selectedModule.value = module
  module.shape.attr('body/stroke', '#FF0000')
  emit('module-selected', module)
}

// ------------------------
// Zoom & Pan
// ------------------------
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

const zoomIn = () => {
  zoomAtPoint(Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  )
}

const zoomOut = () => {
  zoomAtPoint(Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  )
}

// ------------------------
// Lifecycle
// ------------------------
onMounted(() => {
  graph = new dia.Graph({}, { cellNamespace: shapes })

  paper = new dia.Paper({
    el: paperEl.value,
    model: graph,
    width: '100%',
    height: 400,
    background: { color: '#F5F5F5' },
    cellViewNamespace: shapes
  })

  // 🖱️ Click sur une shape
  paper.on('cell:pointerclick', (cellView) => {
    selectModule(cellView.model.id)
  })

  // 🖱️ Suppression avec touche Suppr
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && selectedModule.value) {
      removeModule(selectedModule.value.id)
    }
  })

  // 🖱️ Zoom avec Ctrl + molette
  paperEl.value.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    const rect = paperEl.value.getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    const nextZoom = e.deltaY < 0
      ? Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP)
      : Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP)
    zoomAtPoint(nextZoom, cx, cy)
  }, { passive: false })
})

onBeforeUnmount(() => {
  paper?.remove()
  graph?.clear()
})

// ------------------------
// Expose API pour le parent
// ------------------------
defineExpose({
  addModule,
  removeModule,
  zoomIn,
  zoomOut,
  modulesById
})
</script>

<template>
  <div class="paper-container">
    <div class="zoom-controls">
      <button @click="zoomOut">−</button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button @click="zoomIn">+</button>
    </div>
    <div ref="paperEl" class="paper"></div>
  </div>
</template>

<style scoped>
.paper-container {
  width: 100%;
  border: 1px solid #ddd;
  position: relative;
}

.paper {
  width: 100%;
  height: 400px;
}

.zoom-controls {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
  background: rgba(255,255,255,0.8);
  padding: 4px 6px;
  border-radius: 4px;
  z-index: 10;
}

.zoom-controls button {
  border: none;
  padding: 4px 8px;
  cursor: pointer;
}
</style>
