<script setup>
import { ref, computed, nextTick, onMounted, onBeforeUnmount, toRaw } from "vue";
import { dia, shapes } from "@joint/core";
import { useModuleCatalog } from "../composables/useModuleCatalog";

const emit = defineEmits([
  "module-added",
  "module-selected",
  "module-removed",
  "module-moved",
  "connection-added",
  "connection-removed",
  "module-param-copied",
]);

const props = defineProps({
  // étirer le canvas sur la hauteur du conteneur parent
  fillHeight: { type: Boolean, default: false },
  // catégories à masquer dans le menu contextuel (ex: ["interface"])
  excludeCategories: { type: Array, default: () => [] },
});

const paperEl = ref(null);
let graph;
let paper;
let resizeObserver = null;

let onDocKeyDown;
let onDocPointerDown;
let onPaperContextMenu;

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
const { getModuleByType, getCatalog, getModuleTypes } = useModuleCatalog();

/* =========================
 * CONTEXT MENU (clic droit)
 * ========================= */
const contextMenu = ref(null); // { x, y, graphX, graphY } | null
const menuRef = ref(null);

const CATEGORY_LABELS = {
  source: 'Sources',
  utility: 'Utility',
  time: 'Time',
  filter: 'Filters',
  dynamics: 'Dynamics',
  effect: 'Effects',
  control: 'Control',
  routing: 'Routing',
  spatial: 'Spatial',
  input: 'I/O',
  output: 'I/O',
  interface: 'Interface',
  super: 'Super Modules',
};

const menuGroups = computed(() => {
  const catalog = getCatalog();
  const byCategory = new Map();

  for (const type of getModuleTypes()) {
    const def = catalog[type];
    if (!def) continue;
    if (props.excludeCategories.includes(def.category)) continue;

    const category = def.category ?? 'other';
    if (!byCategory.has(category)) byCategory.set(category, []);
    byCategory.get(category).push({
      type,
      label: def.label,
      color: def.color,
    });
  }

  return [...byCategory.entries()].map(([category, modules]) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    modules,
  }));
});

const closeContextMenu = () => {
  contextMenu.value = null;
};

const openContextMenu = async (evt) => {
  evt.preventDefault();
  evt.stopPropagation();

  const rect = paperEl.value.getBoundingClientRect();
  let x = evt.clientX - rect.left;
  let y = evt.clientY - rect.top;

  const graphPoint = paper.clientToLocalPoint({ x: evt.clientX, y: evt.clientY });
  contextMenu.value = { x, y, graphX: graphPoint.x, graphY: graphPoint.y };

  // garder le menu dans les limites du paper
  await nextTick();
  const menu = menuRef.value;
  if (!menu) return;
  const { width, height } = paperEl.value.getBoundingClientRect();
  if (x + menu.offsetWidth > width) x = Math.max(0, width - menu.offsetWidth);
  if (y + menu.offsetHeight > height) y = Math.max(0, height - menu.offsetHeight);
  contextMenu.value.x = x;
  contextMenu.value.y = y;
};

const addFromContextMenu = (type) => {
  const menu = contextMenu.value;
  if (!menu) return;
  addModule(type, menu.graphX, menu.graphY);
  closeContextMenu();
};

/* =========================
 * COLLISION DETECTION
 * ========================= */
const MODULE_PADDING = 10;

const checkCollision = (rect1, rect2) => {
  return !(
    rect1.x + rect1.width + MODULE_PADDING <= rect2.x ||
    rect2.x + rect2.width + MODULE_PADDING <= rect1.x ||
    rect1.y + rect1.height + MODULE_PADDING <= rect2.y ||
    rect2.y + rect2.height + MODULE_PADDING <= rect1.y
  );
};

