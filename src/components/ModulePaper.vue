<script setup>
import { ref, onMounted, onBeforeUnmount, toRaw } from "vue";
import { dia, shapes } from "@joint/core";
import { useModuleCatalog } from "../composables/useModuleCatalog";

const emit = defineEmits([
  "module-added",
  "module-selected",
  "module-removed",
  "module-moved",
  "connection-added",
  "connection-removed",
]);

const props = defineProps({
  // étirer le canvas sur la hauteur du conteneur parent
  fillHeight: { type: Boolean, default: false },
});

const paperEl = ref(null);
let graph;
let paper;
let resizeObserver = null;

let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { tx: 0, ty: 0 };

const zoom = ref(1);
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 2;

const zoomAtPoint = (newZoom, cx, cy) => {
  const oldScale = paper.scale().sx;
  const factor = newZoom / oldScale;
  const translate = paper.translate();
  const tx = cx - (cx - translate.tx) * factor;
  const ty = cy - (cy - translate.ty) * factor;
  paper.translate(tx, ty);
  paper.scale(newZoom, newZoom);
  zoom.value = newZoom;
};

const zoomIn = () =>
  zoomAtPoint(
    Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  );
const zoomOut = () =>
  zoomAtPoint(
    Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP),
    paperEl.value.clientWidth / 2,
    paperEl.value.clientHeight / 2
  );

const modulesById = new Map();
const selectedModule = ref(null);
const { getModuleByType } = useModuleCatalog();

/* =========================
 * PORT GROUPS (Community Edition)
 * ========================= */
const portGroups = {
  in: {
    position: { name: "left" },
    attrs: {
      circle: { r: 6, magnet: true, fill: "#fff", stroke: "#000" },
      text: { fill: "#000", fontSize: 10, textAnchor: "end", y: 0 },
    },
  },
  out: {
    position: { name: "right" },
    attrs: {
      circle: { r: 6, magnet: true, fill: "#000", stroke: "#000" },
      text: { fill: "#000", fontSize: 10, textAnchor: "start", y: 0 },
    },
  },
};

/* =========================
 * ADD MODULE
 * ========================= */
const addModule = (type, x = 100, y = 100, forcedId = null) => {
  const def = getModuleByType(type);
  if (!def) return;

  const id = forcedId ?? crypto.randomUUID()

  const ports = [
    ...def.ports.inputs.map((p, i) => ({
      id: `in:${p.id}`,
      group: "in",
      attrs: {
        circle: {
          "data-port": p.id,
          "data-kind": p.kind,
          // rôle déclaré par le catalogue (fallback dérivé du kind)
          "data-role":
            p.role ?? (p.kind === "audio" ? "audioIn" : "modulatable"),
        },
        text: { text: p.label ?? p.id },
      },
      args: { index: i },
    })),
    ...def.ports.outputs.map((p, i) => ({
      id: `out:${p.id}`,
      group: "out",
      attrs: {
        circle: {
          "data-port": p.id,
          "data-kind": p.kind,
          // ex: gain.out est kind "audio" mais rôle "modulator"
          "data-role":
            p.role ?? (p.kind === "audio" ? "audioOut" : "modulator"),
        },
        text: { text: p.label ?? p.id },
      },
      args: { index: i },
    })),
  ];

  const height = Math.max(60, ports.length * 20);

  const shape = new shapes.standard.Rectangle({
    id,
    position: { x, y },
    size: { width: 160, height },
    attrs: {
      body: { fill: def.color, strokeWidth: 2 },
      label: { text: def.label, fill: "#fff" },
    },
    ports: { groups: portGroups, items: ports },
  });

  shape.addTo(graph);

  modulesById.set(id, {
    id,
    type,
    params: JSON.parse(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(def.params).map(([k, v]) => [k, v.default])
        )
      )
    ),
    shape,
  });

  emit("module-added", {
    id: shape.id,
    type,
    params: structuredClone(modulesById.get(id).params),
    position: shape.position()
  });


  // ------------------------
  // Alignement des labels
  // ------------------------
  const updatePortLabels = () => {
    const { width } = shape.size();
    const inPorts = shape.getGroupPorts("in");
    const outPorts = shape.getGroupPorts("out");

    inPorts.forEach((port, i) => {
      const yOffset = i;
      shape.portProp(port.id, "attrs/text/x", 0);
      shape.portProp(port.id, "attrs/text/y", yOffset);
    });

    outPorts.forEach((port, i) => {
      const yOffset = i;
      shape.portProp(port.id, "attrs/text/x", 50);
      shape.portProp(port.id, "attrs/text/y", yOffset);
    });

    emit("module-moved", {
      id: shape.id,
      position: shape.position()
    })

  };

  updatePortLabels();
  shape.on("change:position", () => { updatePortLabels(); });

  return id;
};

/* =========================
 * SELECT MODULE
 * ========================= */
