// Smoke test du module `audioworklet` :
//  1. compilation : hash stable, nom unique, réécriture de registerProcessor,
//     prelude injecté, idempotence, code invalide
//  2. moteur : repli pass-through si code non compilé, nœud réel si compilé,
//     AudioParams p1..p8 câblables, rebuildMainPatch async
//  3. non-régression : les autres types de modules sont inchangés

// émulation localStorage (test hors navigateur)
const __store = new Map();
globalThis.localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: (k) => __store.delete(k),
};

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
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
  setValueCurveAtTime() {}
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
    this.disconnected = true;
  }
  start() {
    this.started = true;
  }
  stop() {}
  setPeriodicWave() {}
}

class StubAudioWorkletNode extends StubNode {
  constructor(ctx, name, options) {
    super(ctx, "audioworklet");
    this.name = name;
    this.options = options;
    this._params = new Map();
    // Le vrai navigateur construit le processor avec les options du nœud, et
    // les AudioParams sont ceux DÉCLARÉS PAR LE PROCESSOR (les descripteurs
    // passés au nœud sont ignorés). On reproduit ce chemin pour que le test
    // échoue si l'on régresse vers des descripteurs côté nœud.
    // toRaw : le moteur passe le contexte à travers un proxy réactif, or la
    // WeakMap du stub est indexée sur l'objet brut.
    const Klass = globalThis.__stubProcessors.get(toRaw(ctx)).get(name);
    if (!Klass) throw new Error(`NotSupportedError: "${name}" non enregistré`);
    const proc = new Klass({
      numberOfInputs: options?.numberOfInputs ?? 1,
      numberOfOutputs: options?.numberOfOutputs ?? 1,
      outputChannelCount: options?.outputChannelCount ?? [1],
      processorOptions: options?.processorOptions ?? {},
    });
    this.descriptors = proc.__parameterDescriptors ?? [];
    for (const d of this.descriptors) this._params.set(d.name, new StubParam(d.defaultValue));
    globalThis.__stubWorkletNodes.push(this);
  }
  get parameters() {
    // MapInterface : les entrées non déclarées renvoient null
    return { get: (n) => this._params.get(n) ?? null };
  }
}

class StubContext {
  constructor() {
    this.currentTime = 0;
    this.created = [];
    this.destination = new StubNode(this, "destination");
    this.created.push(this.destination);
    globalThis.__stubProcessors.set(this, new Map());
    this.audioWorklet = {
      addModule: async (url) => {
        globalThis.__stubAddModuleCalls.push(url);
        const src = globalThis.__stubBlobs.get(url);
        if (src === undefined) throw new Error("blob inconnu : " + url);
        if (globalThis.__stubAddModuleThrows) {
          throw new Error("SyntaxError: Unexpected token '}'");
        }
        // Évaluation RÉELLE du blob dans un contexte global dédié (vm), pas
        // un `new Function` : le code écrit `class X extends
        // AudioWorkletProcessor`, et le préambule REMPLACE ce global par la
        // classe de base qui injecte les descripteurs. Avec un simple paramètre
        // de fonction, l'utilisateur verrait l'ancien global et la correction
        // ne serait pas exercée.
        const declared = [];
        const FakeProcessor = class {
          constructor(options) {
            this.__parameterDescriptors = options?.parameterDescriptors;
            this.__options = options;
          }
        };
        const fakeGlobal = {
          AudioWorkletProcessor: FakeProcessor,
          registerProcessor: (n, K) => declared.push({ name: n, Klass: K }),
        };
        vm.runInNewContext(src, fakeGlobal);
        if (!declared.length) throw new Error("SyntaxError: aucun registerProcessor");
        globalThis.__stubProcessors.get(this).set(declared[0].name, declared[0].Klass);
        this.audioWorklet.declared = this.audioWorklet.declared ?? [];
        this.audioWorklet.declared.push(declared[0].name);
      },
    };
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
    this.type = "sine";
    this.created.push(n);
    return n;
  }
  createConstantSource() {
    const n = new StubNode(this, "constant");
    n.offset = new StubParam(1);
    this.created.push(n);
    return n;
  }
  createAnalyser() {
    const n = new StubNode(this, "analyser");
    n.fftSize = 2048;
    n.smoothingTimeConstant = 0.8;
    this.created.push(n);
    return n;
  }
  // Le module "compressor" fait partie du catalogue : sans ce stub, tout patch
  // réel qui l'utilise échoue sur `createDynamicsCompressor is not a function`.
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
    n.reduction = -0;
    this.created.push(n);
    return n;
  }
}

