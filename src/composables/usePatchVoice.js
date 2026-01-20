import { ref } from "vue"

/* =========================================================
 * Utils
 * ========================================================= */

const EPS = 0.0001

const noteToFreq = (note) =>
  440 * Math.pow(2, (note - 69) / 12)

function getEnvelopeDuration(stages = []) {
  return stages.reduce((t, s) => t + s.duration, 0)
}

/* =========================================================
 * Envelope scheduler (PURE AudioParam automation)
 * ========================================================= */

function scheduleStages(param, stages, ctx, velocity = 1) {
  const now = ctx.currentTime

  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now)
  } else {
    const v = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  }

  let t = now

  for (const stage of stages) {
    let from =
      stage.from === "current"
        ? param.value
        : stage.from

    let to = stage.to * velocity

    if (stage.curve === "exponential") {
      from = Math.max(EPS, from)
      to = Math.max(EPS, to)
    }

    param.setValueAtTime(from, t)
    t += stage.duration

    if (stage.curve === "exponential") {
      param.exponentialRampToValueAtTime(to, t)
    } else {
      param.linearRampToValueAtTime(to, t)
    }
  }

  return t - now
}

/* =========================================================
 * Main composable
 * ========================================================= */

export function usePatchVoice(patch) {
  const audioCtx = ref(null)
  const voices = new Map() // Map<note, voice>

  /* =========================
   * Init (user gesture)
   * ========================= */

  async function init() {
    if (!audioCtx.value) {
      audioCtx.value = new AudioContext()
    }
    if (audioCtx.value.state !== "running") {
      await audioCtx.value.resume()
    }
  }

  /* =========================
   * Create one voice
   * ========================= */

  function createVoice(note, velocity = 1) {
    const ctx = audioCtx.value
    const now = ctx.currentTime

    const nodes = new Map() // id -> { node, params }
    const sources = []
    const envelopes = []

    /* ---------- 1️⃣ Create modules ---------- */

    for (const mod of patch.modules) {
      let node = null
      let params = {}

      switch (mod.type) {
        case "voice": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"
          osc.frequency.setValueAtTime(noteToFreq(note), now)
          osc.detune.setValueAtTime(mod.params.detune || 0, now)
          osc.start()

          node = osc
          params.frequency = osc.frequency
          params.detune = osc.detune
          sources.push(osc)
          break
        }

        case "osc": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"
          osc.frequency.setValueAtTime(mod.params.frequency || 440, now)
          osc.detune.setValueAtTime(mod.params.detune || 0, now)
          osc.start()

          node = osc
          params.frequency = osc.frequency
          params.detune = osc.detune
          sources.push(osc)
          break
        }

        case "gain": {
          const g = ctx.createGain()
          g.gain.setValueAtTime(mod.params.gain ?? 1, now)
          node = g
          params.gain = g.gain
          break
        }

        case "destination":
          node = ctx.destination
          break

        case "envelope":
          envelopes.push(mod)
          continue
      }

      nodes.set(mod.id, { node, params })
    }

    /* ---------- 2️⃣ Connections ---------- */

    for (const c of patch.connections) {
      const from = nodes.get(c.from.id)
      const to = nodes.get(c.to.id)
      if (!from || !to) continue

      const [, toPort] = c.to.port.split(":")

      if (toPort === "in") {
        from.node.connect(to.node)
      } else if (to.params?.[toPort]) {
        from.node.connect(to.params[toPort])
      }
    }

    /* ---------- 3️⃣ Envelopes (PRESS) ---------- */

    const modulatedParams = []
    const amplitudeEnvs = []

    for (const env of envelopes) {
      for (const c of patch.connections) {
        if (c.from.id !== env.id) continue

        const target = nodes.get(c.to.id)
        const [, paramName] = c.to.port.split(":")
        const param = target?.params?.[paramName]
        if (!param) continue

        scheduleStages(
          param,
          env.params.stages.press,
          ctx,
          velocity
        )

        const isAmplitude = paramName === "gain"

        modulatedParams.push({
          param,
          release: env.params.stages.release,
          isAmplitude
        })

        if (isAmplitude) {
          amplitudeEnvs.push(env)
        }
      }
    }

    /* ---------- 4️⃣ Voice API ---------- */

    return {
      stop() {
        const now = ctx.currentTime

        let maxAmpRelease = 0

        for (const env of modulatedParams) {
          env.param.cancelScheduledValues(now)
          scheduleStages(env.param, env.release, ctx)

          if (env.isAmplitude) {
            maxAmpRelease = Math.max(
              maxAmpRelease,
              getEnvelopeDuration(env.release)
            )
          }
        }

        // 🔑 RÈGLE FONDAMENTALE
        // - pas d’enveloppe d’amplitude → stop immédiat
        // - enveloppes d’amplitude → attendre leur release

        const stopTime =
          amplitudeEnvs.length > 0
            ? now + maxAmpRelease + 0.02
            : now

        for (const src of sources) {
          src.stop(stopTime)
        }
      }
    }
  }

  /* =========================
   * Public API
   * ========================= */

  function noteOn(note, velocity = 1) {
    if (!audioCtx.value) return

    if (voices.has(note)) {
      voices.get(note).stop()
      voices.delete(note)
    }

    const voice = createVoice(note, velocity)
    voices.set(note, voice)
  }

  function noteOff(note) {
    const voice = voices.get(note)
    if (!voice) return

    voice.stop()
    voices.delete(note)
  }

  function stopAll() {
    for (const v of voices.values()) v.stop()
    voices.clear()
  }

  return {
    init,
    noteOn,
    noteOff,
    stopAll
  }
}