const findFreePosition = (width, height, preferredX, preferredY) => {
  const step = 20;
  const maxRings = 20;

  const isFree = (x, y) => {
    const testRect = { x, y, width, height };
    for (const [, mod] of modulesById) {
      const pos = mod.shape.position();
      const size = mod.shape.size();
      const otherRect = { x: pos.x, y: pos.y, width: size.width, height: size.height };
      if (checkCollision(testRect, otherRect)) return false;
    }
    return true;
  };

  if (isFree(preferredX, preferredY)) {
    return { x: preferredX, y: preferredY };
  }

  for (let ring = 1; ring <= maxRings; ring++) {
    const d = ring * step;

    const positions = [];
    for (let dx = -d; dx <= d; dx += step) {
      positions.push({ x: preferredX + dx, y: preferredY - d });
      positions.push({ x: preferredX + dx, y: preferredY + d });
    }
    for (let dy = -d + step; dy < d; dy += step) {
      positions.push({ x: preferredX - d, y: preferredY + dy });
      positions.push({ x: preferredX + d, y: preferredY + dy });
    }

    for (const pos of positions) {
      if (isFree(pos.x, pos.y)) return pos;
    }
  }

  return { x: preferredX, y: preferredY };
};

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
 * COLLISION PREVENTION (drag)
 * ========================= */
const dragOffset = { x: 0, y: 0 }; // position de départ du module en cours de drag
const lastFreePos = { x: 0, y: 0 }; // dernière position libre (sans collision) pendant le drag

// mode "copie de paramètres" : drag sur le module sélectionné = copie au lieu de déplacer
let copyDrag = false;
let copyDragged = false;
let copyTargetId = null;

const moduleAtLocal = (x, y) => {
  for (const [, m] of modulesById) {
    if (m.id === selectedModule.value?.id) continue;
    const p = m.shape.position();
    const s = m.shape.size();
    if (x >= p.x && x <= p.x + s.width && y >= p.y && y <= p.y + s.height) return m;
  }
  return null;
};

const setCopyTarget = (target) => {
  if (copyTargetId === (target?.id ?? null)) return;
  if (copyTargetId) {
    const prev = modulesById.get(copyTargetId);
    if (prev) prev.shape.attr("body/class", "module-body");
  }
  copyTargetId = target?.id ?? null;
  if (target) target.shape.attr("body/class", "module-body is-copy-target");
};

const cancelCopyDrag = () => {
  copyDrag = false;
  if (copyTargetId) {
    const t = modulesById.get(copyTargetId);
    if (t) t.shape.attr("body/class", "module-body");
  }
  copyTargetId = null;
  if (selectedModule.value) {
    selectedModule.value.shape.attr("body/class", "module-body is-selected");
  }
};

const wouldCollide = (shape, x, y) => {
  const size = shape.size();
  const testRect = { x, y, width: size.width, height: size.height };

  for (const [, mod] of modulesById) {
    if (mod.shape === shape) continue;
    const pos = mod.shape.position();
    const otherRect = { x: pos.x, y: pos.y, width: mod.shape.size().width, height: mod.shape.size().height };
    if (checkCollision(testRect, otherRect)) return true;
  }
  return false;
};

// retourne la position la plus proche (sans collision) d'une position demandée
const clampToFree = (shape, x, y) => {
  if (!wouldCollide(shape, x, y)) {
    return { x, y };
  }

  // dernière position valable avant la collision (pas la position de départ)
  if (!wouldCollide(shape, lastFreePos.x, lastFreePos.y)) {
    return { x: lastFreePos.x, y: lastFreePos.y };
  }

  // sinon recherche une position libre autour de la position souhaitée
  const size = shape.size();
  const freePos = findFreePosition(size.width, size.height, x, y);
  return freePos;
};

/* =========================
 * ADD MODULE
 * ========================= */