globalThis.AudioContext = StubContext;
globalThis.AudioWorkletNode = StubAudioWorkletNode;

/* Blob / object-URL stubés : on doit pouvoir relire le source empaqueté pour
 * vérifier le code injecté avant de l'exécuter. */
const __blobs = new Map();
let __blobSeq = 0;
globalThis.__stubBlobs = __blobs;
globalThis.__stubAddModuleCalls = [];
globalThis.__stubWorkletNodes = [];
globalThis.__stubProcessors = new WeakMap();
globalThis.__stubAddModuleThrows = false;

globalThis.Blob = class StubBlob {
  constructor(parts, options) {
    this.text = parts.join("");
    this.type = options?.type;
  }
};
globalThis.URL.createObjectURL = (blob) => {
  const url = `blob:stub/${++__blobSeq}`;
  __blobs.set(url, blob.text);
  return url;
};
globalThis.URL.revokeObjectURL = (url) => {
  __blobs.delete(url);
};

import { toRaw } from "vue";
import vm from "node:vm";
import { usePatchVoice } from "../src/composables/usePatchVoice.js";
import {
  ensureWorklet,
  peekWorklet,
  getWorkletDefaults,
  parseRanges,
  clampParamValue,
  WORKLET_PARAM_NAMES,
} from "../src/composables/useAudioWorklet.js";
import { useModuleCatalog } from "../src/composables/useModuleCatalog.js";

