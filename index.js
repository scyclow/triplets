import { $ } from './$.js'
import { createSource, getCtx, setMasterVolume } from './audio.js'
import { createPhaseTracker, commonBase, drawScope, drawLissajous } from './scope.js'
import { createViz, colorsForFreq } from './viz.js'
import { createRosetteViz } from './rosette.js'

const BEATS_PER_MEASURE = 4
const MEASURES_PER_CHORD = 4
const BEATS_PER_CHORD = MEASURES_PER_CHORD * BEATS_PER_MEASURE

const LOOKAHEAD = 0.1
const SCHEDULE_INTERVAL_MS = 25

const WAVE_TYPES = ['sine', 'square', 'triangle', 'sawtooth']

const TRIPLET_CHORDS = [
  [130, 195, 260],
  [146.25, 219.375, 292.5],
]
const QUARTER_CHORDS = [
  [260, 195, 130, 195],
  [146.25, 219.375, 292.5, 219.375],
]

// each layer plays `subdivisions` notes per beat, cycling through the
// current chord's pattern. chords change every MEASURES_PER_CHORD measures
const createLayer = (name, color, subdivisions, chords, active=false) => ({
  name,
  color,
  active,
  subdivisions,
  chords,
  waveType: 'sine',
  volume: 1,
})

const layers = [
  createLayer('triplets', '#e4572e', 3, TRIPLET_CHORDS, true),
  createLayer('quarters', '#2e86ab', 1, QUARTER_CHORDS),
  createLayer('triplets 2', '#a23b72', 3, TRIPLET_CHORDS),
  createLayer('quarters 2', '#3b8f3b', 1, QUARTER_CHORDS),
]

const $start = $.id('start')
const $layers = $.id('layers')
const $volume = $.id('volume')
const $volumeValue = $.id('volumeValue')

const updateVolume = () => {
  setMasterVolume(Number($volume.value))
  $volumeValue.innerHTML = Number($volume.value).toFixed(2) + 'x'
}
$volume.oninput = updateVolume
updateVolume()

// read by the scheduler once per beat, so changes land on the next beat
let bpm
const $bpm = $.id('bpm')
const $bpmValue = $.id('bpmValue')

const updateBpm = () => {
  bpm = Number($bpm.value)
  $bpmValue.innerHTML = bpm
}
$bpm.oninput = updateBpm
updateBpm()

// multiplies every frequency; read by the scheduler, so it lands on the next beat
let toneMultiplier = 1
const $tone = $.id('tone')
const $toneValue = $.id('toneValue')

const updateTone = () => {
  toneMultiplier = Number($tone.value)
  $toneValue.innerHTML = toneMultiplier.toFixed(2) + 'x'
}
$tone.oninput = updateTone
updateTone()

layers.forEach(layer => {
  const $toggle = $.create('button')(layer.name)
  $($toggle, 'borderLeft', `6px solid ${layer.color}`)
  $toggle.classList.toggle('active', layer.active)
  $toggle.onclick = () => {
    // read by the scheduler once per beat, so this lands on the next beat
    layer.active = !layer.active
    $toggle.classList.toggle('active', layer.active)
  }

  const $waveType = $.create('select')(
    WAVE_TYPES.map(w => `<option value="${w}">${w}</option>`).join('')
  )
  $waveType.value = layer.waveType
  $waveType.onchange = () => {
    layer.waveType = $waveType.value
    if (layer.src) layer.src.setWaveType(layer.waveType)
  }

  const $layerVolumeValue = $.span()
  const $layerVolume = $.create('input')(null, {
    type: 'range', min: 0, max: 4, step: 0.01, value: layer.volume
  })
  const updateLayerVolume = () => {
    layer.volume = Number($layerVolume.value)
    $layerVolumeValue.innerHTML = layer.volume.toFixed(2) + 'x'
  }
  $layerVolume.oninput = updateLayerVolume
  updateLayerVolume()

  $layers.append($toggle, $waveType, $layerVolume, $layerVolumeValue)
})

function scheduleBeat(beatIx, beatTime) {
  layers.forEach(layer => {
    if (!layer.active) return

    const chord = layer.chords[Math.floor(beatIx / BEATS_PER_CHORD) % layer.chords.length]
    const noteLength = 60 / bpm / layer.subdivisions

    for (let i = 0; i < layer.subdivisions; i++) {
      const freq = chord[(beatIx * layer.subdivisions + i) % chord.length] * toneMultiplier
      const noteTime = beatTime + i * noteLength
      layer.src.scheduleNote(freq, noteTime, noteLength * 0.8, layer.volume)
      layer.tracker.addNote(noteTime, freq, noteLength * 0.8, layer.volume)
      viz.addNote(noteTime, noteLength * 0.8, freq)
    }
  })
}

