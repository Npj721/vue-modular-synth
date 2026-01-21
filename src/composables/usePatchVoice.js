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
 * Envelope scheduler (AudioParam only)
 * ========================================================= */

function scheduleStages(
  param,
  stages,
  ctx,
  velocity = 1,
  base = 1
) {
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
        : stage.from * base

    let to = stage.to * velocity * base

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
   * Init
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

    const nodes = new Map()
    const sources = []
    const envelopes = []

    /* ---------- 1️⃣ Create modules ---------- */

    for (const mod of patch.modules) {
      let node = null
      let params = {}
      let bases = {}

      switch (mod.type) {
        case "voice": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"

          const freq = noteToFreq(note)
          const detune = mod.params.detune ?? 0

          osc.frequency.setValueAtTime(freq, now)
          osc.detune.setValueAtTime(detune, now)
          osc.start()

          node = osc
          params = {
            frequency: osc.frequency,
            detune: osc.detune
          }
          bases = {
            frequency: freq,
            detune: detune
          }

          sources.push(osc)
          break
        }

        case "osc": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"

          const freq = mod.params.frequency ?? 440
          const detune = mod.params.detune ?? 0

          osc.frequency.setValueAtTime(freq, now)
          osc.detune.setValueAtTime(detune, now)
          osc.start()

          node = osc
          params = {
            frequency: osc.frequency,
            detune: osc.detune
          }
          bases = {
            frequency: freq,
            detune: detune
          }

          sources.push(osc)
          break
        }

        case "gain": {
          const g = ctx.createGain()
          const gain = mod.params.gain ?? 1

          g.gain.setValueAtTime(gain, now)

          node = g
          params = { gain: g.gain }
          bases = { gain }

          break
        }

        case "destination":
          node = ctx.destination
          break

        case "envelope":
          envelopes.push(mod)
          continue
      }

      nodes.set(mod.id, { node, params, bases })
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

    const activeEnvs = []

    for (const env of envelopes) {
      for (const c of patch.connections) {
        if (c.from.id !== env.id) continue

        const target = nodes.get(c.to.id)
        if (!target) continue

        const [, paramName] = c.to.port.split(":")
        const param = target.params?.[paramName]
        if (!param) continue

        const modulation =
          env.params.modulation ?? "replace"

        const base =
          modulation === "relative"
            ? target.bases?.[paramName] ?? 1
            : 1

        scheduleStages(
          param,
          env.params.stages.press,
          ctx,
          velocity,
          base
        )

        activeEnvs.push({
          param,
          base,
          release: env.params.stages.release,
          affectsAmplitude: paramName === "gain"
        })
      }
    }

    /* ---------- 4️⃣ Voice API ---------- */

    return {
      stop() {
        const now = ctx.currentTime
        let maxRelease = 0
        let hasAmplitudeEnv = false

        for (const env of activeEnvs) {
          env.param.cancelScheduledValues(now)

          scheduleStages(
            env.param,
            env.release,
            ctx,
            1,
            env.base
          )

          maxRelease = Math.max(
            maxRelease,
            getEnvelopeDuration(env.release)
          )

          if (env.affectsAmplitude) {
            hasAmplitudeEnv = true
          }
        }

        // ⛔️ On ne stoppe les oscillateurs
        // QUE si une enveloppe agit sur l’amplitude
        if (hasAmplitudeEnv) {
          for (const src of sources) {
            src.stop(now + maxRelease + 0.05)
          }
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
