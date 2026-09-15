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

import { usePatchVoice, getWavetableFrameState, getWavetableBundle } from "../src/composables/usePatchVoice.js";
import { useSuperModules } from "../src/composables/useSuperModules.js";
import { setAudioBuffer } from "../src/composables/useAudioBufferCache.js";

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
  setValueCurveAtTime(curve, t, dur) {
    if (globalThis.__stubCurveThrow) {
      globalThis.__stubCurveThrow = false; // un coup, puis retour à la normale
      throw new Error("stub setValueCurveAtTime failure");
    }
    this.events.push(["curve", curve, t, dur]);
    this.value = curve[curve.length - 1];
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
  start(...args) {
    this.started = true;
    this.startArgs = args;
  }
  stop(t) {
    this.stopped = true;
    this.stoppedAt = t;
  }
  setPeriodicWave(wave) {
    this.wave = wave;
    if (!globalThis.__wavesApplied) globalThis.__wavesApplied = [];
    globalThis.__wavesApplied.push(wave);
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
  createBufferSource() {
    const n = new StubNode(this, "bufferSource");
    n.buffer = null;
    n.playbackRate = new StubParam(1);
    n.detune = new StubParam(0);
    n.loop = false;
    n.loopStart = 0;
    n.loopEnd = 0;
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
  createPeriodicWave(real, imag, options) {
    if (globalThis.__stubPWThrow && (real?.length > 256 || imag?.length > 256)) {
      throw new Error("stub createPeriodicWave failure");
    }
    const w = { real, imag, options: options || {}, __type: "periodicWave" };
    this.created.push(w);
    return w;
  }
  createAnalyser() {
    const n = new StubNode(this, "analyser");
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    this.created.push(n);
    return n;
  }
  createWaveShaper() {
    const n = new StubNode(this, "waveshaper");
    n.curve = null;
    n.oversample = "none";
    this.created.push(n);
    return n;
  }
  createChannelSplitter(count) {
    const n = new StubNode(this, "splitter");
    n.channelCount = count;
    this.created.push(n);
    return n;
  }
  createChannelMerger(count) {
    const n = new StubNode(this, "merger");
    n.channelCount = count;
    this.created.push(n);
    return n;
  }
  createPanner() {
    const n = new StubNode(this, "panner");
    for (const k of ["positionX", "positionY", "positionZ", "orientationX", "orientationY", "orientationZ"]) {
      n[k] = new StubParam(0);
    }
    this.created.push(n);
    return n;
  }
  createStereoPanner() {
    const n = new StubNode(this, "stereoPanner");
    n.pan = new StubParam(0);
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

/* =========================================================
 * Scénario 5 : module wavetable (PeriodicWave depuis JSON)
 * ========================================================= */
{
  const patch = {
    mainPatch: { modules: [], connections: [] },
    voicePatch: {
      modules: [
        {
          id: "wt1",
          type: "wavetable",
          params: {
            wave: '{"real":[0,0,0],"imag":[0,1,0.5]}',
            detune: 0,
            delay: 0,
          },
          position: {},
        },
        { id: "wd", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "wt1", port: "out:out" }, to: { id: "wd", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60);
  const ctx = synth.getContext();

  const oscNode = of(ctx, "osc").find((o) =>
    approx(o.frequency.value, noteToFreq(60))
  );
  check("wavetable : oscillateur créé", !!oscNode);
  check(
    "wavetable : setPeriodicWave appliqué (real/imag du JSON)",
    !!oscNode &&
      !!oscNode.wave &&
      oscNode.wave.real.length === 3 &&
      oscNode.wave.imag[1] === 1 &&
      oscNode.wave.imag[2] === 0.5
  );
  check(
    "wavetable : disableNormalization = true par défaut",
    !!oscNode && !!oscNode.wave && oscNode.wave.options.disableNormalization === true
  );
  check("wavetable : fréquence = note 60", !!oscNode);
  check("wavetable : oscillateur démarré", !!oscNode && oscNode.started === true);

  synth.noteOff(60);
}

/* =========================================================
 * Scénario 6 : wavetable avec disableNormalization=false explicite
 * ========================================================= */
{
  const patch = {
    mainPatch: { modules: [], connections: [] },
    voicePatch: {
      modules: [
        {
          id: "wt2",
          type: "wavetable",
          params: {
            wave:
              '{"real":[0,0,0],"imag":[0,2],"disableNormalization":false}',
            detune: 0,
            delay: 0,
          },
          position: {},
        },
        { id: "wd2", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "wt2", port: "out:out" }, to: { id: "wd2", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60);
  const ctx = synth.getContext();

  const oscNode = of(ctx, "osc").find((o) => !!o.wave);
  check(
    "wavetable : disableNormalization=false lue depuis le JSON",
    !!oscNode &&
      !!oscNode.wave &&
      oscNode.wave.options.disableNormalization === false
  );

  synth.noteOff(60);
}

/* =========================================================
 * Scénario 7 : module fx — plage de lecture start/end (ms)
 * ========================================================= */
{
  const fakeBuffer = {
    duration: 4,
    sampleRate: 44100,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100 * 4),
  };
  setAudioBuffer("sample.wav", fakeBuffer);

  const patch = {
    mainPatch: { modules: [], connections: [] },
    voicePatch: {
      modules: [
        {
          id: "fx1",
          type: "fx",
          params: {
            buffer: "sample.wav",
            start: 500,
            end: 2500,
            delay: 0,
            detune: 0,
            loop: true,
          },
          position: {},
        },
        { id: "fxd", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "fx1", port: "out:out" }, to: { id: "fxd", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60);
  const ctx = synth.getContext();

  const src = of(ctx, "bufferSource")[0];
  check("fx : bufferSource créé", !!src);
  check(
    "fx : loop → start(quand, offset=0.5s) SANS durée (boucle jusqu'au noteOff)",
    !!src && src.startArgs[1] === 0.5 && src.startArgs[2] === undefined
  );
  check("fx : loopStart = 0.5 s", !!src && src.loopStart === 0.5);
  check("fx : loopEnd = 2.5 s", !!src && src.loopEnd === 2.5);
  check(
    "fx : playbackRate transposé à la note 60",
    !!src && approx(src.playbackRate.value, noteToFreq(60) / 440)
  );
  synth.noteOff(60);
}

/* =========================================================
 * Scénario 8 : fx sans start/end → lecture complète du fichier
 * ========================================================= */
{
  const patch = {
    mainPatch: { modules: [], connections: [] },
    voicePatch: {
      modules: [
        {
          id: "fx2",
          type: "fx",
          params: { buffer: "sample.wav", loop: false },
          position: {},
        },
        { id: "fxd2", type: "destination", params: {}, position: {} },
      ],
      connections: [
        { from: { id: "fx2", port: "out:out" }, to: { id: "fxd2", port: "in:in" } },
      ],
    },
  };

  const synth = usePatchVoice(patch);
  await synth.init();
  await synth.noteOn(60);
  const ctx = synth.getContext();

  const sources = of(ctx, "bufferSource");
  const src = sources[sources.length - 1];
  check(
    "fx : par défaut lecture depuis 0 jusqu'à la fin",
    !!src && src.startArgs[1] === 0 && src.startArgs[2] === 4.0
  );
  check("fx : loop désactivé par défaut", !!src && src.loop === false);
  synth.noteOff(60);
}

/* =========================================================
 * Scénario 9 : module wavetableS — morphing en boucle
 * (endMode "loop" par défaut : retour à la frame 0 en fin de liste)
 * ========================================================= */
{
  const wave3 =
    '[{"real":[0,0,0,0],"imag":[0,1,0.5,0.333]},{"real":[0,0,0,0],"imag":[0,1,0,0.333]},{"real":[0,0,0,0],"imag":[0,1,0,0]}]';

  // identifie une frame par ses coeffs : 0 (dent de scie), 1 ou 2 (sine).
  // Les coeffs arrivent en Float32Array (compaction moteur) → comparaison
  // approximative, la précision float32 ne garantit pas 0.333 === 0.333.
  const frameId = (w) =>
    approx(w.imag[2], 0.5) ? 0 : approx(w.imag[3], 0.333) ? 1 : 2;
  const hasPair = (arr, a, b) =>
    arr.some((v, i) => arr[i] === a && arr[i + 1] === b);

  const buildSynth = async (extraParams) => {
    const patch = {
      mainPatch: { modules: [], connections: [] },
      voicePatch: {
        modules: [
          {
            id: "ws1",
            type: "wavetableS",
            params: {
              wave: wave3,
              morph: 10, // 10 ms par crossfade
              detune: 0,
              delay: 0,
              ...extraParams,
            },
            position: {},
          },
          { id: "wsd", type: "destination", params: {}, position: {} },
        ],
        connections: [
          {
            from: { id: "ws1", port: "out:out" },
            to: { id: "wsd", port: "in:in" },
          },
        ],
      },
    };
    const synth = usePatchVoice(patch);
    await synth.init();
    await synth.noteOn(60);
    return synth;
  };

  // --- 9a : endMode "loop" (défaut) ---
  globalThis.__wavesApplied = [];
  let synth = await buildSynth({});
  let ctx = synth.getContext();

  const oscs = of(ctx, "osc").filter(
    (o) => approx(o.frequency.value, noteToFreq(60))
  );
  check("wavetableS : 2 oscillateurs créés", oscs.length === 2);
  check("wavetableS : osc 1 démarré", !!oscs[0]?.started);
  check("wavetableS : osc 2 démarré", !!oscs[1]?.started);

  check(
    "wavetableS : osc 1 -> frame 0, osc 2 -> frame 1",
    !!oscs[0]?.wave &&
      frameId(oscs[0].wave) === 0 &&
      !!oscs[1]?.wave &&
      frameId(oscs[1].wave) === 1
  );

  const gains = of(ctx, "gain");
  check(
    "wavetableS : au moins 3 gains (2 crossfade + master)",
    gains.length >= 3
  );
  check(
    "wavetableS : masterGain créé",
    !!gains.find((g) => approx(g.gain.value, 1))
  );

  // laisser le scan boucler pendant ~220 ms
  await new Promise((r) => setTimeout(r, 220));

  const curveCount = gains.filter((g) =>
    g.gain.events.some(([k]) => k === "curve")
  ).length;
  const curveEvents = gains.reduce(
    (n, g) => n + g.gain.events.filter(([k]) => k === "curve").length,
    0
  );
  check("wavetableS : crossfade equal-power (courbe schedule)", curveCount >= 1);
  check(
    "wavetableS : balayage EN BOUCLE (bien plus de 4 courbes d'un scan unique)",
    curveEvents > 8
  );

  // séquence des setPeriodicWave APRES le setup : avec la progression par
  // défaut (linear), le balayage pose ~1 crossfade par "morph" :
  // 0(ledée),1,2 puis 0,1,2,… (la transition 2→0 est la soudure de boucle).
  const seq = globalThis.__wavesApplied.slice(2).map(frameId);
  check(
    "wavetableS : loop → retour à 0 en fin de liste (…,2,0,…)",
    hasPair(seq, 2, 0)
  );
  check(
    "wavetableS : loop → jamais de va-et-vient (…,2,1,…)",
    !hasPair(seq, 2, 1)
  );

  synth.noteOff(60);
  check("wavetableS : osc 1 stoppé (loop)", !!oscs[0]?.stopped);
  check("wavetableS : osc 2 stoppé (loop)", !!oscs[1]?.stopped);

  // --- 9b : endMode "pingpong" (va-et-vient) ---
  globalThis.__wavesApplied = [];
  synth = await buildSynth({ endMode: "pingpong" });
  ctx = synth.getContext();
  const pongOscs = of(ctx, "osc").filter(
    (o) => approx(o.frequency.value, noteToFreq(60))
  );
  const pongGains = of(ctx, "gain");

  await new Promise((r) => setTimeout(r, 220));

  const pongEvents = pongGains.reduce(
    (n, g) => n + g.gain.events.filter(([k]) => k === "curve").length,
    0
  );
  check(
    "wavetableS : pingpong → balayage également continu",
    pongEvents > 8
  );

  // séquence seqAt(2..) = 2,1,0,1,2,1,… : rebond sans retour direct 2→0
  const pseq = globalThis.__wavesApplied.slice(2).map(frameId);
  check("wavetableS : pingpong → rebond (…,2,1,…)", hasPair(pseq, 2, 1));
  check(
    "wavetableS : pingpong → jamais de retour direct 2→0",
    !hasPair(pseq, 2, 0)
  );

  synth.noteOff(60);
  check("wavetableS : osc stoppé (pingpong)", !!pongOscs[0]?.stopped);

  // --- 9c : construction paresseuse + cache (perf) ---
  // Une table de 256 frames ne doit JAMAIS être entièrement convertie en
  // PeriodicWave au noteOn : seules les frames 0/1 sont construites, les
  // autres arrivent au fil du balayage (une par crossfade).
  {
    const big =
      "[" +
      Array.from({ length: 256 }, () => '{"real":[0],"imag":[0,1,0,1]}').join(
        ","
      ) +
      "]";
    globalThis.__wavesApplied = [];
    const patchBig = {
      mainPatch: { modules: [], connections: [] },
      voicePatch: {
        modules: [
          {
            id: "wsbig",
            type: "wavetableS",
            params: { wave: big, morph: 10 },
            position: {},
          },
          { id: "wsbd", type: "destination", params: {}, position: {} },
        ],
        connections: [
          {
            from: { id: "wsbig", port: "out:out" },
            to: { id: "wsbd", port: "in:in" },
          },
        ],
      },
    };
    const synthBig = usePatchVoice(patchBig);
    await synthBig.init();
    await synthBig.noteOn(60);
    const wavesAtStart = of(synthBig.getContext(), "periodicWave").length;
    check(
      "wavetableS : 256 frames → seules frame 0/1 construites au noteOn (paresseux)",
      wavesAtStart === 2
    );
    await new Promise((r) => setTimeout(r, 40));
    const wavesLater = of(synthBig.getContext(), "periodicWave").length;
    check(
      "wavetableS : frames suivantes construites au fil du balayage",
      wavesLater > 2 && wavesLater < 256
    );
    synthBig.noteOff(60);
  }

  // --- 9d : auto-réparation — une exception d'automatisation (setValueCurve
  // AtTime qui lève) ne doit JAMAIS geler définitivement le scan : le son
  // doit continuer d'évoluer après l'incident.
  {
    const patchD = {
      mainPatch: { modules: [], connections: [] },
      voicePatch: {
        modules: [
          {
            id: "wsd9",
            type: "wavetableS",
            params: { wave: wave3, morph: 10, detune: 0, delay: 0 },
            position: {},
          },
          { id: "wsdd", type: "destination", params: {}, position: {} },
        ],
        connections: [
          {
            from: { id: "wsd9", port: "out:out" },
            to: { id: "wsdd", port: "in:in" },
          },
        ],
      },
    };
    globalThis.__wavesApplied = [];
    const synthD = usePatchVoice(patchD);
    await synthD.init();
    await synthD.noteOn(60);
    await new Promise((r) => setTimeout(r, 60)); // scan bien lancé
    const beforeErr = globalThis.__wavesApplied.length;
    globalThis.__stubCurveThrow = true; // la prochaine automatisation échoue (une seule fois)
    await new Promise((r) => setTimeout(r, 120)); // plusieurs crossfades plus tard
    check(
      "wavetableS : une exception d'automatisation ne gèle pas le scan (auto-réparation)",
      globalThis.__wavesApplied.length > beforeErr
    );
    synthD.noteOff(60);
  }

  // --- 9e : repli — une frame inconstructible (createPeriodicWave qui lève)
  // ne doit jamais produire d'onde null (sinon l'osc garde son ancienne onde
  // → croisements de 2 ondes figées → son qui n'évolue plus).
  {
    const coeff512 = Array.from({ length: 512 }, () => "0.1").join(",");
    const hugeFrame = `{"real":[${coeff512}],"imag":[${coeff512}]}`;
    const waveHuge = `[${hugeFrame},${hugeFrame}]`;
    const patchE = {
      mainPatch: { modules: [], connections: [] },
      voicePatch: {
        modules: [
          {
            id: "wse9",
            type: "wavetableS",
            params: { wave: waveHuge, morph: 10, detune: 0, delay: 0 },
            position: {},
          },
          { id: "wsed", type: "destination", params: {}, position: {} },
        ],
        connections: [
          {
            from: { id: "wse9", port: "out:out" },
            to: { id: "wsed", port: "in:in" },
          },
        ],
      },
    };
    globalThis.__stubPWThrow = true;
    const synthE = usePatchVoice(patchE);
    await synthE.init();
    await synthE.noteOn(60);
    const eOscs = of(synthE.getContext(), "osc").filter((o) =>
      approx(o.frequency.value, noteToFreq(60))
    );
    check(
      "wavetableS : frames inconstructibles → repli sur l'onde par défaut (jamais null)",
      !!eOscs[0]?.wave && !!eOscs[1]?.wave
    );
    synthE.noteOff(60);
    delete globalThis.__stubPWThrow;
  }

  // --- 9f : progression "quad-out" (easing MONOTONE) → les changements de
  // frame sont RAREFIÉS au début puis rapprochés vers la fin du passage
  // (durées de crossfade non uniformes), sans jamais revenir en arrière et
  // sans perdre la soudure de boucle (…,2,0,…).
  {
    globalThis.__wavesApplied = [];
    const synthF = await buildSynth({ progression: "quad-out" });
    const fctx = synthF.getContext();
    await new Promise((r) => setTimeout(r, 220));
    const fseq = globalThis.__wavesApplied.slice(2).map(frameId);
    const fdurs = of(fctx, "gain")
      .flatMap((g) =>
        g.gain.events
          .filter(([k]) => k === "curve")
          .map(([k, c, t, dur]) => dur)
      )
      .filter((d) => d >= 0);
    check(
      "wavetableS : quad-out → durées de crossfade non uniformes (échantillonnage d'easing)",
      fdurs.length > 4 && Math.max(...fdurs) - Math.min(...fdurs) > 0.004
    );
    check(
      "wavetableS : quad-out → aucun retour en arrière hors soudure de boucle",
      !fseq.some((v, i) => fseq[i] > fseq[i + 1] && fseq[i + 1] !== 0)
    );
    check("wavetableS : quad-out → la boucle reboucle (…,2,0,…)", hasPair(fseq, 2, 0));
    synthF.noteOff(60);
  }

  // --- 9g : progression "bounce-out" (easing NON monotone) → l'index
  // DÉPASSE puis REDESCEND (rebonds) avant de finir sur 1. On vérifie
  // la non-monotonicité de la fonction d'easing (déterministe, pas de
  // timing), puis que le scan ne gèle pas quand on lui fournit un easing
  // non monotone (le balayage avance bien et produit des transitions).
  {
    // 1) Vérification directe de la non-monotonicité de bounce-out :
    //    entre deux points de la descente (u=0.4 → u=0.5), la valeur diminue.
    const bounceOut = (x) => {
      const n1 = 7.5625, d1 = 2.75;
      if (x < 1 / d1) return n1 * x * x;
      if (x < 2 / d1) return n1 * (x - 1.5 / d1) ** 2 + 0.75;
      if (x < 2.5 / d1) return n1 * (x - 2.25 / d1) ** 2 + 0.9375;
      return n1 * (x - 2.625 / d1) ** 2 + 0.984375;
    };
    check(
      "wavetableS : bounce-out E(0.5) < E(0.4) (descente = non monotone)",
      bounceOut(0.5) < bounceOut(0.4)
    );
    check(
      "wavetableS : bounce-out E(1) = 1 (borne finale)",
      Math.abs(bounceOut(1) - 1) < 1e-6
    );

    // 2) Vérification fonctionnelle : le scan tourne sans geler
    //    avec un easing non monotone, et produit des transitions.
    const n = 12;
    const waveB =
      "[" +
      Array.from(
        { length: n },
        (_, k) =>
          `{"real":[0,0,0],"imag":[0,1,${(0.5 + 0.05 * k).toFixed(3)},0]}`
      ).join(",") +
      "]";
    globalThis.__wavesApplied = [];
    const patchB = {
      mainPatch: { modules: [], connections: [] },
      voicePatch: {
        modules: [
          {
            id: "wsb9",
            type: "wavetableS",
            params: {
              wave: waveB,
              morph: 10,
              detune: 0,
              delay: 0,
              progression: "bounce-out",
            },
            position: {},
          },
          { id: "wsbd", type: "destination", params: {}, position: {} },
        ],
        connections: [
          {
            from: { id: "wsb9", port: "out:out" },
            to: { id: "wsbd", port: "in:in" },
          },
        ],
      },
    };
    const synthG = usePatchVoice(patchB);
    await synthG.init();
    await synthG.noteOn(60);
    await new Promise((r) => setTimeout(r, 500));
    const bseq = globalThis.__wavesApplied.slice(2);
    check(
      "wavetableS : bounce-out → le scan avance (transitions produites)",
      bseq.length > 4
    );
    synthG.noteOff(60);
  }

  // --- 9h : le panneau est notifié des frames jouées (surlignage 3D) ---
  // startMorphScan expose l'état de balayage par module (frame + actif) :
  // le visualiseur du panneau doit recevoir (1) une frame active qui
  // progresse pendant la note, puis (2) l'arrêt après le noteOff.
  {
    globalThis.__wavesApplied = [];
    const synthH = await buildSynth({ morph: 20 });
    const hctx = synthH.getContext();
    await synthH.noteOn(60);
    await new Promise((r) => setTimeout(r, 80));
    const st = getWavetableFrameState("ws1");
    check(
      "wavetableS : scan notifié au panneau (actif + frame présente)",
      !!st && st.active === true && typeof st.frame === "number"
    );
    await new Promise((r) => setTimeout(r, 120));
    const st2 = getWavetableFrameState("ws1");
    check(
      "wavetableS : la frame notifiée progresse (morph de 20 ms)",
      !!st && !!st2 && st2.stamp > st.stamp
    );
    synthH.noteOff(60);
    await new Promise((r) => setTimeout(r, 30));
    const st3 = getWavetableFrameState("ws1");
    check(
      "wavetableS : scan marqué arrêté après le noteOff (surlignage off)",
      !!st3 && st3.active === false
    );
  }
}

console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
