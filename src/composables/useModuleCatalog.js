// composables/useModuleCatalog.js
import { reactive, readonly } from "vue";
import {
  getWorkletDefaults,
} from "./useAudioWorklet.js";
import { DEFAULT_WAVESHAPER_CURVE } from "./useWaveshaperCurve.js";
import { emptyGraph, emptySynthPatch } from "./useSynthPatch.js";

/* Le code et la config par défaut vivent dans useAudioWorklet.js (c'est lui
 * qui empaquette le source en Blob) : on les récupère ici pour les insérer
 * comme valeurs par défaut du descripteur `audioworklet`. */
const { code: DEFAULT_WORKLET_CODE, options: DEFAULT_WORKLET_OPTIONS } =
  getWorkletDefaults();

// Ports de modulation exposés par le module AudioWorklet. Volontairement
// fixes et nommés : c'est ce qui permet à `wireConnection` de les traiter
// comme les AudioParams de n'importe quel autre module.
const WORKLET_PARAMS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"];

/* =========================================================
 * CATALOG (singleton au niveau module)
 * Nécessaire pour que l'enregistrement dynamique des
 * super-modules soit visible dans tous les composants.
 * ========================================================= */

const catalog = reactive({
    /* =========================
     * SOURCES
     * ========================= */

    voice: {
      label: "Voice",
      color: "#9c9c05",
      category: "source",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "frequency",
            label: "Freq",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
          {
            id: "detune",
            label: "Detune",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        detune: num(-1200, 1200, 1, 0),
        delay: num(0, 5, 0.001, 0),
        type: {
          type: "enum",
          values: ["sine", "triangle", "square", "sawtooth"],
          default: "sine",
        },
      },
    },
    wavetable: {
      label: "Wavetable",
      color: "#2E8B57",
      category: "source",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "frequency",
            label: "Freq",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
          {
            id: "detune",
            label: "Detune",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        detune: num(-1200, 1200, 1, 0),
        delay: num(0, 5, 0.001, 0),
        wave: {
          type: "json",
          jsonKeys: ["real", "imag"],
          default:
            '{"real":[0,0,0,0,0,0,0,0],"imag":[0,1,0.5,0.333,0.25,0.2,0.167,0.143],"disableNormalization":true}',
        },
      },
    },
    wavetableS: {
      label: "WavetableS",
      color: "#3F8F7B",
      category: "source",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "frequency",
            label: "Freq",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
          {
            id: "detune",
            label: "Detune",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        detune: num(-1200, 1200, 1, 0),
        delay: num(0, 5, 0.001, 0),
        morph: {
          ...num(1, 60000, 1, 200),
          unit: "ms",
        },
        endMode: {
          type: "enum",
          values: ["loop", "pingpong"],
          default: "loop",
        },
        // Progression du balayage dans la table (répartition temporelle des
        // frames) — garder en phase avec EASINGS dans usePatchVoice.js.
        progression: {
          type: "enum",
          values: [
            "linear",
            "sine-in",
            "sine-out",
            "sine-inout",
            "quad-in",
            "quad-out",
            "quad-inout",
            "cubic-in",
            "cubic-out",
            "cubic-inout",
            "quart-in",
            "quart-out",
            "quart-inout",
            "quint-in",
            "quint-out",
            "quint-inout",
            "expo-in",
            "expo-out",
            "expo-inout",
            "circ-in",
            "circ-out",
            "circ-inout",
            "back-in",
            "back-out",
            "back-inout",
            "elastic-in",
            "elastic-out",
            "elastic-inout",
            "bounce-in",
            "bounce-out",
            "bounce-inout",
          ],
          default: "linear",
        },
        wave: {
          type: "json",
          jsonFrames: true,
          default:
            '[{"real":[0,0,0,0,0,0,0,0],"imag":[0,1,0.5,0.333,0.25,0.2,0.167,0.143]},{"real":[0,0,0,0,0,0,0,0],"imag":[0,1,0,0,0,0,0,0]}]',
        },
      },
    },
    fx: {
      label: "FX / Sample",
      color: "#9c6a00",
      category: "source",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "frequency",
            label: "Freq",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
          {
            id: "detune",
            label: "Detune",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        buffer: {
          type: "audioFile",
          default: null,
        },
        detune: num(-1200, 1200, 1, 0),
        delay: num(0, 5, 0.001, 0),
        loop: {
          type: "boolean",
          default: false,
        },
        start: {
          ...num(0, 600000, 1, 0),
          unit: "ms",
        },
        end: {
          ...num(0, 600000, 1, 0),
          unit: "ms",
        },
      },
    },
    osc: {
      label: "Oscillator",
      color: "#9c6a00",
      category: "source",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "frequency",
            label: "Freq",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
          {
            id: "detune",
            label: "Detune",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        frequency: num(0.01, 20000, 1, 4),
        detune: num(-1200, 1200, 1, 0),
        delay: num(0, 5, 0.001, 0),
        type: {
          type: "enum",
          values: ["sine", "triangle", "square", "sawtooth"],
          default: "sine",
        },
      },
    },

    /* =========================
     * GAIN (audio + modulator)
     * ========================= */

    gain: {
      label: "Gain",
      color: "#2C7BE5",
      category: "utility",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          {
            id: "gain",
            label: "Gain",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "modulator", // 👈 clé : seule source de modulation autorisée
            multiple: true,
          },
        ],
      },

      params: {
        gain: num(0, 1, 0.01, 0.5),
      },
    },

    /* =========================
     * DELAY
     * ========================= */

    delay: {
      label: "Delay",
      color: "#845EC2",
      category: "time",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          {
            id: "delayTime",
            label: "Time",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        delayTime: num(0, 5, 0.01, 0.3),
      },
    },

    /* =========================
     * FILTERS (BIQUAD)
     * ========================= */

    filter_lowpass: createFilter("Lowpass", ["frequency", "Q"]),
    filter_highpass: createFilter("Highpass", ["frequency", "Q"]),
    filter_bandpass: createFilter("Bandpass", ["frequency", "Q"]),
    filter_notch: createFilter("Notch", ["frequency", "Q"]),
    filter_peaking: createFilter("Peaking", ["frequency", "Q", "gain"]),
    filter_lowshelf: createFilter("LowShelf", ["frequency", "gain"]),
    filter_highshelf: createFilter("HighShelf", ["frequency", "gain"]),

    /* =========================
     * COMPRESSOR
     * ========================= */

    compressor: {
      label: "Compressor",
      color: "#FF9671",
      category: "dynamics",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          ...paramPorts(["threshold", "knee", "ratio", "attack", "release"]),
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        threshold: num(-100, 0, 1, -24),
        knee: num(0, 40, 1, 30),
        ratio: num(1, 20, 0.1, 12),
        attack: num(0, 1, 0.001, 0.003),
        release: num(0, 1, 0.001, 0.25),
      },
    },

    /* =========================
     * CONVOLVER
     * ========================= */

    convolver: {
      label: "Convolver",
      color: "#6B5B95",
      category: "effect",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        buffer: {
          type: "audioFile",
          default: null, // string | null
        },
        normalize: {
          type: "boolean",
          default: true,
        },
      },
    },

    /* =========================
     * WAVESHAPER (distorsion / courbe libre)
     * La courbe est un code JavaScript éditable dans le panneau (comme le DSP
     * d'un AudioWorklet) : tanh par défaut, mais n'importe quel transfert
     * arbitraire est possible. Le drive est un pré-gain devant la courbe :
     * c'est un vrai AudioParam, donc modulable par une enveloppe/CV.
     * ========================= */

    waveshaper: {
      label: "WaveShaper",
      color: "#E67E22",
      category: "effect",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          {
            id: "drive",
            label: "Drive",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        curve: {
          type: "code",
          default: DEFAULT_WAVESHAPER_CURVE,
          rows: 18,
        },
        drive: num(0, 10, 0.01, 1),
        oversample: {
          type: "enum",
          values: ["none", "2x", "4x"],
          default: "none",
        },
      },
    },

    /* =========================
     * ROUTING : SPLITTER / MERGER
     * ========================= */

    channelSplitter: {
      label: "Splitter",
      color: "#00BCD4",
      category: "routing",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
        ],
        outputs: [0, 1, 2, 3].map((ch) => ({
          id: String(ch),
          label: "Ch " + ch,
          kind: "audio",
          role: "audioOut",
          multiple: true,
        })),
      },

      params: {},
    },

    channelMerger: {
      label: "Merger",
      color: "#8BC34A",
      category: "routing",
      singleton: false,

      ports: {
        inputs: [0, 1, 2, 3].map((ch) => ({
          id: String(ch),
          label: "Ch " + ch,
          kind: "audio",
          role: "audioIn",
          multiple: true,
        })),
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {},
    },

    /* =========================
     * SPATIAL : PANNER / STEREO PANNER
     * ========================= */

    panner: {
      label: "Panner",
      color: "#FF6FB5",
      category: "spatial",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          ...paramPorts([
            "positionX",
            "positionY",
            "positionZ",
            "orientationX",
            "orientationY",
            "orientationZ",
          ]),
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        panningModel: {
          type: "enum",
          values: ["equalpower", "HRTF"],
          default: "equalpower",
        },
        distanceModel: {
          type: "enum",
          values: ["linear", "inverse", "exponential"],
          default: "inverse",
        },
        positionX: num(-100, 100, 0.1, 0),
        positionY: num(-100, 100, 0.1, 0),
        positionZ: num(-100, 100, 0.1, 1),
        orientationX: num(-1, 1, 0.01, 1),
        orientationY: num(-1, 1, 0.01, 0),
        orientationZ: num(-1, 1, 0.01, 0),
        refDistance: num(0.0001, 1000, 0.1, 1),
        maxDistance: num(0.0001, 20000, 1, 10000),
        rolloffFactor: num(0, 10, 0.01, 1),
        coneInnerAngle: num(0, 360, 1, 360),
        coneOuterAngle: num(0, 360, 1, 360),
        coneOuterGain: num(0, 1, 0.01, 0),
      },
    },

    stereoPanner: {
      label: "Stereo Panner",
      color: "#FF9671",
      category: "spatial",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          {
            id: "pan",
            label: "Pan",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        pan: num(-1, 1, 0.01, 0),
      },
    },

    /* =========================
     * ENVELOPE (modulator pur)
     * ========================= */

    envelope: {
      label: "Envelope",
      color: "#00C9A7",
      category: "control",
      singleton: false,

      ports: {
        inputs: [],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "param",
            role: "modulator",
            rate: "a-rate",
            multiple: true,
          },
        ],
      },

      params: {
         modulation: {
          type: "enum",
          values: ["replace", "relative"],
          default: "relative",
        },

        stages: {
          type: "envelope",
          default: {
            loop: false,
            press: [
              {
                from: 0,
                to: 1,
                duration: 0.05,
                curve: "exponential",
              },
              {
                from: 1,
                to: 0.75,
                duration: 0.3,
                curve: "linear",
              },
              {
                from: 0.75,
                to: 0.75,
                duration: 0.3,
                curve: "linear",
              },
              {
                from: 0.75,
                to: 0,
                duration: 0.7,
                curve: "linear",
              },
            ],
            release: [
              {
                from: "current",
                to: 0,
                duration: 0.4,
                curve: "linear",
              },
            ],
          },
        },
      },
    },

    /* =========================
 * CONSTANT (modulator pur)
 * ========================= */

    constant: {
      label: "Constant",
      color: "#4D96FF",
      category: "control",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "Offset",
            kind: "param",
            role: "modulatable",
            rate: "a-rate",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "offset",
            label: "Offset",
            kind: "param",
            role: "modulator",
            rate: "a-rate",
            multiple: true,
          },
        ],
      },

      params: {
        value: {
          type: "number",
          min: -1000,
          max: 1000,
          step: 0.001,
          default: 1,
        },
      },
    },


    /* =========================
     * SUPER MODULES (interfaces)
     * Placés à l'intérieur d'un super-module :
     *  - super.in  = point d'entrée exposé sur le module externe
     *  - super.out = point de sortie exposé sur le module externe
     * Le paramètre "name" devient l'id du port externe.
     * ========================= */

    "super.in": {
      label: "Super In",
      color: "#1ABC9C",
      category: "interface",
      singleton: false,

      ports: {
        inputs: [],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        name: { type: "string", default: "in" },
      },
    },

    "super.out": {
      label: "Super Out",
      color: "#E74C3C",
      category: "interface",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
        ],
        outputs: [],
      },

      params: {
        name: { type: "string", default: "out" },
      },
    },

    /* =========================
     * DESTINATION
     * ========================= */

    destination: {
      label: "Output",
      color: "#222222",
      category: "output",
      singleton: true,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
        ],
        outputs: [],
      },

      params: {},
    },

    /* =========================
     * AUDIOWORKLET
     *
     * Traitement maison : le DSP est écrit dans le textarea du panneau de
     * propriétés (paramètre `code`) puis compilé à partir de cette chaîne
     * (voir useAudioWorklet.js). Le module n'expose que in/out côté audio ;
     * p1..p8 sont de vrais AudioParams, donc câblables comme n'importe quel
     * autre port modulable du catalogue.
     * ========================= */

    audioworklet: {
      label: "AudioWorklet",
      color: "#E8A33D",
      category: "code",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          ...paramPorts(WORKLET_PARAMS),
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            // modulateur : la sortie peut alimenter un AudioParam comme
            // celle de `gain` (filtrage audio-rate, etc.)
            role: "modulator",
            multiple: true,
          },
        ],
      },

      params: {
        code: {
          type: "code",
          default: DEFAULT_WORKLET_CODE,
          rows: 18,
        },
        rate: {
          type: "enum",
          values: ["a-rate", "k-rate"],
          default: "a-rate",
        },
        channels: {
          type: "enum",
          values: [1, 2],
          default: 1,
        },
        options: {
          type: "json",
          default: DEFAULT_WORKLET_OPTIONS,
        },
        // p1 est le gain du code de départ : 0 = silence, 1 = bypass, >1 =
        // amplification. Sa plage suit celle déclarée dans `options.ranges`
        // (0..100), sinon l'AudioParam bornerait le knob à la valeur par
        // défaut du navigateur.
        ...Object.fromEntries(
          WORKLET_PARAMS.map((n) => [
            n,
            n === "p1" ? num(0, 100, 0.001, 1) : num(-10, 10, 0.001, 0),
          ]),
        ),
      },
    },

    /* =========================
     * SYNTH (niveau SynthPatch uniquement)
     *
     * Nœud composite : il expose l'entrée principale et la sortie d'un
     * synthé complet. La définition (voicePatch + mainPatch) est embarquée
     * dans les params pour que chaque instance soit indépendante.
     * ========================= */

    synth: {
      label: "Synth",
      color: "#8E44AD",
      category: "synth",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        name: { type: "string", default: "Synth" },
        voicePatch: { type: "json", default: emptyGraph() },
        mainPatch: { type: "json", default: emptyGraph() },
      },
    },

    /* =========================
     * SUPER-SYNTH (niveau SynthPatch uniquement)
     *
     * SynthPatch complet réutilisable. Il expose une entrée/un sortie audio
     * (super.in / super.out dans sa couche main) et propage les notes à ses
     * synthés internes. Deux instances ont des moteurs indépendants.
     * ========================= */

    superSynth: {
      label: "SuperSynth",
      color: "#6C3483",
      category: "synth",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {
        name: { type: "string", default: "SuperSynth" },
        synthPatch: { type: "json", default: emptySynthPatch() },
      },
    },

    input: {
      label: "Input",
      color: "#222222",
      category: "input",
      singleton: true,

      ports: {
        inputs: [],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: {},
    },

  });

  /* =========================
   * HELPERS
   * (hoistées : utilisables dans l'init du catalogue)
   * ========================= */

  function num(min, max, step, def) {
    return { type: "number", min, max, step, default: def };
  }

  function paramPorts(names) {
    return names.map((name) => ({
      id: name,
      label: name,
      kind: "param",
      role: "modulatable",
      rate: "a-rate",
      multiple: true,
    }));
  }

  function createFilter(label, paramNames) {
    return {
      label,
      color: "#FFC75F",
      category: "filter",
      singleton: false,

      ports: {
        inputs: [
          {
            id: "in",
            label: "In",
            kind: "audio",
            role: "audioIn",
            multiple: true,
          },
          ...paramPorts(paramNames),
        ],
        outputs: [
          {
            id: "out",
            label: "Out",
            kind: "audio",
            role: "audioOut",
            multiple: true,
          },
        ],
      },

      params: Object.fromEntries(
        paramNames.map((p) => {
          if (p === "frequency") return [p, num(20, 20000, 1, 1000)];
          if (p === "Q") return [p, num(0.0001, 100, 0.01, 1)];
          if (p === "gain") return [p, num(-40, 40, 0.1, 0)];
        }),
      ),
    };
  }

  /* =========================
   * PUBLIC API
   * ========================= */

  const getCatalog = () => readonly(catalog);
  const getModuleByType = (type) => catalog[type];
  const getModuleTypes = () => Object.keys(catalog);

  /**
   * Enregistre dynamiquement un type de module
   * (utilisé par les super-modules).
   */
  const registerModuleType = (type, def) => {
    if (!type || !def) return;
    catalog[type] = { ...def };
  };

  const unregisterModuleType = (type) => {
    delete catalog[type];
  };

export function useModuleCatalog() {
  return {
    getCatalog,
    getModuleByType,
    getModuleTypes,
    registerModuleType,
    unregisterModuleType,
  };
}