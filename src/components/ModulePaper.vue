<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { dia, shapes } from '@joint/core'
import { useModuleCatalog } from '../composables/useModuleCatalog'

/* --------------------
 * Emits
 * -------------------- */
const emit = defineEmits([
  'module-selected',
  'module-removed',
  'connection-added',
  'connection-removed'
])

/* --------------------
 * Refs / state
 * -------------------- */
const paperEl = ref(null)

let graph = null
let paper = null

const modulesById = new Map()
const selectedModule = ref(null)

/* --------------------
 * Zoom
证明
 * -------------------- */
const zoom = ref(1)
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.3
const ZOOM_MAX = 2

/* --------------------
 * Catalog
 * -------------------- */
const { getModuleByType } = useModuleCatalog()

/* =========================================================
 * 🔴 MODULE CREATION (ports support)
 * ========================================================= */
const addModule = (type, x = 100, y = 100) => {
  const def = getModuleByType(type)
  if (!def) return

  const id = crypto.randomUUID()

  const shape = new shapes.standard.Rectangle({
    id,
    position: { x, y },
    size: { width: 140, height: 80 },
    attrs: {
      body: {
        fill: def.color,
        rx: 6,
        ry: 6
      },
      label: {
        text: def.label,
        fill: 'white',
        fontSize: 13
      }
    },

    // 🔴 Ports definition
    ports: {
      groups: {
        in: {
          position: 'left',
          attrs: {
            circle: {
              r: 6,
              magnet: 'passive',
              fill: '#FFD166',
              stroke: '#000'
            }
          }
        },
        out: {
          position: 'right',
          attrs: {
            circle: {
              r: 6,
              magnet: true,
              fill: '#06D6A0',
              stroke: '#000'
            }
          }
        }
      }
    }
  })

  // 🔴 Add ports from catalog
  shape.addPorts([
    ...def.inputs.map(p => ({
      id: p.id,
      group: 'in',
      data: { kind: p.kind }
    })),
    ...def.outputs.map(p => ({
      id: p.id,
      group: 'out',
      data: { kind: p.kind }
    }))
  ])

  shape.addTo(graph)

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

/* =========================================================
 * 🗑️ REMOVE MODULE + LINKS
 * ========================================================= */
const removeModule = (id) => {
  const module = modulesById.get(id)
  if (!module) return

  graph.getLinks().forEach(link => {
    const s = link.get('source')
    const t = link.get('target')

    if (s.id === id || t.id === id) {
      emit('connection-removed', {
        from: s,
        to: t
      })
      link.remove()
    }
  })

  module.shape.remove()
  modulesById.delete(id)

  emit('module-removed', module)
}

/* =========================================================
 * 🖱️ SELECTION
 * ========================================================= */
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

/* =========================================================
 * 🔗 CONNECTION HANDLING
 * ========================================================= */
const setupConnections = () => {
  paper.on('link:connect', (linkView) => {
    const link = linkView.model
    const source = link.get('source')
    const target = link.get('target')

    emit('connection-added', {
      from: {
        moduleId: source.id,
        port: source.port
      },
      to: {
        moduleId: target.id,
        port: target.port
      }
    })
  })

  graph.on('remove', (cell) => {
    if (!cell.isLink()) return

    const source = cell.get('source')
    const target = cell.get('target')

    emit('connection-removed', {
      from: {
        moduleId: source.id,
        port: source.port
      },
      to: {
        moduleId: target.id,
        port: target.port
      }
    })
  })
}

/* =========================================================
 * 🔍 VALIDATE CONNECTIONS
 * ========================================================= */
const validateConnection = (srcView, srcMagnet, tgtView, tgtMagnet) => {
  if (!srcMagnet || !tgtMagnet) return false
  if (srcView === tgtView) return false

  const srcGroup = srcMagnet.getAttribute('port-group')
  const tgtGroup = tgtMagnet.getAttribute('port-group')
  if (srcGroup !== 'out' || tgtGroup !== 'in') return false

  const srcPort = srcView.model.getPort(srcMagnet.getAttribute('port'))
  const tgtPort = tgtView.model.getPort(tgtMagnet.getAttribute('port'))

  return srcPort?.data?.kind === tgtPort?.data?.kind
}

/* =========================================================
 * 🔍 ZOOM
 * ========================================================= */
const zoomAtPoint = (newZoom, cx, cy) => {
  const oldScale = paper.scale().sx
  const factor = newZoom / oldScale
  const translate = paper.translate()

  paper.translate(
    cx - (cx - translate.tx) * factor,
    cy - (cy - translate.ty) * factor
  )
  paper.scale(newZoom, newZoom)
  zoom.value = newZoom
}

const zoomIn = () =>
  zoomAtPoint(Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  )

const zoomOut = () =>
  zoomAtPoint(Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  )

/* =========================================================
 * LIFECYCLE
 * ========================================================= */
onMounted(() => {
  graph = new dia.Graph({}, { cellNamespace: shapes })

  paper = new dia.Paper({
    el: paperEl.value,
    model: graph,
    width: '100%',
    height: 400,
    background: { color: '#F5F5F5' },
    cellViewNamespace: shapes,
    defaultLink: () => new shapes.standard.Link(),
    linkPinning: false,
    validateConnection
  })

  setupConnections()

  paper.on('cell:pointerclick', (cellView) => {
    if (!cellView.model.isLink()) {
      selectModule(cellView.model.id)
    }
  })

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' && selectedModule.value) {
      removeModule(selectedModule.value.id)
    }
  })

  paperEl.value.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return
    e.preventDefault()

    const rect = paperEl.value.getBoundingClientRect()
    zoomAtPoint(
      e.deltaY < 0
        ? Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP)
        : Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP),
      e.clientX - rect.left,
      e.clientY - rect.top
    )
  }, { passive: false })
})

onBeforeUnmount(() => {
  paper?.remove()
  graph?.clear()
})

/* --------------------
 * API exposée
 * -------------------- */
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
</style>