const selectModule = (id) => {
  if (selectedModule.value) {
    selectedModule.value.shape.attr("body/class", "module-body");
  }

  const module = modulesById.get(id);
  if (!module) return;

  selectedModule.value = module;

  module.shape.attr("body/class", "module-body is-selected");

  emit("module-selected", module);
};

const clearGraph = () => {
  selectedModule.value = null
  modulesById.clear()
  graph.clear()
}


const exportPatch = () => {
  return {
    version: 1,
    view: {
      zoom: zoom.value,
      pan: paper.translate()
    },
    modules: [...modulesById.values()].map(m => ({
      id: m.id,
      type: m.type,
      position: m.shape.position(),
      params: JSON.parse(JSON.stringify(toRaw(m.params)))
    })),
    connections: graph.getLinks().map(l => ({
      from: l.get("source"),
      to: l.get("target")
    }))
  }
}


const importPatch = (patch) => {
  clearGraph()

  // restaurer la vue
  if (patch.view) {
    paper.scale(patch.view.zoom, patch.view.zoom)
    paper.translate(patch.view.pan.tx, patch.view.pan.ty)
    zoom.value = patch.view.zoom
  }

  // recréer les modules
  patch.modules.forEach(m => {
    addModule(m.type, m.position.x, m.position.y, m.id)

    const module = modulesById.get(m.id)
    if (module && m.params) {
      module.params = structuredClone(m.params)
    }
  })

  // recréer les connexions
  patch.connections.forEach(c => {
    const link = new shapes.standard.Link({
      source: c.from,
      target: c.to,
      attrs: { line: { stroke: "#333", strokeWidth: 2 } }
    })
    link.addTo(graph)
  })
}

const loadPatch = (patch) => {
  if (!patch) return

  // reset complet
  graph.clear()
  modulesById.clear()
  /*selectedModule.value = null
  emit("module-selected", null)
*/
  // restaurer vue
  if (patch.view) {
    const z = patch.view.zoom ?? 1
    zoom.value = z
    paper.scale(z, z)
    paper.translate(patch.view.pan?.tx ?? 0, patch.view.pan?.ty ?? 0)
  }

  // recréer les modules
  patch.modules.forEach((m) => {
    // addModule retourne maintenant la vraie shape
    const shape = addModule(m.type, m.position.x, m.position.y, m.id)
    if (!shape) return

    const module = modulesById.get(m.id)
    if (module && m.params) {
      // réinjecter les paramètres depuis le patch
      module.params = structuredClone(m.params)
    }
  })

  // recréer les connexions
  patch.connections.forEach((c) => {
    const link = new shapes.standard.Link({
      source: c.from,
      target: c.to,
      attrs: { line: { stroke: "#333", strokeWidth: 2 } },
    })
    link.addTo(graph)
  })

  // sélectionner le premier module pour afficher le panneau
  if (patch.modules.length > 0) {
    const firstId = patch.modules[0].id
    selectModule(firstId)
  }
}




/* =========================
 * LIFECYCLE
 * ========================= */

const onKeyDown = (e) => {
  if (e.key !== "Delete") return;

  // ne pas supprimer un module pendant l'édition d'un champ texte
  const t = e.target;
  if (
    t &&
    (t.tagName === "INPUT" ||
      t.tagName === "TEXTAREA" ||
      t.tagName === "SELECT" ||
      t.isContentEditable)
  ) {
    return;
  }

  // ignorer si ce paper est masqué (onglet inactif : voice/main/super)
  // sinon la suppression toucherait aussi les sélections des autres patchs
  if (!paperEl.value || paperEl.value.offsetParent === null) return;

  if (!selectedModule.value) return;

  selectedModule.value.shape.remove();
  modulesById.delete(selectedModule.value.id);
  emit("module-removed", selectedModule.value);
  selectedModule.value = null;
};

