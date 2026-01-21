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
 * Envelope scheduler
 * ========================================================= */

function scheduleStages(param, stages, ctx, velocity = 1, base = 1) {
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

        /* ================= OSCILLATORS ================= */

        case "voice":
        case "osc": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"

          const freq =
            mod.type === "voice"
              ? noteToFreq(note)
              : mod.params.frequency ?? 440

          const detune = mod.params.detune ?? 0

          osc.frequency.setValueAtTime(freq, now)
          osc.detune.setValueAtTime(detune, now)
          osc.start()

          node = osc
          params = {
            frequency: osc.frequency,
            detune: osc.detune,
          }
          bases = {
            frequency: freq,
            detune: detune,
          }

          sources.push(osc)
          break
        }

        /* ================= GAIN ================= */

        case "gain": {
          const g = ctx.createGain()
          const gain = mod.params.gain ?? 1

          g.gain.setValueAtTime(gain, now)

          node = g
          params = { gain: g.gain }
          bases = { gain }

          break
        }

        /* ================= DELAY ================= */

        case "delay": {
          const d = ctx.createDelay(5.0)
          const time = mod.params.delayTime ?? 0.3

          d.delayTime.setValueAtTime(time, now)

          node = d
          params = { delayTime: d.delayTime }
          bases = { delayTime: time }

          break
        }

        /* ================= FILTERS ================= */

        case "filter_lowpass":
        case "filter_highpass":
        case "filter_bandpass":
        case "filter_notch":
        case "filter_peaking":
        case "filter_lowshelf":
        case "filter_highshelf": {
          const f = ctx.createBiquadFilter()

          f.type = mod.type.replace("filter_", "")

          const freq = mod.params.frequency ?? 1000
          const Q = mod.params.Q ?? 1
          const gain = mod.params.gain ?? 0

          f.frequency.setValueAtTime(freq, now)
          f.Q.setValueAtTime(Q, now)
          f.gain.setValueAtTime(gain, now)

          node = f
          params = {
            frequency: f.frequency,
            Q: f.Q,
            gain: f.gain,
          }
          bases = {
            frequency: freq,
            Q,
            gain,
          }

          break
        }

        /* ================= COMPRESSOR ================= */

        case "compressor": {
          const c = ctx.createDynamicsCompressor()

          const p = mod.params

          c.threshold.setValueAtTime(p.threshold ?? -24, now)
          c.knee.setValueAtTime(p.knee ?? 30, now)
          c.ratio.setValueAtTime(p.ratio ?? 12, now)
          c.attack.setValueAtTime(p.attack ?? 0.003, now)
          c.release.setValueAtTime(p.release ?? 0.25, now)

          node = c
          params = {
            threshold: c.threshold,
            knee: c.knee,
            ratio: c.ratio,
            attack: c.attack,
            release: c.release,
          }
          bases = { ...p }

          break
        }

        /* ================= CONVOLVER ================= */

        case "convolver": {
          const conv = ctx.createConvolver()
          conv.normalize = mod.params.normalize ?? true
          conv.buffer = mod.params.buffer ?? null

          node = conv
          break
        }

        /* ================= DEST ================= */

        case "destination":
          node = ctx.destination
          break

        /* ================= ENVELOPE ================= */

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

        const modulation = env.params.modulation ?? "replace"

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
          affectsAmplitude: paramName === "gain",
        })
      }
    }

    /* ---------- 4️⃣ Voice API ---------- */

    return {
      stop() {
        const now = ctx.currentTime
        let maxRelease = 0
        let hasAmpEnv = false

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

          if (env.affectsAmplitude) hasAmpEnv = true
        }

        if (hasAmpEnv) {
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
    stopAll,
  }
}
