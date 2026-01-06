// composables/useModuleCatalog.js
import { reactive, readonly } from 'vue'

export function useModuleCatalog() {
  const catalog = reactive({

    /* =========================
     * SOURCES
     * ========================= */

    osc: {
      label: 'Oscillator',
      color: '#FF7BE5',
      category: 'source',
      singleton: false,

      ports: {
        inputs: [
          {
            id: 'frequency',
            label: 'Freq',
            kind: 'param',
            role: 'modulatable',
            rate: 'a-rate',
            multiple: true
          },
          {
            id: 'detune',
            label: 'Detune',
            kind: 'param',
            role: 'modulatable',
            rate: 'a-rate',
            multiple: true
          }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            role: 'audioOut',
            multiple: true
          }
        ]
      },

      params: {
        frequency: num(20, 20000, 1, 440),
        detune: num(-1200, 1200, 1, 0),
        type: {
          type: 'enum',
          values: ['sine', 'triangle', 'square', 'sawtooth'],
          default: 'sine'
        }
      }
    },

    /* =========================
     * GAIN (audio + modulator)
     * ========================= */

    gain: {
      label: 'Gain',
      color: '#2C7BE5',
      category: 'utility',
      singleton: false,

      ports: {
        inputs: [
          {
            id: 'in',
            label: 'In',
            kind: 'audio',
            role: 'audioIn',
            multiple: true
          },
          {
            id: 'gain',
            label: 'Gain',
            kind: 'param',
            role: 'modulatable',
            rate: 'a-rate',
            multiple: true
          }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            role: 'modulator', // 👈 clé : seule source de modulation autorisée
            multiple: true
          }
        ]
      },

      params: {
        gain: num(0, 1, 0.01, 0.5)
      }
    },

    /* =========================
     * DELAY
     * ========================= */

    delay: {
      label: 'Delay',
      color: '#845EC2',
      category: 'time',
      singleton: false,

      ports: {
        inputs: [
          {
            id: 'in',
            label: 'In',
            kind: 'audio',
            role: 'audioIn',
            multiple: true
          },
          {
            id: 'delayTime',
            label: 'Time',
            kind: 'param',
            role: 'modulatable',
            rate: 'a-rate',
            multiple: true
          }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            role: 'audioOut',
            multiple: true
          }
        ]
      },

      params: {
        delayTime: num(0, 5, 0.01, 0.3)
      }
    },

    /* =========================
     * FILTERS (BIQUAD)
     * ========================= */

    filter_lowpass: createFilter('Lowpass', ['frequency', 'Q']),
    filter_highpass: createFilter('Highpass', ['frequency', 'Q']),
    filter_bandpass: createFilter('Bandpass', ['frequency', 'Q']),
    filter_notch: createFilter('Notch', ['frequency', 'Q']),
    filter_peaking: createFilter('Peaking', ['frequency', 'Q', 'gain']),
    filter_lowshelf: createFilter('LowShelf', ['frequency', 'gain']),
    filter_highshelf: createFilter('HighShelf', ['frequency', 'gain']),

    /* =========================
     * COMPRESSOR
     * ========================= */

    compressor: {
      label: 'Compressor',
      color: '#FF9671',
      category: 'dynamics',
      singleton: false,

      ports: {
        inputs: [
          {
            id: 'in',
            label: 'In',
            kind: 'audio',
            role: 'audioIn',
            multiple: true
          },
          ...paramPorts(['threshold', 'knee', 'ratio', 'attack', 'release'])
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            role: 'audioOut',
            multiple: true
          }
        ]
      },

      params: {
        threshold: num(-100, 0, 1, -24),
        knee: num(0, 40, 1, 30),
        ratio: num(1, 20, 0.1, 12),
        attack: num(0, 1, 0.001, 0.003),
        release: num(0, 1, 0.001, 0.25)
      }
    },

    /* =========================
     * CONVOLVER
     * ========================= */

    convolver: {
      label: 'Convolver',
      color: '#4D8076',
      category: 'fx',
      singleton: false,

      ports: {
        inputs: [
          {
            id: 'in',
            label: 'In',
            kind: 'audio',
            role: 'audioIn',
            multiple: true
          }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            role: 'audioOut',
            multiple: true
          }
        ]
      },

      params: {
        buffer: {
          type: 'file',
          accept: ['audio/*']
        }
      }
    },

    /* =========================
     * ENVELOPE (modulator pur)
     * ========================= */

    envelope: {
      label: 'Envelope',
      color: '#00C9A7',
      category: 'control',
      singleton: false,

      ports: {
        inputs: [],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'param',
            role: 'modulator',
            rate: 'a-rate',
            multiple: true
          }
        ]
      },

      params: {
        stages: {
          type: 'envelope',
          default: [
            { from: 0, to: 1, duration: 0.01 },
            { from: 1, to: 0, duration: 0.3 }
          ]
        }
      }
    },

    /* =========================
     * DESTINATION
     * ========================= */

    destination: {
      label: 'Output',
      color: '#222222',
      category: 'output',
      singleton: true,

      ports: {
        inputs: [
          {
            id: 'in',
            label: 'In',
            kind: 'audio',
            role: 'audioIn',
            multiple: true
          }
        ],
        outputs: []
      },

      params: {}
    }
  })

  /* =========================
   * HELPERS
   * ========================= */

  function num(min, max, step, def) {
    return { type: 'number', min, max, step, default: def }
  }

  function paramPorts(names) {
    return names.map(name => ({
      id: name,
      label: name,
      kind: 'param',
      role: 'modulatable',
      rate: 'a-rate',
      multiple: true
    }))
  }

  function createFilter(label, paramNames) {
    return {
      label,
      color: '#FFC75F',
      category: 'filter',
      singleton: false,

      ports: {
        inputs: [
          {
            id: 'in',
            label: 'In',
            kind: 'audio',
            role: 'audioIn',
            multiple: true
          },
          ...paramPorts(paramNames)
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            role: 'audioOut',
            multiple: true
          }
        ]
      },

      params: Object.fromEntries(
        paramNames.map(p => {
          if (p === 'frequency') return [p, num(20, 20000, 1, 1000)]
          if (p === 'Q') return [p, num(0.0001, 100, 0.01, 1)]
          if (p === 'gain') return [p, num(-40, 40, 0.1, 0)]
        })
      )
    }
  }

  /* =========================
   * PUBLIC API
   * ========================= */

  const getCatalog = () => readonly(catalog)
  const getModuleByType = (type) => catalog[type]
  const getModuleTypes = () => Object.keys(catalog)

  return {
    getCatalog,
    getModuleByType,
    getModuleTypes
  }
}
