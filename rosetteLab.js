import { $ } from './$.js'
import { DEFAULTS } from './rosetteConfig.js'
import { createRosetteGL } from './rosetteGL.js'

// every control, in order. key is a path into the config ('numismatic.amplitude'). look controls only redraw;
// the rest rebuild the rosette. numismatic ones only show with that style
const CONTROLS = [
  { key: 'style', options: ['standard', 'numismatic'] },

  { heading: 'gears' },
  { key: 'seed', min: 0, max: 1000, step: 1, reroll: true },
  { key: 'gears', min: 1, max: 12, step: 1 },
  { key: 'amplitude', min: 0, max: 0.4, step: 0.005 },
  { key: 'rotationMin', min: 0, max: 15, step: 1 },
  { key: 'rotationMax', min: 1, max: 30, step: 1 },
  { key: 'oddRotations', check: true },
  { key: 'smoothed', check: true },
  { key: 'symmetry', options: ['both', 'vertical', 'horizontal', 'none'] },
  { key: 'starts', options: ['fixed', 'even', 'random'] },

  { heading: 'layers' },
  { key: 'layers', min: 1, max: 100, step: 1 },
  { key: 'minSize', min: 0.5, max: 50, step: 0.5 },
  { key: 'spacing', min: 0.3, max: 10, step: 0.05 },
  { key: 'radiaChange', min: 0, max: 0.15, step: 0.0025 },
  { key: 'layerRotation', min: -5, max: 5, step: 0.05 },
  { key: 'pointCount', min: 100, max: 3000, step: 50 },

  { heading: 'numismatic', numismatic: true },
  { key: 'numismatic.amplitude', min: 0, max: 6, step: 0.05 },
  { key: 'numismatic.shrink', min: 0, max: 1, step: 0.01 },
  { key: 'numismatic.minAmplitude', min: 0, max: 3, step: 0.05 },
  { key: 'numismatic.overlap', min: 0, max: 2, step: 0.05 },
  { key: 'numismatic.oscillations', min: 2, max: 120, step: 1 },
  { key: 'numismatic.oscillationsPerLayer', min: 0, max: 4, step: 0.1 },
  { key: 'numismatic.minWavelength', min: 0, max: 5, step: 0.05 },
  { key: 'numismatic.evenSwings', check: true },
  { key: 'numismatic.repeats', min: 1, max: 12, step: 1 },
  { key: 'numismatic.spread', min: 0, max: 2, step: 0.05 },
  { key: 'numismatic.curve', min: 0, max: 1, step: 0.05 },
  { key: 'numismatic.floor', min: 0, max: 10, step: 0.1 },

  { heading: 'look' },
  { key: 'lineWidth', min: 0.25, max: 6, step: 0.25, look: true },
  { key: 'glowMid', min: 0.25, max: 20, step: 0.25, look: true },
  { key: 'glowSteepness', min: 0.5, max: 10, step: 0.1, look: true },
  { key: 'bg', color: true, look: true },
  { key: 'stroke', color: true, look: true },
  { key: 'secondary', color: true, look: true },
]

const config = structuredClone(DEFAULTS)
const getAt = path => path.split('.').reduce((o, k) => o[k], config)
const setAt = (path, value) => {
  const keys = path.split('.')
  keys.slice(0, -1).reduce((o, k) => o[k], config)[keys.at(-1)] = value
}

const $canvas = $.id('canvas')
const $fields = $.id('fields')
const $stats = $.id('stats')
const $config = $.id('config')
const $copy = $.id('copy')

const rosette = createRosetteGL($canvas)

// the config as it'd be written in rosetteConfig.js
const format = (value, indent='') => {
  if (typeof value === 'string') return `'${value}'`
  if (typeof value !== 'object') return String(value)
  const inner = indent + '  '
  const entries = Object.entries(value).map(([k, v]) => `${inner}${k}: ${format(v, inner)},`)
  return `{\n${entries.join('\n')}\n${indent}}`
}

function draw() {
  rosette.draw(config)
  $config.value = `export const DEFAULTS = ${format(config)}`
}

function build() {
  const { gears, rings, segments } = rosette.build(config)
  const gearText = gears.map(g => `${g.rotation}x ${g.radia.toFixed(3)} @${g.phase.toFixed(2)}`).join(', ')
  $stats.innerHTML = `${rings} rings, ${segments.toLocaleString()} segments<br>gears: ${gearText}`
  draw()
}

const $numismaticRows = []
const updateVisibility = () => {
  $numismaticRows.forEach($e => $($e, 'display', config.style === 'numismatic' ? '' : 'none'))
}

CONTROLS.forEach(control => {
  const isNumismatic = control.numismatic || control.key?.startsWith('numismatic.')
  const track = (...$els) => {
    if (isNumismatic) $numismaticRows.push(...$els)
    $fields.append(...$els)
  }

  if (control.heading) {
    track($.create('h3')(control.heading))
    return
  }

  const { key } = control
  const $label = $.create('label')(key.replace('numismatic.', ''))
  const $value = $.span()
  let $input

  if (control.options) {
    $input = $.create('select')(control.options.map(o => `<option value="${o}">${o}</option>`).join(''))
    $input.value = getAt(key)
  } else if (control.check) {
    $input = $.create('input')(null, { type: 'checkbox' })
    $input.checked = getAt(key)
  } else if (control.color) {
    $input = $.create('input')(null, { type: 'color' })
    $input.value = getAt(key)
  } else {
    $input = $.create('input')(null, { type: 'range', min: control.min, max: control.max, step: control.step })
    $input.value = getAt(key)
    $value.innerHTML = getAt(key)
  }

  const valueOf = () => control.check ? $input.checked
    : control.options || control.color ? $input.value
    : Number($input.value)

  $input.oninput = () => {
    setAt(key, valueOf())
    if (!control.options && !control.check && !control.color) $value.innerHTML = getAt(key)
    if (key === 'style') updateVisibility()
    control.look ? draw() : build()
  }

  if (control.reroll) {
    const $reroll = $.create('button')('reroll')
    $reroll.onclick = () => {
      $input.value = Math.floor(Math.random() * (control.max + 1))
      $input.oninput()
    }
    $value.append(' ', $reroll)
  }

  track($label, $input, $value)
})

$copy.onclick = async () => {
  try {
    await navigator.clipboard.writeText($config.value)
    $copy.innerHTML = 'copied'
  } catch (e) {
    $config.select()
    $copy.innerHTML = 'press cmd+c'
  }
  setTimeout(() => $copy.innerHTML = 'copy config', 1500)
}

updateVisibility()
build()
window.onresize = draw
