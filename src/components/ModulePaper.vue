<script setup>
import { ref, onMounted, onBeforeUnmount } from "vue";
import { dia, shapes } from "@joint/core";
import { useModuleCatalog } from "../composables/useModuleCatalog";

const emit = defineEmits([
  "module-selected",
  "module-removed",
  "connection-added",
  "connection-removed",
]);

const paperEl = ref(null);
let graph;
let paper;

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
const addModule = (type, x = 100, y = 100) => {
  const def = getModuleByType(type);
  if (!def) return;

  const id = crypto.randomUUID();

  const ports = [
    ...def.ports.inputs.map((p, i) => ({
      id: `in:${p.id}`,
      group: "in",
      attrs: {
        circle: { "data-port": p.id, "data-kind": p.kind },
        text: { text: p.label ?? p.id },
      },
      args: { index: i },
    })),
    ...def.ports.outputs.map((p, i) => ({
      id: `out:${p.id}`,
      group: "out",
      attrs: {
        circle: { "data-port": p.id, "data-kind": p.kind },
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
    params: Object.fromEntries(
      Object.entries(def.params).map(([k, v]) => [k, v.default])
    ),
    shape,
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
  };

  updatePortLabels();
  shape.on("change:position", updatePortLabels);

  return id;
};

/* =========================
 * SELECT MODULE
 * ========================= */
const selectModule = (id) => {
  if (selectedModule.value)
    selectedModule.value.shape.attr("body/stroke", null);
  const module = modulesById.get(id);
  if (!module) return;
  selectedModule.value = module;
  module.shape.attr("body/stroke", "#FF0000");
  emit("module-selected", module);
};

/* =========================
 * LIFECYCLE
 * ========================= */
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
      const sKind = srcMagnet.getAttribute("data-kind");
      const tKind = tgtMagnet.getAttribute("data-kind");
      if (!sKind || !tKind) return false;
      if (sKind === "param" && tKind === "audio") return false;
      return true;
    },
  });

  // click sur module
  paper.on("cell:pointerclick", (view) => {
    if (modulesById.has(view.model.id)) selectModule(view.model.id);
  });

  // connection créée
  paper.on("link:connect", (linkView) => {
    const link = linkView.model;
    emit("connection-added", {
      from: link.get("source"),
      to: link.get("target"),
    });
  });

  // suppression module
  window.addEventListener("keydown", (e) => {
    if (e.key === "Delete" && selectedModule.value) {
      selectedModule.value.shape.remove();
      modulesById.delete(selectedModule.value.id);
      emit("module-removed", selectedModule.value);
      selectedModule.value = null;
    }
  });

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
  paper?.remove();
  graph?.clear();
});

defineExpose({ addModule, modulesById });
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
.paper {
  width: 100%;
  height: 400px;
  border: 1px solid #ddd;
}
</style>
