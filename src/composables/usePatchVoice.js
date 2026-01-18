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

  // valeur de base ABSOLUE du param
  const baseValue = param.value

  // figer la valeur actuelle réelle
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)

  let t = now

  for (const stage of stages) {
    const fromEnv =
      stage.from === "current"
        ? param.value / baseValue
        : stage.from

    const toEnv = stage.to * velocity

    const fromValue = baseValue * fromEnv
    const toValue = baseValue * toEnv

    param.setValueAtTime(fromValue, t)

    t += stage.duration

    if (stage.curve === "exponential") {
      param.exponentialRampToValueAtTime(
        Math.max(0.0001, toValue),
        t
      )
    } else {
      param.linearRampToValueAtTime(toValue, t)
    }
  }

  return t - now
}

/* =========================================================
 * Main composable
 * ========================================================= */
export function usePatchVoice(patch) {
  const audioCtx = ref(null)

  const nodes = new Map()
  const paramInputs = []
  const envelopes = []

  const voices = new Map()

  /* =========================
   * Init
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
          continue
      }

      if (node) nodes.set(mod.id, node)
    }

    for (const c of patch.connections) {
      const fromNode = nodes.get(c.from.id)
      const toNode = nodes.get(c.to.id)

      const [, toPort] = c.to.port.split(":")

      if (!fromNode) continue

      if (toNode) {
        fromNode.connect(toNode)
      } else {
        paramInputs.push({
          sourceNodeId: c.from.id,
          targetModuleId: c.to.id,
          param: toPort,
        })
      }
    }
  }

  /* =========================
   * Voice creation
   * ========================= */

function createParamInput(ctx, baseValue) {
  const base = ctx.createConstantSource()
  base.offset.value = baseValue
  base.start()

  return {
    base,
    input: base.offset // AudioParam
  }
}

function createVoice(note, velocity = 1) {
  const ctx = audioCtx.value
  const freq = noteToFreq(note)

  const nodes = new Map()
  const sources = []
  const envelopes = []

  /* =========================
   * 1️⃣ Create nodes (PER VOICE)
   * ========================= */
  for (const mod of patch.modules) {
    let node = null

    switch (mod.type) {
      case "voice": {
        const osc = ctx.createOscillator()
        osc.type = mod.params.type || "sine"
        
        // base frequency via ConstantSource
        /*const freqInput = createParamInput(ctx, freq)
        freqInput.base.connect(osc.frequency)*/
        osc.frequency.value = freq;

        // detune base

        osc.detune.value = mod.params.detune || 0
        nodes.set(mod.id, {
          node: osc,
          params: {
            frequency: osc.frequency,
            detune: osc.detune ,
          }
        })

        osc.start()
        sources.push(osc)
        break
      }

      case "osc": {
        const osc = ctx.createOscillator()
        osc.type = mod.params.type || "sine"
        osc.frequency.value = mod.params.frequency
        osc.detune.value = mod.params.detune || 0
        osc.start()

        nodes.set(mod.id, { node: osc })
        sources.push(osc)
        break
      }

      case "gain": {
        const g = ctx.createGain()
        g.gain.value = mod.params.gain ?? 1
        nodes.set(mod.id, { node: g, params: { gain: g.gain } })
        break
      }

      case "destination":
        nodes.set(mod.id, { node: ctx.destination })
        break

      case "envelope":
        nodes.set(mod.id, mod)
        break
    }
  }

  /* =========================
   * 2️⃣ Connections (audio + param)
   * ========================= */
  for (const c of patch.connections) {
    const from = nodes.get(c.from.id)
    const to = nodes.get(c.to.id)
    if (!from || !to) continue
    const [, toPort] = c.to.port.split(":") 

    console.log('Connections (audio + param)', { from, to, toPort})
    

    if (toPort == "in") {
      console.log('on se connecte sur le "in" ')
      from.node.connect(to.node)
    } else if (to.params?.[toPort]) {
      console.log("on se connecte sur ", { type: from.type, to: to.params[toPort] })
      if(from.type != "envelope") from.node.connect(to.params[toPort])
    }
  }

  /* =========================
   * 3️⃣ Envelopes (PER VOICE)
   * ========================= */
  for (const mod of patch.modules) {
    if (mod.type !== "envelope") continue

    for (const c of patch.connections) {
      if (c.from.id !== mod.id) continue

      const target = nodes.get(c.to.id)
      const [, paramName] = c.to.port.split(":")

      if (!target?.params?.[paramName]) continue

      const param = target.params[paramName]

      scheduleEnvelope(param, mod.params.stages.press, ctx, velocity)

      envelopes.push({
        param,
        release: mod.params.stages.release
      })
    }
  }

  /* =========================
   * 4️⃣ Voice API
   * ========================= */
  return {
    stop() {
      const now = ctx.currentTime
      let maxRelease = 0

      for (const env of envelopes) {
        //env.param.cancelScheduledValues(now)
        maxRelease = Math.max(
          maxRelease,
          scheduleEnvelope(env.param, env.release, ctx)
        )
      }

      for (const src of sources) {
        src.stop(now + maxRelease + 0.01)
      }
    }
  }
}


  /* =========================
   * Public API
   * ========================= */
  function noteOn(note, velocity = 1) {
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
