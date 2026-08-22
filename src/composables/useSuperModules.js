// composables/useSuperModules.js
//
// Registre global des "super-modules" : modules composites créés à partir
// d'un graphe interne (modules + connexions) avec une interface exposée
// (ports d'entrée/sortie définis par les nœuds super.in / super.out).
//
// Format d'une définition persistée :
// {
//   type: "supervoice",            // id unique utilisé comme type de module
//   label: "SuperVoice",           // nom affiché
//   color: "#8E44AD",
//   version: 1,
//   savedAt: ...,
//   graph: {                       // graphe interne (même forme qu'un patch)
//     modules: [...],              // inclut les nœuds super.in / super.out
//     connections: [...]
//   },
//   inputs:  [ { portId, label, moduleId } ],   // moduleId = nœud super.in
//   outputs: [ { portId, label, moduleId } ],   // moduleId = nœud super.out
//   params:  { <flatKey>: { ...paramDef } },    // cumul des params internes
//   paramMap: { <flatKey>: { moduleId, key } }  // routage vers le module interne
// }

import { useModuleCatalog } from "./useModuleCatalog";

const STORAGE_KEY = "modular-super-modules";

/* =========================================================
 * État singleton (partagé entre tous les composants)
 * ========================================================= */

const registry = {}; // type -> définition
let initialized = false;

const { registerModuleType, unregisterModuleType, getModuleByType } =
  useModuleCatalog();

/* =========================================================
 * Persistance
 * ========================================================= */

function readStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeStorage(all) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

/* =========================================================
 * Helpers
 * ========================================================= */

