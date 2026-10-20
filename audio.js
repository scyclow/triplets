// Adapted from smarthome/docs/audio.js

export const MAX_VOLUME = 0.04

// one shared context so every source runs on the same clock
let sharedCtx, masterGain
export function getCtx() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!sharedCtx) {
    sharedCtx = new AudioContext()
    masterGain = sharedCtx.createGain()
    masterGain.connect(sharedCtx.destination)
  }
  return sharedCtx
}

// master volume multiplier, applied after each source's MAX_VOLUME cap
let masterVolume = 1
export function setMasterVolume(value) {
  masterVolume = value
  if (masterGain) masterGain.gain.setTargetAtTime(value, sharedCtx.currentTime, 0.01)
}

export const allSources = []
// oscillatorCount > 1 stacks identical in-phase oscillators to make the source louder
export function createSource(waveType = 'square', startingFreq=3000, oscillatorCount=1) {
  const ctx = getCtx()
  masterGain.gain.value = masterVolume

  const gain = ctx.createGain()
  const panner = new StereoPannerNode(ctx)

  const sources = Array.from({ length: oscillatorCount }, () => {
    const osc = ctx.createOscillator()
    osc.type = waveType
    osc.frequency.value = startingFreq
    osc.connect(gain)
    return osc
  })
  const [source] = sources

  gain.connect(panner)
  panner.connect(masterGain)

  gain.gain.value = 0
  const startTime = ctx.currentTime
  sources.forEach(osc => osc.start(startTime))

  const smoothFreq = (value, timeInSeconds=0.001) => {
    sources.forEach(osc => osc.frequency.exponentialRampToValueAtTime(
      value,
      ctx.currentTime + timeInSeconds
    ))
  }

  const smoothPanner = (value, timeInSeconds=0.001) => {
    panner.pan.exponentialRampToValueAtTime(
      value,
      ctx.currentTime + timeInSeconds
    )
  }

  const smoothGain = (value, timeInSeconds=0.001) => {
    gain.gain.setTargetAtTime(
      Math.min(value, MAX_VOLUME),
      ctx.currentTime,
      timeInSeconds
    )
  }

  // schedule a note at an exact audio-clock time, so sequences don't drift
  const scheduleNote = (freq, startTime, duration, volume=1) => {
    sources.forEach(osc => osc.frequency.setValueAtTime(freq, startTime))
    gain.gain.setTargetAtTime(MAX_VOLUME * volume, startTime, 0.002)
    gain.gain.setTargetAtTime(0, startTime + duration, 0.005)
  }

  const src = {
    ctx, startTime, source, sources, gain, panner, smoothFreq, smoothGain, smoothPanner, scheduleNote,
    setWaveType(waveType) {
      sources.forEach(osc => osc.type = waveType)
    },
    stop() {
      sources.forEach(osc => osc.stop())
      this.isStopped = true
    }
  }

  allSources.push(src)

  return src
}

window.allSources = allSources
