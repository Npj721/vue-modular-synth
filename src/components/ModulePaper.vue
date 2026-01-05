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
        text: { text: p.label ?? p.id, y: i * 20 - 10 },
      },
    })),
    ...def.ports.outputs.map((p, i) => ({
      id: `out:${p.id}`,
      group: "out",
      attrs: {
        circle: { "data-port": p.id, "data-kind": p.kind },
        text: { text: p.label ?? p.id, y: i * 20 - 10 },
      },
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
    params: Object.fromEntries(Object.entries(def.params).map(([k, v]) => [k, v.default])),
    shape,
  });

  // Mettre à jour la position des labels quand le module bouge
  shape.on("change:position", () => {
    const pos = shape.position();
    shape.getPorts().forEach((port, idx) => {
      const textAttr = shape.portProp(port.id, "attrs/text");
      if (!textAttr) return;
      // x position à gauche ou droite du rectangle
      const xOffset = port.group === "in" ? -10 : shape.size().width + 10;
      const yOffset = 15 + idx * 20; // alignement vertical
      shape.portProp(port.id, "attrs/text/x", xOffset);
      shape.portProp(port.id, "attrs/text/y", yOffset);
    });
  });

  return id;
};

/* =========================
 * SELECT MODULE
 * ========================= */
const selectModule = (id) => {
  if (selectedModule.value) selectedModule.value.shape.attr("body/stroke", null);
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
      new shapes.standard.Link({ attrs: { line: { stroke: "#333", strokeWidth: 2 } } }),
    validateConnection: (srcView, srcMagnet, tgtView, tgtMagnet) => {
      if (!srcMagnet || !tgtMagnet) return false;
      const sKind = srcMagnet.getAttribute("data-kind");
      const tKind = tgtMagnet.getAttribute("data-kind");
      if (!sKind || !tKind) return false;
      if (sKind === "param" && tKind === "audio") return false;
      return true;
    },
  });

  paper.on("cell:pointerclick", (view) => {
    if (modulesById.has(view.model.id)) selectModule(view.model.id);
  });

  paper.on("link:connect", (linkView) => {
    const link = linkView.model;
    emit("connection-added", { from: link.get("source"), to: link.get("target") });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Delete" && selectedModule.value) {
      selectedModule.value.shape.remove();
      modulesById.delete(selectedModule.value.id);
      emit("module-removed", selectedModule.value);
      selectedModule.value = null;
    }
  });
});

onBeforeUnmount(() => {
  paper?.remove();
  graph?.clear();
});

defineExpose({ addModule, modulesById });
</script>

<template>
  <div ref="paperEl" class="paper"></div>
</template>

<style scoped>
.paper {
  width: 100%;
  height: 400px;
  border: 1px solid #ddd;
}
</style>