function deepClone(value) {
  // JSON et non structuredClone : les définitions du catalogue sont des
  // proxys réactifs Vue, que structuredClone ne sait pas cloner.
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

export function slugify(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Génère un id de port unique dans la liste existante :
 * "in" -> "in_2", "in_3"...
 */
function uniquePortId(base, taken) {
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}_${n++}`;
  }
  taken.add(id);
  return id;
}

/**
 * Cumule les paramètres de tous les modules internes.
 * - clé simple si unique ("detune", "gain")
 * - préfixée par le label du module en cas de collision ("voice.detune")
 * - suffixée (_2, _3...) si toujours en collision ("gain.gain_2")
 * Les valeurs courantes du canvas deviennent les défauts du super-module.
 */
function aggregateParams(graphModules) {
  const params = {};
  const paramMap = {};
  const usage = new Map(); // clé brute -> nombre d'occurrences

  for (const m of graphModules) {
    const def = getModuleByType(m.type);
    if (!def || def.category === "interface") continue;

    for (const key of Object.keys(def.params ?? {})) {
      usage.set(key, (usage.get(key) ?? 0) + 1);
    }
  }

  for (const m of graphModules) {
    const def = getModuleByType(m.type);
    if (!def || def.category === "interface") continue;

    const slug = slugify(def.label);

    for (const [key, pdef] of Object.entries(def.params ?? {})) {
      let flat = key;
      if ((usage.get(key) ?? 0) > 1) flat = `${slug}.${key}`;

      while (flat in params) flat = `${flat}_2`;

      // défaut = valeur réglée sur le canvas au moment de la sauvegarde
      const current = m.params?.[key];
      const merged = deepClone(pdef);
      merged.default =
        current !== undefined ? deepClone(current) : deepClone(pdef.default);

      params[flat] = merged;
      paramMap[flat] = { moduleId: m.id, key };
    }
  }

  return { params, paramMap };
}

/**
 * Construit la définition complète du super-module
 * à partir du graphe dessiné dans l'éditeur.
 */
function deriveDefinition({ name, color, graph }) {
  const modules = deepClone(graph.modules) ?? [];
  const connections = deepClone(graph.connections) ?? [];

  // --- validation ---
  if (!modules.length) {
    throw new Error("Le super-module est vide : ajoutez au moins un module.");
  }

  const illegal = modules.filter(
    (m) => m.type === "input" || m.type === "destination"
  );
  if (illegal.length) {
    throw new Error(
      "Utilisez uniquement des nœuds Super In / Super Out comme interface " +
        "(pas les modules Input / Output standards)."
    );
  }

  // --- interface : entrées / sorties exposées ---
  const insTaken = new Set();
  const outsTaken = new Set();
  const inputs = [];
  const outputs = [];

  for (const m of modules) {
    if (m.type === "super.in") {
      const base = String(m.params?.name ?? "").trim() || "in";
      const portId = uniquePortId(slugify(base), insTaken);
      inputs.push({ portId, label: base, moduleId: m.id });
    } else if (m.type === "super.out") {
      const base = String(m.params?.name ?? "").trim() || "out";
      const portId = uniquePortId(slugify(base), outsTaken);
      outputs.push({ portId, label: base, moduleId: m.id });
    }
  }

  if (!outputs.length && !inputs.length) {
    throw new Error(
      "Ajoutez au moins un nœud Super In ou Super Out pour définir l'interface."
    );
  }

  // --- paramètres cumulés ---
  const { params, paramMap } = aggregateParams(modules);

  return {
    version: 1,
    savedAt: Date.now(),
    graph: { modules, connections },
    inputs,
    outputs,
    params,
    paramMap,
  };
}

/* =========================================================
 * Enregistrement dans le catalogue
 * ========================================================= */

export function toCatalogDef(sd) {
  return {
    label: sd.label,
    color: sd.color,
    category: "super",
    singleton: false,
    isSuper: true,

    ports: {
      inputs: sd.inputs.map((p) => ({
        id: p.portId,
        label: p.label ?? p.portId,
        kind: "audio",
        role: "audioIn",
        multiple: true,
      })),
      outputs: sd.outputs.map((p) => ({
        id: p.portId,
        label: p.label ?? p.portId,
        kind: "audio",
        role: "audioOut",
        multiple: true,
      })),
    },

    params: sd.params,
    paramMap: sd.paramMap,
    superDef: sd, // référence complète (graphe interne) pour le moteur audio
  };
}

function register(def) {
  registry[def.type] = def;
  registerModuleType(def.type, toCatalogDef(def));
}

/* =========================================================
 * Chargement initial
 * ========================================================= */

function ensureLoaded() {
  if (initialized) return;
  initialized = true;

  const all = readStorage();
  for (const [type, stored] of Object.entries(all)) {
    // stockage = définition sans le champ "type" redondant
    register({ type, ...stored });
  }
}

/* =========================================================
 * API publique
 * ========================================================= */

export function useSuperModules() {
  ensureLoaded();

  /** Liste des définitions enregistrées */
  const list = () => Object.values(registry);

  /** Définition par type (ou null) */
  const get = (type) => registry[type] ?? null;

  /**
   * Crée ou met à jour un super-module depuis le graphe courant.
   * @param {object} opts
   * @param {string} opts.name         nom affiché (ex: "SuperVoice")
   * @param {string} opts.color        couleur du module
   * @param {object} opts.graph        { modules, connections } du canvas
   * @param {string} [opts.typeToUpdate] type existant lors d'une édition
   * @returns {object} la définition enregistrée
   */
  function saveFromGraph({ name, color, graph, typeToUpdate }) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) throw new Error("Le super-module doit avoir un nom.");

    let type = slugify(trimmed);
    if (!type) throw new Error("Nom de super-module invalide.");

    // unicité du type (sauf si on met à jour ce type précisément)
    if (!typeToUpdate || type !== typeToUpdate) {
      const base = type;
      let n = 2;
      while (registry[type]) type = `${base}-${n++}`;
    }

    const derived = deriveDefinition({ name: trimmed, color, graph });

    const def = {
      type,
      label: trimmed,
      color: color || "#8E44AD",
      ...derived,
    };

    register(def);

    // persistance
    const all = readStorage();
    if (typeToUpdate && typeToUpdate !== type) delete all[typeToUpdate];
    all[type] = { ...def };
    delete all[type].type; // évite la redondance au stockage
    writeStorage(all);

    return def;
  }

  /** Supprime un super-module (catalogue + stockage). */
  function remove(type) {
    if (!registry[type]) return false;
    delete registry[type];
    unregisterModuleType(type);

    const all = readStorage();
    delete all[type];
    writeStorage(all);
    return true;
  }

  return { list, get, saveFromGraph, remove };
}
