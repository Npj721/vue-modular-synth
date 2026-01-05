// composables/useModuleCatalog.js
import { reactive, readonly } from 'vue'

export function useModuleCatalog() {
  const catalog = reactive({
    osc: {
      label: 'Oscillator',
      color: '#FF7BE5',

      // 🔌 Ports
      inputs: [
        { id: 'freq', label: 'FM', kind: 'cv' },
        { id: 'detune', label: 'Detune', kind: 'cv' }
      ],
      outputs: [
        { id: 'out', label: 'Out', kind: 'audio' }
      ],

      // 🎛️ Paramètres UI
      params: {
        freq: {
          type: 'number',
          min: 20,
          max: 20000,
          step: 1,
          default: 440
        },
        type: {
          type: 'enum',
          values: ['sine', 'triangle', 'square', 'sawtooth'],
          default: 'sine'
        }
      }
    },

    gain: {
      label: 'Gain',
      color: '#2C7BE5',

      inputs: [
        { id: 'in', label: 'In', kind: 'audio' }
      ],
      outputs: [
        { id: 'out', label: 'Out', kind: 'audio' }
      ],

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

    filter: {
      label: 'Filter',
      color: '#FFC75F',

      inputs: [
        { id: 'in', label: 'In', kind: 'audio' },
        { id: 'freq', label: 'Freq', kind: 'cv' }
      ],
      outputs: [
        { id: 'out', label: 'Out', kind: 'audio' }
      ],

      params: {
        type: {
          type: 'enum',
          values: ['lowpass', 'highpass', 'bandpass'],
          default: 'lowpass'
        },
        freq: {
          type: 'number',
          min: 20,
          max: 20000,
          step: 1,
          default: 1000
        },
        Q: {
          type: 'number',
          min: 0.0001,
          max: 100,
          step: 0.01,
          default: 1
        }
      }
    }
  })

  // 🔍 API publique

  const getCatalog = () => readonly(catalog)

  const getModuleByType = (type) => catalog[type]

  const getModuleTypes = () => Object.keys(catalog)

  return {
    getCatalog,
    getModuleByType,
    getModuleTypes
  }
}
