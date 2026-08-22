// Smoke test : dérivation + enregistrement d'un super-module

// émulation localStorage (test hors navigateur)
const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
};

import { useSuperModules } from "../src/composables/useSuperModules.js";
import { useModuleCatalog } from "../src/composables/useModuleCatalog.js";

const { registerModuleType, getModuleByType } = useModuleCatalog();

// enregistrer les types utilisés par le graphe de test (normalement dans le catalogue)
const graph = {
  modules: [
    {
      id: "8a1e7e6a",
      type: "voice",
      params: { detune: -5, type: "sawtooth" },
      position: { x: 160, y: 220 },
    },
    {
      id: "1c0525e9",
      type: "gain",
      params: { gain: 0.8 },
      position: { x: 440, y: 220 },
    },
    {
      id: "in-boundary",
      type: "super.in",
      params: { name: "freq-in" },
      position: { x: 20, y: 100 },
    },
    {
      id: "out-boundary",
      type: "super.out",
      params: { name: "audio" },
      position: { x: 700, y: 220 },
    },
    {
      id: "7c3ec634",
      type: "envelope",
      params: {
        modulation: "relative",
        stages: {
          press: [{ from: 0, to: 1, duration: 0.05, curve: "exponential" }],
          release: [{ from: "current", to: 0, duration: 0.15, curve: "linear" }],
        },
      },
      position: { x: 150, y: 100 },
    },
  ],
  connections: [
    {
      from: { id: "8a1e7e6a", port: "out:out" },
      to: { id: "1c0525e9", port: "in:in" },
    },
    {
      from: { id: "1c0525e9", port: "out:out" },
      to: { id: "out-boundary", port: "in:in" },
    },
    {
      from: { id: "in-boundary", port: "out:out" },
      to: { id: "8a1e7e6a", port: "in:frequency" },
    },
    {
      from: { id: "7c3ec634", port: "out:out" },
      to: { id: "1c0525e9", port: "in:gain" },
    },
  ],
};

const { saveFromGraph, list, get } = useSuperModules();

const def = saveFromGraph({
  name: "SuperVoice",
  color: "#123456",
  graph,
});

console.log("== type:", def.type);
console.log("== inputs:", JSON.stringify(def.inputs));
console.log("== outputs:", JSON.stringify(def.outputs));
console.log("== param keys:", Object.keys(def.params).join(", "));
console.log("== paramMap:", JSON.stringify(def.paramMap));
console.log("== detune default:", def.params.detune.default, "(attendu -5)");
console.log("== gain default:", def.params.gain.default, "(attendu 0.8)");

const catDef = getModuleByType(def.type);
console.log("== catalogue ok:", !!catDef, "| isSuper:", catDef.isSuper);
console.log(
  "== ports catalogue:",
  JSON.stringify(catDef.ports.inputs),
  JSON.stringify(catDef.ports.outputs)
);

// collision : un deuxième gain -> clé namespacée
const graph2 = JSON.parse(JSON.stringify(graph));
graph2.modules.push({
  id: "second-gain",
  type: "gain",
  params: { gain: 0.5 },
  position: { x: 500, y: 300 },
});
graph2.connections.push({
  from: { id: "1c0525e9", port: "out:out" },
  to: { id: "second-gain", port: "in:in" },
});

const def2 = saveFromGraph({ name: "DoubleGain", color: "#654321", graph: graph2 });
console.log("\n== DoubleGain keys:", Object.keys(def2.params).join(", "));
console.log("== paramMap gain*:", JSON.stringify({
  gain: def2.paramMap.gain,
  gain_gain: def2.paramMap["gain.gain"] ?? null,
}));

console.log("\n== liste:", list().map((d) => d.type).join(", "));
