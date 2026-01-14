function midiToFreq(note) {
  return 440 * Math.pow(2, (note - 69) / 12)
}

export function usePatchVoice(audioCtx, patch) {
  const nodes = new Map()
  const envelopes = []
  let oscillators = []
  let started = false

  // =====================
  // Create modules
  // =====================
  for (const mod of patch.modules) {
    switch (mod.type) {
      case 'voice': {
        const osc = audioCtx.createOscillator()
        osc.type = mod.params.type
        osc.detune.value = mod.params.detune ?? 0
        nodes.set(mod.id, osc)
        oscillators.push(osc)
        break
      }

      case 'osc': {
        const osc = audioCtx.createOscillator()
        osc.type = mod.params.type
        osc.frequency.value = mod.params.frequency
        osc.detune.value = mod.params.detune ?? 0
        nodes.set(mod.id, osc)
        oscillators.push(osc)
        break
      }

      case 'gain': {
        const g = audioCtx.createGain()
        g.gain.value = mod.params.gain ?? 1
        nodes.set(mod.id, g)
        break
      }

      case 'envelope': {
        nodes.set(mod.id, {
          type: 'envelope',
          stages: mod.params.stages
        })
        break
      }

      case 'destination': {
        nodes.set(mod.id, audioCtx.destination)
        break
      }
    }
  }

  // =====================
  // Connect graph
  // =====================
  for (const c of patch.connections) {
    const src = nodes.get(c.from.id)
    const dst = nodes.get(c.to.id)
    const [, dstPort] = c.to.port.split(':')

    if (!src || !dst) continue

    // envelope → AudioParam
    if (src.type === 'envelope' && dst instanceof AudioNode) {
      envelopes.push({
        envelope: src,
        param: dst[dstPort]
      })
    }

    // audio → AudioParam (LFO, etc.)
    else if (dst instanceof AudioNode && dst[dstPort] instanceof AudioParam) {
      src.connect(dst[dstPort])
    }

    // audio → audio
    else if (src.connect && dst.connect) {
      src.connect(dst)
    }
  }

  // =====================
  // Runtime
  // =====================
  function start(note, velocity = 1) {
    if (started) stop()

    const t0 = audioCtx.currentTime
    const freq = midiToFreq(note)

    oscillators.forEach(osc => {
      if (osc.frequency) osc.frequency.setValueAtTime(freq, t0)
      osc.start(t0)
    })

    envelopes.forEach(({ envelope, param }) => {
      applyEnvelope(param, envelope.stages.press, t0)
    })

    started = true
  }

  function stop() {
    if (!started) return

    const t0 = audioCtx.currentTime
    let maxRelease = 0

    envelopes.forEach(({ envelope, param }) => {
      const tEnd = applyEnvelope(param, envelope.stages.release, t0)
      maxRelease = Math.max(maxRelease, tEnd - t0)
    })

    oscillators.forEach(osc => {
      osc.stop(t0 + maxRelease + 0.01)
    })

    started = false
  }

  function dispose() {
    stop()
    oscillators = []
    nodes.clear()
  }

  return { start, stop, dispose }
}