$start.onclick = () => {
  $start.disabled = true

  const ctx = getCtx()
  layers.forEach(layer => {
    layer.src = createSource(layer.waveType, layer.chords[0][0])
    layer.tracker = createPhaseTracker(layer.src.startTime, layer.chords[0][0])
  })

  let beatIx = 0
  let nextBeatTime = ctx.currentTime + 0.05

  setInterval(() => {
    while (nextBeatTime < ctx.currentTime + LOOKAHEAD) {
      scheduleBeat(beatIx, nextBeatTime)
      nextBeatTime += 60 / bpm
      beatIx++
    }
    layers.forEach(layer => layer.tracker.prune(ctx.currentTime - 1))
  }, SCHEDULE_INTERVAL_MS)

  requestAnimationFrame(drawFrame)
}

// SCOPE

const viz = createViz($.id('viz'))
const rosette = createRosetteViz($.id('rosette'))
let rosetteColors = colorsForFreq(130)

const $scope = $.id('scope')
const $lissajous = $.id('lissajous')
const $lissajousX = $.id('lissajousX')
const $lissajousY = $.id('lissajousY')

const layerOptions = layers.map((l, i) => `<option value="${i}">${l.name}</option>`).join('')
$lissajousX.innerHTML = layerOptions
$lissajousY.innerHTML = layerOptions
$lissajousX.value = 0
$lissajousY.value = 1

const MIN_WINDOW = 0.025
const MIN_LOCK_FREQ = 20

function drawFrame() {
  const now = getCtx().currentTime
  const shown = layers.filter(l => l.active)

  // lock the window to the combined wave's period, so the picture holds still
  // while the same notes are playing. if there's no useful common period, scroll.
  // an oscillator keeps its last frequency between notes, so this holds through gaps
  const base = commonBase(shown.map(l => l.tracker.freqAt(now)))
  const period = base >= MIN_LOCK_FREQ ? 1 / base : null
  const windowLength = period ? period * Math.ceil(MIN_WINDOW / period) : MIN_WINDOW
  const t0 = period
    ? Math.floor((now - windowLength) / period) * period
    : now - windowLength

  const traces = shown.map(l => ({
    color: l.color,
    valueAt: t => l.tracker.valueAt(t, l.waveType),
    keyAt: t => l.tracker.keyAt(t, l.waveType),
  }))
  const sum = {
    color: '#000',
    lineWidth: 2.5,
    valueAt: t => traces.reduce((total, trace) => total + trace.valueAt(t), 0),
    keyAt: t => traces.map(trace => trace.keyAt(t)).join('|'),
  }
  // scale by the volume settings, not what's sounding right now: between notes
  // nothing is sounding, and scaling by that blew the traces off the canvas
  const scale = shown.reduce((total, l) => total + l.volume, 0) || 1

  drawScope($scope, [...traces, sum], t0, windowLength, scale)
  viz.draw(now)

  // each sounding note is a gear: over one cycle of the combined wave it turns
  // freq * cycleLength times (a whole number when locked, so the curve closes),
  // starting from its phase at t0. its y matches the scope's sum line
  const cycleLength = period ?? windowLength
  const gears = shown
    .filter(l => l.tracker.ampAt(now) > 0)
    .map(l => {
      const freq = l.tracker.freqAt(now)
      const turns = freq * cycleLength
      return {
        turns: period ? Math.round(turns) : turns,
        radius: l.tracker.ampAt(now),
        phase: l.tracker.phaseAt(now) - 2 * Math.PI * freq * (now - t0),
      }
    })
  rosetteColors = viz.newestNote(now) ?? rosetteColors
  rosette.draw(gears, rosetteColors)

  // one layer against another, each normalized to its own volume
  const xLayer = layers[$lissajousX.value]
  const yLayer = layers[$lissajousY.value]
  const normalized = l => t => {
    const amp = l.tracker.ampAt(t)
    return amp ? l.tracker.valueAt(t, l.waveType) / amp : null
  }
  const lissajousKey = t => xLayer.tracker.keyAt(t, xLayer.waveType) + '|' + yLayer.tracker.keyAt(t, yLayer.waveType)
  drawLissajous($lissajous, normalized(xLayer), normalized(yLayer), lissajousKey, t0, period ?? MIN_WINDOW)

  requestAnimationFrame(drawFrame)
}
