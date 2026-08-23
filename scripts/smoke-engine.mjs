// Smoke test moteur : usePatchVoice avec stub WebAudio
// 1. patch vide -> pas de crash
// 2. super-module dans le voicePatch -> graphe + routage des params
// 3. enveloppe interne press/release

// émulation localStorage (test hors navigateur)
const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
};

import { usePatchVoice } from "../src/composables/usePatchVoice.js";
import { useSuperModules } from "../src/composables/useSuperModules.js";

/* =========================================================
 * Stub Web Audio API
 * ========================================================= */

class StubParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(v, t) {
    this.events.push(["set", v, t]);
    this.value = v;
  }
  linearRampToValueAtTime(v, t) {
    this.events.push(["linRamp", v, t]);
    this.value = v;
  }
  exponentialRampToValueAtTime(v, t) {
    this.events.push(["expRamp", v, t]);
    this.value = v;
  }
  cancelScheduledValues(t) {
    this.events.push(["cancel", t]);
  }
  cancelAndHoldAtTime(t) {
    this.events.push(["cancelHold", t]);
  }
}

class StubNode {
  constructor(ctx, type) {
    this.__type = type;
    this.context = ctx;
    this.connections = [];
  }
  connect(t) {
    this.connections.push(t);
    return t;
  }
  disconnect() {
    this.connections = [];
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class StubContext {
  constructor() {
    this.currentTime = 0;
    this.created = [];
    this.destination = new StubNode(this, "destination");
    this.created.push(this.destination);
  }
  get state() {
    return "running";
  }
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
    n.type = "sine";
    this.created.push(n);
    return n;
  }
  createConstantSource() {
    const n = new StubNode(this, "constant");
    n.offset = new StubParam(0);
    this.created.push(n);
    return n;
  }
  createDelay(max) {
    const n = new StubNode(this, "delay");
    n.delayTime = new StubParam(0.3);
    this.created.push(n);
    return n;
  }
  createDynamicsCompressor() {
    const n = new StubNode(this, "compressor");
    for (const [k, d] of Object.entries({
      threshold: -24,
      knee: 30,
      ratio: 12,
      attack: 0.003,
      release: 0.25,
    })) {
      n[k] = new StubParam(d);
    }
    this.created.push(n);
    return n;
  }
  createBiquadFilter() {
    const n = new StubNode(this, "biquad");
    n.frequency = new StubParam(1000);
    n.Q = new StubParam(1);
    n.gain = new StubParam(0);
    this.created.push(n);
    return n;
  }
}

globalThis.AudioContext = StubContext;

/* =========================================================
 * Helpers
 * ========================================================= */

const approx = (a, b) => Math.abs(a - b) < 1e-6;

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

const of = (ctx, type) => ctx.created.filter((n) => n.__type === type);

const noteToFreq = (note) => 440 * Math.pow(2, (note - 69) / 12);

/* =========================================================
 * Scénario 1 : patch vide -> aucun crash
 * ========================================================= */
{
  const synth = usePatchVoice({});
  await synth.init();
  await synth.noteOn(60);
  synth.noteOff(60);
  check("patch vide : init/noteOn/noteOff sans crash", true);
}

/* =========================================================
 * Préparation : définition supervoice (voice+gain+envelope)
 * ========================================================= */
const { saveFromGraph } = useSuperModules();

saveFromGraph({
  name: "SuperVoice",
  color: "#8E44AD",
  graph: {
    modules: [
      {
        id: "v1",
        type: "voice",
        params: { detune: -5, type: "sawtooth" },
        position: { x: 160, y: 220 },
      },
      {
        id: "g1",
        type: "gain",
        params: { gain: 0.8 },
        position: { x: 440, y: 220 },
      },
      { id: "bin", type: "super.in", params: { name: "freq-in" }, position: {} },
      { id: "bout", type: "super.out", params: { name: "audio" }, position: {} },
      {
        id: "env",
        type: "envelope",
        params: {
          modulation: "relative",
          stages: {
            press: [{ from: 0, to: 1, duration: 0.05, curve: "exponential" }],
            release: [{ from: "current", to: 0, duration: 0.15, curve: "linear" }],
          },
        },
        position: {},
      },
    ],
    connections: [
      { from: { id: "v1", port: "out:out" }, to: { id: "g1", port: "in:in" } },
      { from: { id: "g1", port: "out:out" }, to: { id: "bout", port: "in:in" } },
      { from: { id: "bin", port: "out:out" }, to: { id: "v1", port: "in:frequency" } },
      { from: { id: "env", port: "out:out" }, to: { id: "g1", port: "in:gain" } },
    ],
  },
});

/* =========================================================
 * Scénario 2 : supervoice instancié dans le voicePatch
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
        {
          id: "sv1",
          type: "supervoice",
          params: { detune: -5, type: "sawtooth", gain: 0.8 },
          position: {},
        },
        { id: "vdest", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "sv1", port: "out:audio" }, to: { id: "vdest", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  const ctx = synth.getContext();

  await synth.noteOn(60, 1);

  /* --- structure attendue ---
   * osc(sawtooth, freq=noteToFreq(60), detune=-5)
   *   -> innerGain(0.8) -> outBoundary -> mainInput(input) -> destination
   * inBoundary (non alimenté) -> osc.frequency
   * env: press programmé sur innerGain.gain (base 0.8)
   */

