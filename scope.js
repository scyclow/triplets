const TWO_PI = Math.PI * 2

// one cycle of each Web Audio wave type, all starting at 0 and rising, like the oscillators do
const WAVES = {
  sine: p => Math.sin(p),
  square: p => Math.sin(p) >= 0 ? 1 : -1,
  sawtooth: p => (((p / Math.PI + 1) % 2) + 2) % 2 - 1,
  triangle: p => 2 / Math.PI * Math.asin(Math.sin(p)),
}

// Mirrors an oscillator's phase from the notes scheduled on it. Frequency changes
// are instant and phase is continuous, and the oscillator keeps running while
// silent, so phase keeps advancing through gaps and muted stretches.
export function createPhaseTracker(startTime, startFreq) {
  const segments = [{ time: startTime, freq: startFreq, phase: 0, amp: 0, end: startTime }]

  const segmentAt = t => {
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].time <= t) return segments[i]
    }
    return segments[0]
  }

  return {
    addNote(time, freq, duration, amp) {
      const prev = segments.at(-1)
      const phase = (prev.phase + TWO_PI * prev.freq * (time - prev.time)) % TWO_PI
      segments.push({ time, freq, phase, amp, end: time + duration })
    },

    // drop segments that ended before `time`, keeping the one in effect at `time`
    prune(time) {
      while (segments.length > 1 && segments[1].time <= time) segments.shift()
    },

    freqAt: t => segmentAt(t).freq,

    phaseAt(t) {
      const s = segmentAt(t)
      return s.phase + TWO_PI * s.freq * (t - s.time)
    },

    ampAt(t) {
      const s = segmentAt(t)
      return t < s.end ? s.amp : 0
    },

    // changes wherever the wave jumps: a note starting or ending, a square
    // wave flipping, or a sawtooth resetting. drawing breaks the line there
    keyAt(t, waveType='sine') {
      const s = segmentAt(t)
      if (t >= s.end) return `${s.time} off`
      const p = s.phase + TWO_PI * s.freq * (t - s.time)
      const cycle = waveType === 'square' ? Math.floor(p / Math.PI)
        : waveType === 'sawtooth' ? Math.floor((p + Math.PI) / TWO_PI)
        : 0
      return `${s.time} ${cycle}`
    },

    valueAt(t, waveType='sine') {
      const s = segmentAt(t)
      if (t >= s.end) return 0
      return s.amp * WAVES[waveType](s.phase + TWO_PI * s.freq * (t - s.time))
    },
  }
}

// Largest frequency that every freq is a whole multiple of: the combined wave
// repeats at this rate. 130/195/260 -> 65
export function commonBase(freqs, tolerance=0.5) {
  const gcd = (a, b) => {
    while (b > tolerance) [a, b] = [b, a % b]
    return a
  }
  return freqs.reduce(gcd, freqs[0] ?? 0)
}

export function drawScope(canvas, traces, t0, length, scale) {
  const g = canvas.getContext('2d')
  const { width, height } = canvas

  g.clearRect(0, 0, width, height)

  g.strokeStyle = '#ccc'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, height / 2)
  g.lineTo(width, height / 2)
  g.stroke()

  // keyAt changes wherever the wave jumps; the line breaks there instead of
  // drawing a vertical stroke
  traces.forEach(({ color, lineWidth=1.5, valueAt, keyAt }) => {
    g.strokeStyle = color
    g.lineWidth = lineWidth
    g.beginPath()
    let prevKey
    for (let x = 0; x <= width; x++) {
      const t = t0 + length * x / width
      const y = height / 2 * (1 - valueAt(t) / scale * 0.9)
      const key = keyAt(t)
      x && key === prevKey ? g.lineTo(x, y) : g.moveTo(x, y)
      prevKey = key
    }
    g.stroke()
  })
}

// xAt and yAt return null while their layer is silent; nothing is drawn there
export function drawLissajous(canvas, xAt, yAt, keyAt, t0, length, steps=1000) {
  const g = canvas.getContext('2d')
  const { width, height } = canvas

  g.clearRect(0, 0, width, height)

  g.strokeStyle = '#ccc'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, height / 2)
  g.lineTo(width, height / 2)
  g.stroke()

  g.strokeStyle = '#000'
  g.lineWidth = 1.5
  g.beginPath()
  let prevKey
  for (let i = 0; i <= steps; i++) {
    const t = t0 + length * i / steps
    const vx = xAt(t)
    const vy = yAt(t)
    if (vx === null || vy === null) {
      prevKey = null
      continue
    }
    const x = width / 2 * (1 + vx * 0.9)
    const y = height / 2 * (1 - vy * 0.9)
    const key = keyAt(t)
    i && key === prevKey ? g.lineTo(x, y) : g.moveTo(x, y)
    prevKey = key
  }
  g.stroke()
}
