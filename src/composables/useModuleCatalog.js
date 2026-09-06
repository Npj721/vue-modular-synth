// composables/useModuleCatalog.js
import { reactive, readonly } from "vue";

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
        frequency: num(20, 20000, 1, 440),
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
        inputs: [],
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

        modulation: {
          type: "enum",
          values: ["replace", "relative"],
          default: "relative",
        },

        stages: {
          type: "envelope",
          default: {
            press: [
              {
                from: 0,
                to: 1,
                duration: 0.05,
                curve: "linear",
              },
            ],
            release: [
              {
                from: "current",
                to: 0,
                duration: 0.2,
                curve: "linear",
              },
            ],
          },
        },

        loop: {
          type: "object",
          default: {
            enabled: false,
            start: 0,
            end: 0,
          },
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