  const oscs = of(ctx, "osc");
  check("1 oscillateur créé", oscs.length === 1);
  const osc = oscs[0];

  check("type routé depuis l'instance (sawtooth)", osc.type === "sawtooth");
  check(
    "fréquence = note 60 (" + noteToFreq(60).toFixed(2) + ")",
    approx(osc.frequency.value, noteToFreq(60))
  );
  check("detune routé (-5)", approx(osc.detune.value, -5));
  check("osc démarré", osc.started === true);

  const gains = of(ctx, "gain");
  // input(main) + innerGain + boundaryIn + boundaryOut = 4 (+destination stub séparé)
  check("4 gains créés", gains.length === 4);

  const innerGain = gains.find((g) => approx(g.gain.value, 0.8));
  check("innerGain avec valeur routée 0.8", !!innerGain);

  check("voice.out -> gain.in", innerGain && osc.connections.includes(innerGain));

  // boundary in : celui qui alimente osc.frequency
  const boundaryIn = gains.find((g) => g.connections.includes(osc.frequency));
  check("boundaryIn -> voice.frequency", !!boundaryIn);

  // boundary out : alimenté par innerGain
  const boundaryOut = gains.find((g) => g === innerGain?.connections[0]);
  check("gain.out -> boundaryOut", !!boundaryOut);

  // chaîne externe : boundaryOut -> vdest (= mainInput) ; mainInput -> ctx.destination
  const mainInput = gains.find(
    (g) => boundaryOut && boundaryOut.connections.includes(g)
  );
  check("boundaryOut -> destination du voicePatch (mainInput)", !!mainInput);
  check(
    "mainInput -> ctx.destination",
    !!mainInput && mainInput.connections.includes(ctx.destination)
  );

  // enveloppe press : expRamp vers to * velocity * base = 1 * 1 * 0.8
  const pressRamp = innerGain.gain.events.find(
    ([kind, v]) => kind === "expRamp" && approx(v, 0.8)
  );
  check("enveloppe press programmée sur gain (base relative 0.8)", !!pressRamp);

  /* --- release --- */
  synth.noteOff(60);

  const relRamp = innerGain.gain.events.find(
    ([kind, v]) => kind === "linRamp" && v === 0
  );
  check("enveloppe release programmée", !!relRamp);
  check("osc stoppé après release", osc.stopped === true);
}

/* =========================================================
 * Scénario 3 : supervoice dans le mainPatch (deferred start)
 * ========================================================= */
{
  const patch = {
    mainPatch: {
      modules: [
        {
          id: "sv2",
          type: "supervoice",
          params: { detune: 0, type: "square", gain: 1 },
          position: {},
        },
      ],
      connections: [],
    },
    voicePatch: { modules: [], connections: [] },
  };

  const synth = usePatchVoice(patch);
  await synth.init(); // construit mais ne démarre pas encore

  let oscs = of(synth.getContext(), "osc");
  check(
    "mainPatch : osc interne NON démarré avant startMainPatch",
    oscs.every((o) => !o.started)
  );

  await synth.noteOn(60); // déclenche startMainPatch

  oscs = of(synth.getContext(), "osc");
  check(
    "mainPatch : osc interne démarré après noteOn",
    oscs.length > 0 && oscs.every((o) => o.started)
  );
}

/* =========================================================
 * Scénario 4 : modulation gain.out -> osc.detune / voice.frequency
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
        { id: "gm", type: "gain", params: { gain: 0.5 }, position: {} },
        { id: "o1", type: "osc", params: {}, position: {} },
        { id: "v1", type: "voice", params: {}, position: {} },
        { id: "vd", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "gm", port: "out:out" }, to: { id: "o1", port: "in:detune" } },
        { from: { id: "gm", port: "out:out" }, to: { id: "v1", port: "in:frequency" } },
        // gain utilisé comme sortie audio classique
        { from: { id: "gm", port: "out:out" }, to: { id: "vd", port: "in:in" } },
        { from: { id: "v1", port: "out:out" }, to: { id: "vd", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60);

  const ctx = synth.getContext();
  const gainMod = ctx.created.find(
    (n) => n.__type === "gain" && approx(n.gain.value, 0.5)
  );
  check("module gain modulateur créé", !!gainMod);

  const oscNode = of(ctx, "osc").find((o) => approx(o.frequency.value, 440));
  const voiceNode = of(ctx, "osc").find((o) =>
    approx(o.frequency.value, noteToFreq(60))
  );
  check("osc (440 Hz) créé", !!oscNode);
  check("voice (note 60) créée", !!voiceNode);

  check(
    "gain.out -> osc.detune câblé",
    !!gainMod && gainMod.connections.includes(oscNode.detune)
  );
  check(
    "gain.out -> voice.frequency câblé",
    !!gainMod && gainMod.connections.includes(voiceNode.frequency)
  );

  // la chaîne audio classique reste intacte
  const mainInputGain = ctx.created.find(
    (n) => n.__type === "gain" && n.connections.includes(ctx.destination)
  );
  check(
    "voice.out -> destination (mainInput)",
    !!voiceNode &&
      !!mainInputGain &&
      voiceNode.connections.includes(mainInputGain)
  );

  // gain.out reste utilisable comme sortie audio (gain -> destination.in)
  check(
    "gain.out -> destination (audio chain)",
    !!gainMod && !!mainInputGain && gainMod.connections.includes(mainInputGain)
  );
}

console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