const addModule = (type, x = 100, y = 100, forcedId = null, initialLabel = null) => {
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

  const freePos = findFreePosition(160, height, x, y);

  const shape = new shapes.standard.Rectangle({
    id,
    position: freePos,
    size: { width: 160, height },
    attrs: {
      body: { fill: def.color, strokeWidth: 2 },
      label: { text: initialLabel || def.label, fill: "#fff" },
    },
    ports: { groups: portGroups, items: ports },
  });

  shape.addTo(graph);

  modulesById.set(id, {
    id,
    type,
    label: initialLabel || "",
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
    label: initialLabel || "",
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
  shape.on("change:position", () => {
    updatePortLabels();
  });

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

const deselectModule = () => {
  if (selectedModule.value) {
    selectedModule.value.shape.attr("body/class", "module-body");
    selectedModule.value = null;
    emit("module-selected", null);
  }
};

const setModuleLabel = (id, label) => {
  const module = modulesById.get(id);
  if (!module) return;
  module.label = label || "";
  const def = getModuleByType(module.type);
  module.shape.attr("label/text", module.label || (def ? def.label : ""));
};

// synchronise le paramètre d'un module (source de vérité : la donnée patch)
const setModuleParam = (id, key, value) => {
  const module = modulesById.get(id);
  if (!module) return;
  module.params[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
};

// remplace tous les paramètres d'un module (utilisé après une copie)
const setModuleParams = (id, params) => {
  const module = modulesById.get(id);
  if (!module) return;
  module.params = structuredClone(params);
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
      label: m.label || "",
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
    addModule(m.type, m.position.x, m.position.y, m.id, m.label)

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
    const shape = addModule(m.type, m.position.x, m.position.y, m.id, m.label)
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
    height: 700,
    gridSize: 10,
    drawGrid: true,
    background: { color: "#F5F5F5" },
    cellViewNamespace: shapes,
    preventContextMenu: true,
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
       * MODULATION SUR ENTRÉE DE SUPER-MODULE
       *
       * Une enveloppe/CV (sortie "modulator") branchée sur une entrée
       * audio d'un super-module module le gain d'entrée (volume du signal
       * qui entre dans le super-module). Ce n'est possible que pour les
       * entrées audio des super-modules : les ports intègrent un gain
       * de bordure modulable, contrairement aux autres entrées audio.
       * ========================= */
      if (
        sRole === "modulator" &&
        tRole === "audioIn" &&
        modulesById.get(tgtView.model.id)?.type &&
        getModuleByType(modulesById.get(tgtView.model.id).type)?.isSuper
      ) {
        return true;
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

  // clic sur fond vide → désélection du module courant
  paper.on("blank:pointerclick", () => {
    deselectModule();
  });

  // clic droit sur fond vide → menu d'ajout de modules
  paper.on("blank:contextmenu", openContextMenu);
  // clic droit sur un module → même menu (les liens gardent leur suppression)
  paper.on("element:contextmenu", openContextMenu);

  // interdit le menu contextuel natif dans toute la zone du paper
  onPaperContextMenu = (e) => e.preventDefault();
  paperEl.value.parentElement.addEventListener(
    "contextmenu",
    onPaperContextMenu
  );

  // début du drag : mémoriser la position de départ
  paper.on("cell:pointerdown", (cellView) => {
    const model = cellView.model;
    if (!modulesById.has(model.id)) return;

    copyDrag = false;
    copyDragged = false;
    copyTargetId = null;

    const pos = model.position();
    dragOffset.x = pos.x;
    dragOffset.y = pos.y;
    lastFreePos.x = pos.x;
    lastFreePos.y = pos.y;

    // module sélectionné → drag = copie de paramètres, pas déplacement
    if (selectedModule.value && selectedModule.value.id === model.id) {
      copyDrag = true;
    }
  });

  // pendant le drag : interdire les collisions (retour à la position libre)
  paper.on("cell:pointermove", (cellView, evt, x, y) => {
    const model = cellView.model;
    if (!modulesById.has(model.id)) return;
    const mod = modulesById.get(model.id);

    // mode copie : le module sélectionné ne bouge pas, on repère la cible
    if (copyDrag && selectedModule.value?.id === mod.id) {
      copyDragged = true;
      const pos = model.position();
      if (pos.x !== dragOffset.x || pos.y !== dragOffset.y) {
        model.position(dragOffset.x, dragOffset.y);
      }
      const target = moduleAtLocal(x, y);
      setCopyTarget(target && target.type === mod.type ? target : null);
      return;
    }

    const pos = model.position();
    if (wouldCollide(model, pos.x, pos.y)) {
      const clamped = clampToFree(model, pos.x, pos.y);
      model.position(clamped.x, clamped.y);
    } else {
      // position restée libre → nouvelle référence valable pour la suite
      lastFreePos.x = pos.x;
      lastFreePos.y = pos.y;
    }
  });

  // drop en mode copie : transférer les paramètres vers le module cible
  paper.on("cell:pointerup", (cellView, evt, x, y) => {
    if (!copyDrag || !copyDragged) {
      cancelCopyDrag();
      return;
    }
    const model = cellView.model;
    if (!modulesById.has(model.id)) return;
    const mod = modulesById.get(model.id);
    const target = moduleAtLocal(x, y);
    const canCopy =
      target &&
      target.type === mod.type &&
      target.id !== mod.id;

    cancelCopyDrag();
    if (selectedModule.value?.id === mod.id) {
      model.attr("body/class", "module-body is-selected");
    }

    if (canCopy) {
      emit("module-param-copied", { sourceId: mod.id, targetId: target.id });

      target.shape.attr("body/class", "module-body is-copy-flash");
      setTimeout(() => {
        const m = modulesById.get(target.id);
        if (m) m.shape.attr("body/class", "module-body");
      }, 400);
    }
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

  // fermeture du menu contextuel
  onDocPointerDown = (evt) => {
    if (!contextMenu.value) return;
    if (menuRef.value && menuRef.value.contains(evt.target)) return;
    closeContextMenu();
  };
  onDocKeyDown = (e) => {
    if (e.key === "Escape") closeContextMenu();
  };
  document.addEventListener("pointerdown", onDocPointerDown, true);
  document.addEventListener("keydown", onDocKeyDown);

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
  document.removeEventListener("keydown", onDocKeyDown);
  document.removeEventListener("pointerdown", onDocPointerDown, true);
  paperEl.value?.parentElement?.removeEventListener(
    "contextmenu",
    onPaperContextMenu
  );
  paper?.remove();
  graph?.clear();
});

defineExpose({
  addModule,
  modulesById,
  exportPatch,
  importPatch,
  loadPatch,
  clearGraph,
  setModuleLabel,
  setModuleParam,
  setModuleParams
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

    <div
      v-if="contextMenu"
      ref="menuRef"
      class="context-menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <div v-for="group in menuGroups" :key="group.category" class="ctx-group">
        <div class="ctx-category">{{ group.label }}</div>
        <button
          v-for="mod in group.modules"
          :key="mod.type"
          class="ctx-item"
          @click="addFromContextMenu(mod.type)"
        >
          <span class="ctx-dot" :style="{ backgroundColor: mod.color }"></span>
          {{ mod.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.paper-container {
  display: flex;
  flex-direction: column;
  position: relative;
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
  height: 700px;
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

/* =========================
 * CONTEXT MENU
 * ========================= */
.context-menu {
  position: absolute;
  z-index: 50;
  min-width: 180px;
  max-height: 70%;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #ccc;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  padding: 4px 0;
  font-size: 13px;
}

.ctx-group + .ctx-group {
  border-top: 1px solid #eee;
  margin-top: 4px;
  padding-top: 4px;
}

.ctx-category {
  padding: 2px 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #666;
  background: #fafafa;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 5px 10px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.ctx-item:hover {
  background: #eef4ff;
}

.ctx-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex: 0 0 auto;
}
</style>