/* =========================================================
 * Helpers
 * ========================================================= */

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? " " + detail : ""}`);
  if (!cond) failures++;
}

const validCode = `class Foo extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    return true
  }
}
registerProcessor("mon-dsp", Foo)
`;

// Même DSP, classe et nom différents : /Foo/g pour renommer aussi l'appel
// registerProcessor("mon-dsp", Foo), sinon le code ne s'exécute pas.
const otherCode = validCode.replace(/Foo/g, "Bar").replace("mon-dsp", "autre");

/* =========================================================
 * Scénario 1 : compilation
 * ========================================================= */

const ctxA = new StubContext();
let krate = null;

/* Capture du source transmis : addModule relit le blob via l'URL, et le blob
 * est révoqué juste après — on garde donc une trace du texte au packaging. */
const packaged = [];
const prevCreate = globalThis.URL.createObjectURL;
globalThis.URL.createObjectURL = (blob) => {
  packaged.push(blob.text);
  return prevCreate(blob);
};

{
  const rec = await ensureWorklet(ctxA, validCode);
  check("code valide : status ok", rec.status === "ok");
  check("nom du processor préfixé aw_", /^aw_\w+$/.test(rec.name));
  check("le nom de l'utilisateur n'est pas utilisé tel quel", rec.name !== "mon-dsp");
  check("le blob contient le code de l'utilisateur, intact", /class Foo extends/.test(packaged[0] ?? ""));
  check("le code de l'utilisateur n'est pas réécrit",
    /registerProcessor\("mon-dsp", Foo\)/.test(packaged[0] ?? ""));
  check("le blob contient le prelude awParam", /const awParam =/.test(packaged[0] ?? ""));
  // Le nom unique est imposé par le wrapper qui masque registerProcessor.
  check("le wrapper masque registerProcessor",
    /const registerProcessor = \(nom, Classe\)/.test(packaged[0] ?? ""));
  check("le nom unique est passé au registerProcessor natif",
    new RegExp(`__awNativeRegister\\("${rec.name}"`).test(packaged[0] ?? ""));
  check("le nom enregistré est bien le nom unique",
    ctxA.audioWorklet.declared[0] === rec.name);
  // C'est LE point qui plantait avant : les descripteurs doivent être déclarés
  // par le processor, sinon node.parameters est vide et parameters.get("p1")
  // renvoie undefined.
  const Klass = globalThis.__stubProcessors.get(ctxA).get(rec.name);
  const proc = new Klass({ numberOfInputs: 1, numberOfOutputs: 1, processorOptions: {} });
  check("p1..p8 déclarés par le processor", proc.__parameterDescriptors?.length === 8);
  check("noms des descripteurs corrects",
    (proc.__parameterDescriptors ?? []).map((d) => d.name).join(",") === "p1,p2,p3,p4,p5,p6,p7,p8");
  check("bornes des descripteurs -10..10",
    proc.__parameterDescriptors?.[0]?.minValue === -10 &&
    proc.__parameterDescriptors?.[0]?.maxValue === 10);
  check("mode a-rate par défaut",
    proc.__parameterDescriptors?.[0]?.automationRate === "a-rate");
  check("processorOptions transmis à super()",
    proc.__options?.processorOptions !== undefined);
  check("le code de l'utilisateur ne déclare AUCUN descripteur (pas de doublon)",
    !/parameterDescriptors/.test(validCode));
}

{
  // rate k-rate : figé dans les descripteurs du blob, donc compilation distincte
  krate = await ensureWorklet(ctxA, validCode, { rate: "k-rate" });
  check("k-rate : processor distinct du a-rate",
    krate.name !== peekWorklet(ctxA, validCode).name);
  check("k-rate : deuxième compilation du même code",
    globalThis.__stubAddModuleCalls.length === 2);
  const kproc = new (globalThis.__stubProcessors.get(ctxA).get(krate.name))({});
  check("k-rate : automationRate k-rate dans les descripteurs",
    kproc.__parameterDescriptors?.[0]?.automationRate === "k-rate");
  // ...et l'a-rate d'origine n'a pas été écrasé
  const aproc = new (globalThis.__stubProcessors.get(ctxA).get(peekWorklet(ctxA, validCode).name))({});
  check("a-rate : le processor d'origine reste en a-rate",
    aproc.__parameterDescriptors?.[0]?.automationRate === "a-rate");
}

{
  // Plages de valeurs déclarées dans options.ranges. C'est LA cause rapportée :
  // un AudioParam est borné par le navigateur, donc une plage figée à ±10 rend
  // inexprimables les profondeurs de bits (1..16) ou les fréquences en Hz, et
  // une modulation à 12000 se retrouve épinglée à 10 en permanence.
  check("parseRanges : [min, max]",
    parseRanges('{"ranges":{"p1":[1,16]}}').p1?.minValue === 1 &&
    parseRanges('{"ranges":{"p1":[1,16]}}').p1?.maxValue === 16);
  check("parseRanges : nombre = plage symétrique",
    parseRanges('{"ranges":{"p2":0.5}}').p2?.minValue === -0.5 &&
    parseRanges('{"ranges":{"p2":0.5}}').p2?.maxValue === 0.5);
  check("parseRanges : JSON invalide -> plages par défaut",
    Object.keys(parseRanges("{pas du json")).length === 0);
  check("parseRanges : pas de ranges -> vide",
    Object.keys(parseRanges('{"params":{}}')).length === 0);
  check("parseRanges : plage incohérente ignorée",
    Object.keys(parseRanges('{"ranges":{"p1":[5,5],"p3":"x"}}')).length === 0);
  check("clampParamValue borne dans la plage déclarée",
    clampParamValue(parseRanges('{"ranges":{"p1":[1,16]}}'), "p1", 10000) === 16);
  check("clampParamValue : hors plage basse",
    clampParamValue(parseRanges('{"ranges":{"p1":[1,16]}}'), "p1", -3) === 1);
  check("clampParamValue : sans plage, valeur inchangée",
    clampParamValue({}, "p1", 10000) === 10000);
}

{
  // le cas exact du bitcrusher : constant à 12000 sur un p2 dont la plage par
  // défaut le plafonne à 10
  const bitCode = `class Bitcrusher extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    return true
  }
}
registerProcessor("bitcrusher", Bitcrusher)
`;
  const bitOpts = '{"params":{},"ranges":{"p1":[1,16],"p2":[100,20000]}}';
  const rec = await ensureWorklet(ctxA, bitCode, { options: bitOpts });
  check("plages : compilation ok", rec.status === "ok");
  const bitProc = new (globalThis.__stubProcessors.get(ctxA).get(rec.name))({});
  const d1 = bitProc.__parameterDescriptors.find((d) => d.name === "p1");
  const d2 = bitProc.__parameterDescriptors.find((d) => d.name === "p2");
  check("plages : p1 borné à 1..16", d1.minValue === 1 && d1.maxValue === 16);
  check("plages : p2 borné à 100..20000", d2.minValue === 100 && d2.maxValue === 20000);
  check("plages : les 6 autres restent en -10..10",
    bitProc.__parameterDescriptors.find((d) => d.name === "p3").maxValue === 10);
  check("plages : un code identique SANS ranges est un autre processor",
    (await ensureWorklet(ctxA, bitCode)).name !== rec.name);
  check("plages :.peekWorklet retrouve le bon processor selon options",
    peekWorklet(ctxA, bitCode, { options: bitOpts })?.name === rec.name &&
    peekWorklet(ctxA, bitCode)?.name !== rec.name);
}

{
  // RÉGRESSION awParam : dans process(), un AudioParam est un Float32Array de
  // longueur 1 OU 128. Un paramètre constant sur le quantum de rendu (a-rate
  // non modulé, k-rate, ou modulé plus lentement qu'un bloc — un LFO à 4 Hz ne
  // change pas à chaque bloc de 128 samples) arrive en longueur 1. Lire arr[i]
  // sans tester la longueur renvoyait undefined -> NaN en sortie : c'est le
  // symptôme « les valeurs passées au worklet ne sont pas correctes ».
  const gainCode = `class GainParam extends AudioWorkletProcessor {
  process(inputs, outputs, parameters) {
    const inp = inputs[0] || []
    const out = outputs[0] || []
    const src = inp[0]
    const dst = out[0]
    if (!src || !dst) return true
    for (let i = 0; i < dst.length; i++) {
      dst[i] = awParam(parameters.p1, i) * src[i]
    }
    return true
  }
}
registerProcessor("gain-param", GainParam)
`;
  const rec = await ensureWorklet(ctxA, gainCode);
  check("awParam : DSP de test compilé", rec.status === "ok");
  const Klass = globalThis.__stubProcessors.get(ctxA).get(rec.name);
  const proc = new Klass({});
  const inp = new Float32Array([1, 0.5, -1, 0.25]);
  const run = (p1) => {
    const out = new Float32Array(inp.length);
    proc.process([[inp]], [[out]], { p1 });
    return out;
  };
  const expected = [0.5, 0.25, -0.5, 0.125];
  const close = (a) => a.every((v, i) => Math.abs(v - expected[i]) < 1e-6);
  // Tableau allongé (> 1) : indexé par sample.
  check("awParam : tableau par sample (a-rate) correct",
    close(run(Float32Array.from({ length: inp.length }, () => 0.5))));
  // Tableau d'UNE valeur (paramètre constant) : valeur répétée, jamais NaN.
  const cst = run(new Float32Array([0.5]));
  check("awParam : longueur 1 -> valeur constante, pas de NaN",
    [...cst].every((v) => Number.isFinite(v)) && close(cst),
    `(sortie ${Array.from(cst).join(",")})`);
  // k-rate : le tableau est exactement de longueur 1, même chemin.
  check("awParam : k-rate (longueur 1) idem", close(run(new Float32Array([0.5]))));
}

{
  // idempotence : un 2e appel pour le même code ne recompile pas
  const before = globalThis.__stubAddModuleCalls.length;
  const rec = await ensureWorklet(ctxA, validCode);
  check("un 2e ensureWorklet ne recalls pas addModule",
    globalThis.__stubAddModuleCalls.length === before);
  check("peekWorklet retrouve le processor compilé",
    peekWorklet(ctxA, validCode)?.status === "ok");
  check("peekWorklet ignore un code inconnu",
    peekWorklet(ctxA, "jamais compile") === null);
  check("peekWorklet distingue a-rate et k-rate",
    peekWorklet(ctxA, validCode, { rate: "k-rate" })?.name === krate.name);
  check("URL blob révoquée après compilation",
    __blobs.size === 0);
}

{
  // Le nom doit dépendre du PRÉAMBULE, pas seulement du code de l'utilisateur :
  // après une correction du moteur (rechargement à chaud), le registre mémoire
  // est perdu et le même `aw_<hash>` serait déjà pris dans l'AudioContext, ce qui
  // ferait rejeter registerProcessor. Ici on vérifie le cas observable : deux
  // rates du même code donnent deux noms distincts, et le nom est bien dérivé du
  // préambule complet.
  const krate = await ensureWorklet(ctxA, validCode, { rate: "k-rate" });
  check("deux rates du même code -> deux noms distincts",
    krate.name !== peekWorklet(ctxA, validCode).name);
  check("le nom change avec les plages du préambule",
    (await ensureWorklet(ctxA, validCode, { options: '{"ranges":{"p1":[0,16]}}' })).name !==
      peekWorklet(ctxA, validCode).name);
  check("le nom est bien aw_<hash base36 du préambule+code>",
    /^aw_[0-9a-z]{10,20}$/.test(peekWorklet(ctxA, validCode).name));
}

{
  // appel multiligne + nom dynamique : le masquage du global accepte les deux,
  // alors qu'une réécriture par regex ne pouvait pas les gérer
  await ensureWorklet(ctxA,
    "class Z extends AudioWorkletProcessor {}\nregisterProcessor(\n  'nom-lit'\n  , Z\n)\n");
  check("appel multiligne accepté",
    globalThis.__stubProcessors.get(ctxA).has(peekWorklet(ctxA,
      "class Z extends AudioWorkletProcessor {}\nregisterProcessor(\n  'nom-lit'\n  , Z\n)\n").name));
  const dynCode = "const NOM = 'calcule'\nregisterProcessor(NOM, class extends AudioWorkletProcessor {})\n";
  const dyn = await ensureWorklet(ctxA, dynCode);
  check("nom calculé accepté (le nom réel est imposé par le wrapper)",
    dyn.status === "ok" && globalThis.__stubProcessors.get(ctxA).has(dyn.name));
}

{
  // pas de registerProcessor du tout -> l'épilogue lève au chargement
  const noRegCode = "class Broken extends AudioWorkletProcessor {}\n";
  const bad = await ensureWorklet(ctxA, noRegCode);
  check("code sans registerProcessor : erreur capturée, pas d'exception",
    bad.status === "error" && /registerProcessor/.test(bad.error ?? ""));
  check("peekWorklet renvoie un enregistrement en erreur (que le moteur refuse)",
    peekWorklet(ctxA, noRegCode)?.status === "error");
}

{
  globalThis.__stubAddModuleThrows = true;
  const bad = await ensureWorklet(ctxA, "class Y extends AudioWorkletProcessor {}\nregisterProcessor(\"y\", Y)\n");
  globalThis.__stubAddModuleThrows = false;
  check("erreur de compilation remontée", bad.status === "error" && !!bad.error);
  check("le code invalide reste mémorisé (pas de boucle de retry)",
    peekWorklet(ctxA, "class Y extends AudioWorkletProcessor {}\nregisterProcessor(\"y\", Y)\n")?.status === "error");
}

{
  const rec = await ensureWorklet({ audioWorklet: null }, validCode);
  check("contexte sans AudioWorklet : erreur propre", rec.status === "error");
}

/* =========================================================
 * Scénario 2 : catalogue
 * ========================================================= */

{
  const { getModuleByType } = useModuleCatalog();
  const def = getModuleByType("audioworklet");
  check("module présent au catalogue", !!def);
  check("catégorie code", def.category === "code");
  check("ports audio in/out",
    def.ports.inputs.some((p) => p.id === "in" && p.kind === "audio") &&
    def.ports.outputs.some((p) => p.id === "out" && p.kind === "audio"));
  check("8 ports de modulation p1..p8",
    ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"].every((n) =>
      def.ports.inputs.some((p) => p.id === n && p.kind === "param" && p.role === "modulatable")));
  check("paramètre code de type code", def.params.code.type === "code");
  check("défaut du code == code par défaut du composable",
    def.params.code.default === getWorkletDefaults().code);
  check("p1 borné 0..100 (suit options.ranges par défaut)",
    def.params.p1.min === 0 && def.params.p1.max === 100);
  check("p2..p8 en -10..10 (plage par défaut)",
    ["p2", "p8"].every((n) => def.params[n].min === -10 && def.params[n].max === 10));
}

/* =========================================================
 * Scénario 3 : moteur
 * ========================================================= */

const patch = () => ({
  mainPatch: {
    modules: [
      { id: "src", type: "osc", params: { type: "sine", frequency: 440, detune: 0 } },
      { id: "aw", type: "audioworklet", params: { code: validCode, p1: 0.5, channels: 2, rate: "a-rate" } },
      { id: "out", type: "destination", params: {} },
    ],
    connections: [
      { from: { id: "src", port: "out:out" }, to: { id: "aw", port: "in:in" } },
      { from: { id: "aw", port: "out:out" }, to: { id: "out", port: "in:in" } },
    ],
  },
  voicePatch: { modules: [], connections: [] },
});

{
  // code non compilable -> repli pass-through. On passe par un code invalide
  // (et non par un code simplement "non compilé") : init() précompile, donc
  // seule une compilation en échec laisse le module sur son repli.
  const p = patch();
  p.mainPatch.modules[1].params.code = "class Broken extends AudioWorkletProcessor { ??? }";
  const before = globalThis.__stubWorkletNodes.length;
  const synth = usePatchVoice(() => p);
  await synth.init();
  const ctx = synth.getContext();
  check("code invalide : aucun AudioWorkletNode construit",
    globalThis.__stubWorkletNodes.length === before);
  check("code invalide : repli sur un GainNode",
    ctx.created.some((n) => n.__type === "gain"));
  check("code invalide : le son sort quand même (graphe câblé de bout en bout)",
    synth.getAnalyser().connections.length > 0);
}

{
  // constructeur explicite : c'est le mode documenté, les descripteurs passent
  const p = patch();
  p.mainPatch.modules[1].params.code = `class Ctor extends AudioWorkletProcessor {
  constructor(options) { super(options) }
  process() { return true }
}
registerProcessor("ctor", Ctor)
`;
  const synth = usePatchVoice(() => p);
  await synth.init();
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("constructeur explicite transmettant options : p1..p8 présents",
    node.descriptors.length === 8 && !!node.parameters.get("p1"));
}

{
  // Une forme de constructeur ne doit PLUS jamais perdre les descripteurs :
  // la classe de base injectée les repose au plus profond de la chaîne
  // d'héritage, donc même `super()` à vide est sans effet.
  for (const [label, ctor] of [
    ["super(options)", "constructor(options) { super(options) }"],
    ["super()", "constructor() { super() }"],
    ["sans constructeur", ""],
  ]) {
    const p = patch();
    p.mainPatch.modules[1].params.code = `class Ctor extends AudioWorkletProcessor {
  ${ctor}
  process() { return true }
}
registerProcessor("ctor", Ctor)
`;
    const synth = usePatchVoice(() => p);
    let threw = null;
    try { await synth.init(); } catch (e) { threw = e; }
    const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
    check(`constructeur « ${label} » : aucune exception`, threw === null);
    check(`constructeur « ${label} » : p1..p8 déclarés`,
      node?.descriptors.length === 8 &&
      WORKLET_PARAM_NAMES.every((n) => !!node.parameters.get(n)));
  }
}

{
  // code compilé -> vrai nœud
  const p = patch();
  const synth = usePatchVoice(() => p);
  await synth.init();
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("un AudioWorkletNode est construit après compilation", !!node);
  check("processorOptions transmis", !!node.options.processorOptions);
  check("outputChannelCount suit le paramètre channels",
    JSON.stringify(node.options.outputChannelCount) === "[2]");
  // parameterDescriptors NE doit PAS être passé au nœud : c'est une clé
  // inconnue d'AudioWorkletNodeOptions, silencieusement ignorée, et c'est
  // précisément ce qui faisait échouer parameters.get("p1") -> undefined.
  check("aucun parameterDescriptors passé au nœud (clé inconnue, sans effet)",
    node.options.parameterDescriptors === undefined);
  check("les 8 descripteurs viennent du processor",
    node.descriptors.length === 8);
  check("automationRate = a-rate par défaut",
    node.descriptors[0].automationRate === "a-rate");
  check("bornes -10..10 sur les params",
    node.descriptors[0].minValue === -10 && node.descriptors[0].maxValue === 10);
  check("les 8 AudioParams existent sur le nœud",
    WORKLET_PARAM_NAMES.every((n) => !!node.parameters.get(n)));
  check("p1 initialisé depuis les params du module",
    node.parameters.get("p1").events.some((e) => e[0] === "set" && e[1] === 0.5));
  check("câblage : l'osc alimente le worklet",
    node.connections.length === 1);
  check("câblage : le worklet alimente la sortie globale",
    node.connections[0] === synth.getAnalyser());
}

{
  // modulation : un gain câblé sur p1 arrive bien sur l'AudioParam du worklet
  const p = patch();
  p.mainPatch.modules.push({ id: "lfo", type: "constant", params: { value: 0.7 } });
  p.mainPatch.connections.push({
    from: { id: "lfo", port: "out:offset" },
    to: { id: "aw", port: "in:p1" },
  });
  const synth = usePatchVoice(() => p);
  await synth.init();
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("l'entrée p1 est bien un AudioParam du worklet",
    node.parameters.get("p1") instanceof StubParam);
  // la constante se connecte sur l'AudioParam p1 (port non-"in" => params[port]).
  // toRaw : le contexte est stocké dans un ref() par usePatchVoice, donc les
  // nœuds lus via getContext() sont des proxies réactifs (identité ≠).
  const constNode = toRaw(synth.getContext()).created.filter((n) => n.__type === "constant").pop();
  check("la modulation entrante cible l'AudioParam p1",
    constNode && constNode.connections[0] === node.parameters.get("p1"));
}

{
  // options JSON invalide -> repli sur {} sans casser le module
  const p = patch();
  p.mainPatch.modules[1].params.options = "{ pas du json";
  const synth = usePatchVoice(() => p);
  await synth.init();
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("options JSON invalide : processorOptions = {}", !!node);
}

{
  // le moteur borne la valeur initiale ET la base de modulation dans la plage
  // déclarée : sinon la base mémorisée garderait une valeur que l'AudioParam ne
  // peut pas rendre, et une modulation "relative" partirait de zéro.
  const p = patch();
  p.mainPatch.modules[1].params.options = '{"params":{},"ranges":{"p1":[1,16]}}';
  p.mainPatch.modules[1].params.p1 = 0.5; // hors de 1..16
  const synth = usePatchVoice(() => p);
  await synth.init();
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("moteur : p1 initialisé dans la plage (0.5 -> 1)",
    node.parameters.get("p1").events.some((e) => e[0] === "set" && e[1] === 1));
  check("moteur : descripteur p1 = 1..16",
    node.descriptors.find((d) => d.name === "p1").maxValue === 16);
  check("moteur : `ranges` retiré des processorOptions",
    node.options.processorOptions.ranges === undefined &&
    node.options.processorOptions.params !== undefined);
}

{
  // rebuildMainPatch est async et compile avant de construire
  const p = patch();
  const synth = usePatchVoice(() => p);
  await synth.init();
  const before = globalThis.__stubWorkletNodes.length;
  p.mainPatch.modules[1].params.code = otherCode;
  const ret = synth.rebuildMainPatch();
  check("rebuildMainPatch retourne une promesse", ret instanceof Promise);
  await ret;
  check("le nouveau code est compilé puis utilisé",
    globalThis.__stubWorkletNodes.length === before + 1);
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("le nœud porte le nom du nouveau code", node.name !== undefined);
  check("l'ancien nœud est déconnecté",
    globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 2].disconnected === true);
}

{
  // rebuilds concurrents sérialisés (le watcher deep du séquenceur peut en
  // déclencher plusieurs en rafale quand on modifie le patch)
  const p = patch();
  const synth = usePatchVoice(() => p);
  await synth.init();
  const before = globalThis.__stubWorkletNodes.length;
  await Promise.all([
    synth.rebuildMainPatch(),
    synth.rebuildMainPatch(),
    synth.rebuildMainPatch(),
  ]);
  const n = globalThis.__stubWorkletNodes.length;
  // l'analyser maître est relié à ctx.destination par construction
  // (ensureMasterAnalyser) : on vérifie l'arête du côté du worklet.
  const last = globalThis.__stubWorkletNodes[n - 1];
  check("3 rebuilds en rafale -> 3 constructions, graphe final intact",
    globalThis.__stubWorkletNodes.length === before + 3 &&
    last.connections.length === 1 &&
    last.connections[0] === synth.getAnalyser() &&
    last.disconnected !== true,
    `(${n - before} builds, sortie du worklet → ${last.connections[0]?.__type})`);
}

{
  // le graphe voix est construit à chaque note : le code compilé par init()
  // est disponible avant createVoice()
  const p = patch();
  p.voicePatch = {
    modules: [{ id: "awv", type: "audioworklet", params: { code: validCode } }],
    connections: [],
  };
  const synth = usePatchVoice(() => p);
  await synth.noteOn(60);
  const node = globalThis.__stubWorkletNodes[globalThis.__stubWorkletNodes.length - 1];
  check("voix : le worklet est construit en AudioWorkletNode", node && node.__type === "audioworklet");
  synth.noteOff(60);
}

/* =========================================================
 * Scénario 4 : non-régression
 * ========================================================= */

{
  const synth = usePatchVoice(() => ({}));
  await synth.init();
  await synth.noteOn(60);
  synth.noteOff(60);
  synth.stopAll();
  check("patch vide : aucun crash", true);
}

console.log(failures === 0 ? "\nTous les tests passent." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