onMounted(() => {
  graph = new dia.Graph({}, { cellNamespace: shapes });

  paper = new dia.Paper({
    el: paperEl.value,
    model: graph,
    width: "100%",
    height: 400,
    gridSize: 10,
    drawGrid: true,
    background: { color: "#F5F5F5" },
    cellViewNamespace: shapes,
    defaultLink: () =>
      new shapes.standard.Link({
        attrs: { line: { stroke: "#333", strokeWidth: 2 } },
      }),
    validateConnection: (srcView, srcMagnet, tgtView, tgtMagnet) => {
      if (!srcMagnet || !tgtMagnet) return false;
      if (srcView === tgtView) return false;

      const sKind = srcMagnet.getAttribute("data-kind");
      const tKind = tgtMagnet.getAttribute("data-kind");
      const sRole = srcMagnet.getAttribute("data-role");
      const tRole = tgtMagnet.getAttribute("data-role");

      if (!sKind || !tKind || !sRole || !tRole) return false;

      /* =========================
       * CHAÎNE AUDIO (générique)
       *
       * Toute entrée audioIn accepte les sources de type audio,
       * quel que soit leur rôle : "audioOut" (voice, filtre...)
       * ou "modulator" (gain.out sert aussi de sortie audio).
       * ========================= */
      if (sKind === "audio" && tKind === "audio") {
        return (
          tRole === "audioIn" &&
          (sRole === "audioOut" || sRole === "modulator")
        );
      }

      /* =========================
       * MODULATION (RÈGLE GÉNÉRALISÉE)
       *
       * Toute sortie "modulator" (envelope, constant, gain...)
       * OU "audioOut" (signal brut : FM / AM)
       * peut moduler une entrée "modulatable"
       * (frequency, detune, gain, threshold...).
       * ========================= */
      if (
        tRole === "modulatable" &&
        (sRole === "modulator" || sRole === "audioOut")
      ) {
        return true;
      }

      return false;
    },
  });

  // click sur module
  paper.on("cell:pointerclick", (view) => {
    if (modulesById.has(view.model.id)) selectModule(view.model.id);
  });

  paper.on("blank:pointerdown", (evt) => {
    if (!evt.ctrlKey) return;

    evt.preventDefault();
    evt.stopPropagation();

    isPanning = true;
    panStart = { x: evt.clientX, y: evt.clientY };
    panOrigin = paper.translate();

    paper.el.style.cursor = "grabbing";
  });

  paper.on("blank:pointermove", (evt) => {
    if (!isPanning) return;

    evt.preventDefault();

    const scale = paper.scale().sx;

    const dx = (evt.clientX - panStart.x) / scale;
    const dy = (evt.clientY - panStart.y) / scale;

    paper.translate(panOrigin.tx + dx, panOrigin.ty + dy);
  });

  paper.on("blank:pointerup", () => {
    if (!isPanning) return;

    isPanning = false;
    paper.el.style.cursor = "default";
  });

  // connection créée
  paper.on("link:connect", (linkView) => {
    const link = linkView.model;
    emit("connection-added", {
      from: link.get("source"),
      to: link.get("target"),
    });
  });

  // dès qu’un lien change de target (ou est abandonné)
  paper.on("link:pointerup", (linkView, evt) => {
    const link = linkView.model;
    const source = link.get("source");
    const target = link.get("target");

    // si la connexion n'est pas complète ou invalide → supprimer
    if (!source.id || !target.id) {
      link.remove();
      return;
    }
  });

  // clic droit sur une connexion → suppression
  paper.on("link:contextmenu", (linkView, evt) => {
    evt.preventDefault();
    evt.stopPropagation();

    const link = linkView.model;
    const source = link.get("source");
    const target = link.get("target");

    // complet uniquement (les liens en cours de tirage partent déjà)
    if (!source.id || !target.id) return;

    link.remove();
    emit("connection-removed", { from: source, to: target });
  });

  // suppression module
  window.addEventListener("keydown", onKeyDown);

  // hauteur responsive
  if (props.fillHeight && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          paper?.setDimensions(width, Math.max(200, height));
        }
      }
    });
    resizeObserver.observe(paperEl.value);
  }

  paperEl.value.addEventListener(
    "wheel",
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = paperEl.value.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const nextZoom =
        e.deltaY < 0
          ? Math.min(ZOOM_MAX, zoom.value + ZOOM_STEP)
          : Math.max(ZOOM_MIN, zoom.value - ZOOM_STEP);
      zoomAtPoint(nextZoom, cx, cy);
    },
    { passive: false }
  );
});

onBeforeUnmount(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  window.removeEventListener("keydown", onKeyDown);
  paper?.remove();
  graph?.clear();
});

defineExpose({
  addModule,
  modulesById,
  exportPatch,
  importPatch,
  loadPatch
})

</script>


<template>
  <div class="paper-container" :class="{ fill: fillHeight }">
    <div class="zoom-controls">
      <button @click="zoomOut">−</button>
      <span>{{ Math.round(zoom * 100) }}%</span>
      <button @click="zoomIn">+</button>
    </div>
    <div ref="paperEl" class="paper" :class="{ fill: fillHeight }"></div>
  </div>
</template>

<style scoped>
.paper-container {
  display: flex;
  flex-direction: column;
}

.paper-container.fill {
  height: 100%;
}

.zoom-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
}

.zoom-controls button {
  width: 24px;
  height: 24px;
  border: 1px solid #ccc;
  background: white;
  border-radius: 4px;
  cursor: pointer;
}

.paper {
  width: 100%;
  height: 400px;
  border: 1px solid #ddd;
}

/* les connexions sont supprimables au clic droit */
.paper :deep(.joint-link) {
  cursor: pointer;
}

.paper.fill {
  flex: 1;
  min-height: 300px;
}
</style>
