import { ref } from "vue"

/* =========================================================
 * Utils
 * ========================================================= */
const noteToFreq = (note) =>
  440 * Math.pow(2, (note - 69) / 12)

/* =========================================================
 * Envelope scheduling
 * ========================================================= */
function scheduleEnvelope(param, stages, ctx, velocity = 1) {
  const now = ctx.currentTime
  let t = now

  param.cancelScheduledValues(now)

  for (const stage of stages) {
    const from =
      stage.from === "current"
        ? param.value
        : stage.from

    const to = stage.to * velocity

    param.setValueAtTime(from, t)

    t += stage.duration

    if (stage.curve === "exponential") {
      param.exponentialRampToValueAtTime(
        Math.max(0.0001, to),
        t
      )
    } else {
      param.linearRampToValueAtTime(to, t)
    }
  }

  return t - now // durée totale
}

/* =========================================================
 * Main composable
 * ========================================================= */
export function usePatchVoice(patch) {
  const audioCtx = ref(null)

  // graph statique
  const nodes = new Map() // moduleId -> AudioNode
  const paramInputs = [] // connexions vers AudioParam
  const envelopes = []   // modules envelope

  // polyphonie
  const voices = new Map() // note -> VoiceInstance

  /* =========================
   * Init AudioContext
   * ========================= */
  async function init() {
    if (!audioCtx.value) {
      audioCtx.value = new AudioContext()
    }
    if (audioCtx.value.state !== "running") {
      await audioCtx.value.resume()
    }

    buildStaticGraph()
  }

  /* =========================
   * Static graph
   * ========================= */
  function buildStaticGraph() {
    nodes.clear()
    paramInputs.length = 0
    envelopes.length = 0

    const ctx = audioCtx.value

    // 1️⃣ créer nodes fixes
    for (const mod of patch.modules) {
      let node = null

      switch (mod.type) {
        case "gain":
          node = ctx.createGain()
          node.gain.value = mod.params.gain ?? 1
          break

        case "destination":
          node = ctx.destination
          break

        case "envelope":
          envelopes.push(mod)
          continue

        case "voice":
        case "osc":
          // sources → par voix, pas ici
          continue
      }

      if (node) {
        nodes.set(mod.id, node)
      }
    }

    // 2️⃣ connexions
    for (const c of patch.connections) {
      const fromNode = nodes.get(c.from.id)
      const toNode = nodes.get(c.to.id)

      const [, fromPort] = c.from.port.split(":")
      const [, toPort] = c.to.port.split(":")

      if (!fromNode) continue

      if (toNode) {
        // audio → audio
        fromNode.connect(toNode)
      } else {
        // audio → AudioParam
        const targetMod = patch.modules.find(
          (m) => m.id === c.to.id
        )
        if (!targetMod) continue

        paramInputs.push({
          sourceNodeId: c.from.id,
          targetModuleId: c.to.id,
          param: toPort,
        })
      }
    }
  }

  /* =========================
   * Create a voice
   * ========================= */
  function createVoice(note, velocity = 1) {
    const ctx = audioCtx.value
    const freq = noteToFreq(note)

    const sources = []
    const envInstances = []

    // 1️⃣ créer sources
    for (const mod of patch.modules) {
      if (mod.type !== "voice" && mod.type !== "osc") continue

      const osc = ctx.createOscillator()
      osc.type = mod.params.type || "sine"
      osc.frequency.value =
        mod.type === "voice" ? freq : mod.params.frequency
      osc.detune.value = mod.params.detune || 0

      // connexions audio
      for (const c of patch.connections) {
        if (c.from.id !== mod.id) continue

        const target = nodes.get(c.to.id)
        if (target) osc.connect(target)
      }

      // connexions param
      for (const p of paramInputs) {
        if (p.sourceNodeId === mod.id) {
          const targetNode = nodes.get(p.targetModuleId)
          if (targetNode && targetNode[p.param]) {
            osc.connect(targetNode[p.param])
          }
        }
      }

      osc.start()
      sources.push(osc)
    }

    // 2️⃣ envelopes
    for (const env of envelopes) {
      for (const c of patch.connections) {
        if (c.from.id !== env.id) continue

        const targetNode = nodes.get(c.to.id)
        const [, paramName] = c.to.port.split(":")

        if (!targetNode || !targetNode[paramName]) continue

        const param = targetNode[paramName]

        const pressDur = scheduleEnvelope(
          param,
          env.params.stages.press,
          ctx,
          velocity
        )

        const releaseDur = env.params.stages.release.reduce(
          (s, st) => s + st.duration,
          0
        )

        envInstances.push({
          param,
          pressDur,
          releaseDur,
          releaseStages: env.params.stages.release,
        })
      }
    }

    return {
      note,
      sources,
      envelopes: envInstances,
      stop(immediate = false) {
        const now = ctx.currentTime

        let maxRelease = 0

        for (const env of envInstances) {
          env.param.cancelScheduledValues(now)

          if (!immediate) {
            scheduleEnvelope(
              env.param,
              env.releaseStages,
              ctx
            )
            maxRelease = Math.max(
              maxRelease,
              env.releaseDur
            )
          }
        }

        const stopTime = immediate
          ? now
          : now + maxRelease

        for (const src of sources) {
          try {
            src.stop(stopTime)
          } catch {}
        }
      },
    }
  }

  /* =========================
   * Public API
   * ========================= */
  function noteOn(note, velocity = 1) {
    // comportement piano
    if (voices.has(note)) {
      voices.get(note).stop(true)
      voices.delete(note)
    }

    const voice = createVoice(note, velocity)
    voices.set(note, voice)
  }

  function noteOff(note) {
    const voice = voices.get(note)
    if (!voice) return

    voice.stop(false)
    voices.delete(note)
  }

  function stopAll() {
    for (const v of voices.values()) {
      v.stop(true)
    }
    voices.clear()
  }

  return {
    init,
    noteOn,
    noteOff,
    stopAll,
  }
}
