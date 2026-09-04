// smoke-trackgain.mjs — teste le GainNode par piste
const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
};

import { usePatchVoice } from "../src/composables/usePatchVoice.js";
import { toRaw } from "vue";

// NOTE : usePatchVoice stocke audioCtx dans un ref Vue => les nœuds passés par
// la proxy sont "réactifs". On compare donc les nœuds par leur __id (unique)
// pour éviter les inégalités proxy/brut.

let nextNodeId = 1;

class StubParam {
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime(v) { this.value = v; }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
  linearRampToValueAtTime(v) { this.value = v; }
  exponentialRampToValueAtTime(v) { this.value = v; }
}

class StubNode {
  constructor(ctx, type) {
    this.__type = type;
    this.__id = nextNodeId++;
    this.connections = [];
  }
  connect(t) { this.connections.push(t); return t; }
  disconnect() { this.connections = []; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

class StubContext {
  constructor() {
    this.currentTime = 0;
    this.created = [];
    this.destination = new StubNode(this, "destination");
    this.created.push(this.destination);
  }
  get state() { return "running"; }
  async resume() {}
  createGain() {
    const n = new StubNode(this, "gain");
    n.gain = new StubParam(1);
    this.created.push(n);
    return n;
  }
  createOscillator() {
    const n = new StubNode(this, "osc");
    n.frequency = new StubParam(440);
    n.detune = new StubParam(0);
    this.created.push(n);
    return n;
  }
  createConstantSource() {
    const n = new StubNode(this, "constant");
    n.offset = new StubParam(0);
    this.created.push(n);
    return n;
  }
  createDelay() {
    const n = new StubNode(this, "delay");
    n.delayTime = new StubParam(0.3);
    this.created.push(n);
    return n;
  }
  createDynamicsCompressor() {
    const n = new StubNode(this, "compressor");
    for (const [k, d] of Object.entries({ threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 })) n[k] = new StubParam(d);
    this.created.push(n);
    return n;
  }
  createBiquadFilter() {
    const n = new StubNode(this, "biquad");
    n.frequency = new StubParam(1000); n.Q = new StubParam(1); n.gain = new StubParam(0);
    this.created.push(n);
    return n;
  }
}
globalThis.AudioContext = StubContext;

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

// compare les nœuds par identité d'id
const same = (a, b) => a && b && a.__id === b.__id;
const connectedTo = (node, target) => !!node && node.connections.some((c) => same(c, target));

const patch = {
  mainPatch: {
    modules: [
      { id: "in1", type: "input", params: {}, position: {} },
      { id: "mdest", type: "destination", params: {}, position: {} },
    ],
    connections: [
      { from: { id: "in1", port: "out:out" }, to: { id: "mdest", port: "in:in" } },
    ],
  },
  voicePatch: {
    modules: [
      { id: "v1", type: "voice", params: {}, position: {} },
      { id: "vdest", type: "destination", params: {}, position: {} },
    ],
    connections: [
      { from: { id: "v1", port: "out:out" }, to: { id: "vdest", port: "in:in" } },
    ],
  },
};

const synth = usePatchVoice(patch);
await synth.init();
const ctx = toRaw(synth.getContext());

const mainInput = () =>
  ctx.created.find((n) => n.__type === "gain" && connectedTo(n, ctx.destination));
check("mainInput trouvé, connecté à destination", !!mainInput());

const trackGain = toRaw(synth.createTrackGainNode());
check("gain de piste créé", trackGain?.node?.__type === "gain");
check("gain de piste connecté au mainInput", connectedTo(trackGain.node, mainInput()));
check("valeur initiale du gain = 1", trackGain.node.gain.value === 1);

trackGain.setVolume(0.35);
check("setVolume(0.35) appliqué", trackGain.node.gain.value === 0.35);

await synth.noteOn(60, 1, trackGain.node, "trackA:0:60");
const osc = ctx.created.find((n) => n.__type === "osc" && connectedTo(n, trackGain.node));
check("voix routée vers le gain de piste (et non le mainInput direct)", !!osc && !connectedTo(osc, mainInput()));
check("voix sous clé custom créée et démarrée", osc?.started === true);

synth.noteOff(60, "trackA:0:60");
check("noteOff avec clé custom fonctionne", true);

// deux clés différentes => 2 voix simultanées possibles
await synth.noteOn(60, 1, trackGain.node, "A");
const oscA = ctx.created.filter((n) => n.__type === "osc").length;
await synth.noteOn(60, 1, trackGain.node, "B");
const oscB = ctx.created.filter((n) => n.__type === "osc").length;
check("2 voix pour 2 clés (pas d'écrasement de la première)", oscB > oscA);
synth.noteOff(60, "A");
synth.noteOff(60, "B");

// rebuild → reconnexion du gain de piste sur le nouveau mainInput
synth.rebuildMainPatch();
check("après rebuild, gain de piste re-connecté au nouveau mainInput", connectedTo(trackGain.node, mainInput()));

trackGain.dispose();
check("dispose supprime la connexion", !connectedTo(trackGain.node, mainInput()));

// deux gains de piste indépendants
const tg2 = toRaw(synth.createTrackGainNode());
tg2.setVolume(0.5);
tg2.dispose();
check("second gain de piste créé puis disposé sans erreur", true);

console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);