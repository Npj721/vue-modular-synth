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
            rate: 'a-rate',
            multiple: true
          },
          {
            id: 'detune',
            label: 'Detune',
            kind: 'param',
            rate: 'a-rate',
            multiple: true
          }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            kind: 'audio',
            multiple: true
          }
        ]
      },

      params: {
        frequency: {
          type: 'number',
          min: 20,
          max: 20000,
          step: 1,
          default: 440
        },
        detune: {
          type: 'number',
          min: -1200,
          max: 1200,
          step: 1,
          default: 0
        },
        type: {
          type: 'enum',
          values: ['sine', 'triangle', 'square', 'sawtooth'],
          default: 'sine'
        }
      }
    },

    /* =========================
     * GAIN
     * ========================= */

    gain: {
      label: 'Gain',
      color: '#2C7BE5',
      category: 'utility',
      singleton: false,

      ports: {
        inputs: [
          { id: 'in', label: 'In', kind: 'audio', multiple: true },
          { id: 'gain', label: 'Gain', kind: 'param', rate: 'a-rate', multiple: true }
        ],
        outputs: [
          { id: 'out', label: 'Out', kind: 'audio', multiple: true }
        ]
      },

      params: {
        gain: {
          type: 'number',
          min: 0,
          max: 1,
          step: 0.01,
          default: 0.5
        }
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
          { id: 'in', label: 'In', kind: 'audio', multiple: true },
          { id: 'delayTime', label: 'Time', kind: 'param', rate: 'a-rate', multiple: true }
        ],
        outputs: [
          { id: 'out', label: 'Out', kind: 'audio', multiple: true }
        ]
      },

      params: {
        delayTime: {
          type: 'number',
          min: 0,
          max: 5,
          step: 0.01,
          default: 0.3
        }
      }
    },

    /* =========================
     * FILTERS (BIQUAD)
     * ========================= */

    filter_lowpass: createFilter('Lowpass', 'lowpass', ['frequency', 'Q']),
    filter_highpass: createFilter('Highpass', 'highpass', ['frequency', 'Q']),
    filter_bandpass: createFilter('Bandpass', 'bandpass', ['frequency', 'Q']),
    filter_notch: createFilter('Notch', 'notch', ['frequency', 'Q']),
    filter_peaking: createFilter('Peaking', 'peaking', ['frequency', 'Q', 'gain']),
    filter_lowshelf: createFilter('LowShelf', 'lowshelf', ['frequency', 'gain']),
    filter_highshelf: createFilter('HighShelf', 'highshelf', ['frequency', 'gain']),

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
          { id: 'in', label: 'In', kind: 'audio', multiple: true },
          ...paramPorts(['threshold', 'knee', 'ratio', 'attack', 'release'])
        ],
        outputs: [
          { id: 'out', label: 'Out', kind: 'audio', multiple: true }
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
          { id: 'in', label: 'In', kind: 'audio', multiple: true }
        ],
        outputs: [
          { id: 'out', label: 'Out', kind: 'audio', multiple: true }
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
     * ENVELOPE
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
          { id: 'in', label: 'In', kind: 'audio', multiple: true }
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
      rate: 'a-rate',
      multiple: true
    }))
  }

  function createFilter(label, type, paramNames) {
    return {
      label,
      color: '#FFC75F',
      category: 'filter',
      singleton: false,

      ports: {
        inputs: [
          { id: 'in', label: 'In', kind: 'audio', multiple: true },
          ...paramPorts(paramNames)
        ],
        outputs: [
          { id: 'out', label: 'Out', kind: 'audio', multiple: true }
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
