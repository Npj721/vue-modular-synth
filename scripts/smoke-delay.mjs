// smoke-delay.mjs — teste la propriété "delay" des modules osc/voice
//  1. l'oscillateur démarre à now + delay
//  2. l'enveloppe ciblant le gain alimenté par l'osc commence à now + delay
//  3. le release n'est PAS décalé
//  4. deux osc vers le même gain : on garde le PLUS PETIT delay (0 ici)
//  5. patch principal (deferStart) : démarrage à startMainPatch + delay
const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
};

import { usePatchVoice } from "../src/composables/usePatchVoice.js";
import { toRaw } from "vue";

// NOTE : usePatchVoice stocke audioCtx dans un ref Vue => on compare les nœuds
// par __id pour éviter les inégalités proxy/brut.

let nextNodeId = 1;

class StubParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) { this.events.push(["set", v, t]); this.value = v; }
  linearRampToValueAtTime(v, t) { this.events.push(["linRamp", v, t]); this.value = v; }
  exponentialRampToValueAtTime(v, t) { this.events.push(["expRamp", v, t]); this.value = v; }
  cancelScheduledValues(t) { this.events.push(["cancel", t]); }
  cancelAndHoldAtTime(t) { this.events.push(["cancelHold", t]); }
}

class StubNode {
  constructor(ctx, type) {
    this.__type = type;
    this.__id = nextNodeId++;
    this.connections = [];
    this.events = [];
  }
  connect(t) { this.connections.push(t); return t; }
  disconnect() { this.connections = []; }
  start(t) { this.startedAt = t ?? 0; this.started = true; }
  stop(t) { this.stoppedAt = t ?? 0; this.stopped = true; }
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
const approx = (a, b) => Math.abs(a - b) < 1e-6;
const same = (a, b) => a && b && a.__id === b.__id;

/* =========================================================
 * Scénario 1 : voice delayé + enveloppe sur le gain
 * ========================================================= */
{
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
        { id: "v1", type: "voice", params: { delay: 0.5 }, position: {} },
        { id: "g1", type: "gain", params: { gain: 0.8 }, position: {} },
        { id: "env", type: "envelope", params: { modulation: "relative", stages: {
            press: [{ from: 0, to: 1, duration: 0.1, curve: "linear" }],
            release: [{ from: "current", to: 0, duration: 0.2, curve: "linear" }],
          } }, position: {} },
        { id: "vdest", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "v1", port: "out:out" }, to: { id: "g1", port: "in:in" } },
        { from: { id: "env", port: "out:out" }, to: { id: "g1", port: "in:gain" } },
        { from: { id: "g1", port: "out:out" }, to: { id: "vdest", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60, 1);

  const ctx = toRaw(synth.getContext());
  const osc = ctx.created.find((n) => n.__type === "osc");
  const gain = ctx.created.find((n) => n.__type === "gain" && approx(n.gain.value, 0.8));
  const mainInput = () => ctx.created.find((n) => n.__type === "gain" && same(n.connections[0], ctx.destination));

  check("nœud osc + gain créés", !!osc && !!gain);
  check("osc démarré à now + 0.5", osc.started === true && approx(osc.startedAt, 0.5));

  const events = gain.gain.events;
  const attackSet = events.find(([k, v]) => k === "set" && v === 0);
  check("attaque de l'enveloppe (set 0) à t=0.5", !!attackSet && approx(attackSet[2], 0.5));
  const stageRamp = events.find(([k]) => k === "linRamp");
  check("rampe de l'attaque à t=0.6", !!stageRamp && approx(stageRamp[2], 0.6));
  check("aucun événement d'attaque avant t=0.5",
    events.every(([k, v, t]) => !((k === "linRamp") && t < 0.5 - 1e-9)));

  // release non décalé : il doit partir à noteOff (currentTime)
  synth.noteOff(60);
  const relEvents = gain.gain.events;
  check("release programmé dès noteOff (cancel à now=0)",
    relEvents.some(([k, t]) => k === "cancel" && approx(t, 0)));
  const relRamp = relEvents.filter(([k]) => k === "linRamp").at(-1);
  check("rampe de release vers 0 à t=0.2 (non décalée)", !!relRamp && approx(relRamp[1], 0) && approx(relRamp[2], 0.2));
  // le stop de l'osc : pas AVANT son start (0.5)
  check("osc stoppé après son démarrage", osc.stopped === true && osc.stoppedAt >= 0.5 - 1e-9);
}

/* =========================================================
 * Scénario 2 : deux osc, delays différents, même gain → min
 * ========================================================= */
{
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
        { id: "vA", type: "voice", params: { delay: 0 }, position: {} },
        { id: "vB", type: "voice", params: { delay: 2 }, position: {} },
        { id: "g1", type: "gain", params: { gain: 0.5 }, position: {} },
        { id: "env", type: "envelope", params: { modulation: "relative", stages: {
            press: [{ from: 0, to: 1, duration: 0.1, curve: "linear" }],
            release: [{ from: "current", to: 0, duration: 0.2, curve: "linear" }],
          } }, position: {} },
        { id: "vdest", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "vA", port: "out:out" }, to: { id: "g1", port: "in:in" } },
        { from: { id: "vB", port: "out:out" }, to: { id: "g1", port: "in:in" } },
        { from: { id: "env", port: "out:out" }, to: { id: "g1", port: "in:gain" } },
        { from: { id: "g1", port: "out:out" }, to: { id: "vdest", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60, 1);

  const ctx = toRaw(synth.getContext());
  const oscs = ctx.created.filter((n) => n.__type === "osc");
  check("2 oscillateurs créés", oscs.length === 2);
  check("osc delay 0 démarré à now", approx(oscs.find((o) => o.startedAt < 0.5).startedAt, 0));
  check("osc delay 2 démarré à now+2", approx(oscs.find((o) => o.startedAt > 1).startedAt, 2));

  const gain = ctx.created.find((n) => n.__type === "gain" && approx(n.gain.value, 0.5));
  // gain commun : le plus petit delay (0) pilote l'attaque de l'enveloppe
  const attackSet = gain.gain.events.find(([k, v]) => k === "set" && v === 0);
  check("enveloppe sur le gain commun : attaque à t=0 (plus petit delay)", !!attackSet && approx(attackSet[2], 0));
}

/* =========================================================
 * Scénario 3 : patch principal (deferStart) → démarrage différé
 * ========================================================= */
{
  const patch = {
    mainPatch: {
      modules: [
        { id: "o1", type: "osc", params: { delay: 0.3, frequency: 220 }, position: {} },
        { id: "g1", type: "gain", params: { gain: 0.5 }, position: {} },
        { id: "env", type: "envelope", params: { modulation: "relative", stages: {
            press: [{ from: 0, to: 1, duration: 0.1, curve: "linear" }],
            release: [{ from: "current", to: 0, duration: 0.2, curve: "linear" }],
          } }, position: {} },
        { id: "mdest", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "o1", port: "out:out" }, to: { id: "g1", port: "in:in" } },
        { from: { id: "env", port: "out:out" }, to: { id: "g1", port: "in:gain" } },
        { from: { id: "g1", port: "out:out" }, to: { id: "mdest", port: "in:in" } },
      ],
    },
    voicePatch: { modules: [], connections: [] },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  const ctx = toRaw(synth.getContext());
  const osc = ctx.created.find((n) => n.__type === "osc");
  check("main patch : osc NON démarré avant startMainPatch", osc.started !== true);

  // noteOn déclenche init (build) puis startMainPatch au même instant (0)
  await synth.noteOn(60, 1);

  check("main patch : osc démarré à startMainPatch + 0.3 = 0.3", osc.started === true && approx(osc.startedAt, 0.3));
  const gain = ctx.created.find((n) => n.__type === "gain" && approx(n.gain.value, 0.5));
  const attackSet = gain.gain.events.find(([k, v]) => k === "set" && v === 0);
  check("main patch : enveloppe attaque décalée à 0.3", !!attackSet && approx(attackSet[2], 0.3));
}

console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);