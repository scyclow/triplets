import { $ } from './$.js'
import { DEFAULTS } from './glowConfig.js'

// all sizes are in css px
const VERTEX_SHADER = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;

  uniform vec2 resolution;
  uniform vec2 size;
  uniform float pixelRatio;
  uniform float mid;
  uniform float steepness;
  uniform vec3 bg;
  uniform vec3 stroke;
  uniform vec3 secondary;

  void main() {
    // position relative to the center, in css px
    vec2 p = (gl_FragCoord.xy - resolution / 2.0) / pixelRatio;

    // distance to the square's outline, inside or outside
    vec2 q = abs(p) - size / 2.0;
    float signedDist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float dist = abs(signedDist);

    // solid for the 1px line, then an S curve (hill function): exactly 1 at the
    // line, 0.5 at mid px, easing toward 0. steepness sets how sharp the S is;
    // the slope at mid is -steepness / (4 * mid)
    float d = max(dist - 0.5, 0.0);
    float alpha = 1.0 / (1.0 + pow(d / mid, steepness));

    // the color shifts from stroke toward secondary as alpha falls, then
    // blends over the background by alpha
    vec3 color = mix(secondary, stroke, alpha);
    gl_FragColor = vec4(mix(bg, color, alpha), 1.0);
  }
`

const $canvas = $.id('canvas')
const $config = $.id('config')
const $graph = $.id('graph')
const gl = $canvas.getContext('webgl')

const compile = (type, source) => {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }
  return shader
}

const program = gl.createProgram()
gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER))
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER))
gl.linkProgram(program)
gl.useProgram(program)

// one triangle pair covering the whole canvas
gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
const position = gl.getAttribLocation(program, 'position')
gl.enableVertexAttribArray(position)
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

const uniforms = Object.fromEntries(
  ['resolution', 'size', 'pixelRatio', 'mid', 'steepness', 'bg', 'stroke', 'secondary']
    .map(name => [name, gl.getUniformLocation(program, name)])
)

const config = { ...DEFAULTS }

// '#ffff00' -> [1, 1, 0]
const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

// same falloff as the fragment shader, by distance from the middle of the line
function alphaAt(dist) {
  const d = Math.max(Math.abs(dist) - 0.5, 0)
  return 1 / (1 + (d / config.mid) ** config.steepness)
}

// distance from the middle of the line where alpha drops to 1%
const fadedDist = () => config.mid * 99 ** (1 / config.steepness) + 0.5

// alpha across the line: negative is inward, positive is outward
function renderGraph() {
  const pixelRatio = window.devicePixelRatio || 1
  const cssWidth = $graph.clientWidth
  const cssHeight = $graph.clientHeight
  $graph.width = cssWidth * pixelRatio
  $graph.height = cssHeight * pixelRatio

  const g = $graph.getContext('2d')
  g.scale(pixelRatio, pixelRatio)

  const pad = { left: 32, right: 8, top: 8, bottom: 20 }
  const w = cssWidth - pad.left - pad.right
  const h = cssHeight - pad.top - pad.bottom
  const maxDist = Math.min(Math.max(Math.ceil(fadedDist() * 1.25), 5), 5000)

  const toX = dist => pad.left + (dist + maxDist) / (2 * maxDist) * w
  const toY = alpha => pad.top + (1 - alpha) * h

  g.fillStyle = '#111'
  g.fillRect(0, 0, cssWidth, cssHeight)

  g.strokeStyle = '#444'
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(toX(0), pad.top)
  g.lineTo(toX(0), pad.top + h)
  g.moveTo(pad.left, pad.top + h)
  g.lineTo(pad.left + w, pad.top + h)
  g.stroke()

  g.fillStyle = '#888'
  g.font = '10px monospace'
  g.textAlign = 'right'
  g.textBaseline = 'middle'
  g.fillText('1', pad.left - 4, toY(1))
  g.fillText('0', pad.left - 4, toY(0))
  g.textBaseline = 'top'
  g.textAlign = 'left'
  g.fillText(`-${maxDist}px`, toX(-maxDist), pad.top + h + 4)
  g.textAlign = 'center'
  g.fillText('0', toX(0), pad.top + h + 4)
  g.textAlign = 'right'
  g.fillText(`${maxDist}px`, toX(maxDist), pad.top + h + 4)

  g.strokeStyle = config.stroke
  g.lineWidth = 1.5
  g.beginPath()
  const steps = w * 2
  for (let i = 0; i <= steps; i++) {
    const dist = -maxDist + 2 * maxDist * i / steps
    const x = toX(dist)
    const y = toY(alphaAt(dist))
    i ? g.lineTo(x, y) : g.moveTo(x, y)
  }
  g.stroke()
}

function render() {
  const pixelRatio = window.devicePixelRatio || 1
  $canvas.width = Math.round(window.innerWidth * pixelRatio)
  $canvas.height = Math.round(window.innerHeight * pixelRatio)
  gl.viewport(0, 0, $canvas.width, $canvas.height)

  gl.uniform2f(uniforms.resolution, $canvas.width, $canvas.height)
  gl.uniform2f(uniforms.size, config.width, config.height)
  gl.uniform1f(uniforms.pixelRatio, pixelRatio)
  gl.uniform1f(uniforms.mid, config.mid)
  gl.uniform1f(uniforms.steepness, config.steepness)
  gl.uniform3f(uniforms.bg, ...hexToRgb(config.bg))
  gl.uniform3f(uniforms.stroke, ...hexToRgb(config.stroke))
  gl.uniform3f(uniforms.secondary, ...hexToRgb(config.secondary))

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

  renderGraph()

  const entries = Object.entries(config)
    .map(([k, v]) => `  ${k}: ${typeof v === 'string' ? `'${v}'` : v},`)
    .join('\n')
  $config.value = `const DEFAULTS = {\n${entries}\n}`
}

const $copy = $.id('copy')
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

// colors pass through as hex strings
const iden = v => v
const SLIDER_TO_CONFIG = {
  bg: iden,
  stroke: iden,
  secondary: iden,
}
const CONFIG_TO_SLIDER = {
  bg: iden,
  stroke: iden,
  secondary: iden,
}
const DISPLAY = {
  mid: v => `${v}px`,
  steepness: v => `${v} (1% at ${fadedDist().toFixed(1)}px)`,
}

const $values = {}
const updateValues = () => {
  Object.keys(DEFAULTS).forEach(key => {
    $values[key].innerHTML = (DISPLAY[key] ?? String)(config[key])
  })
}

Object.keys(DEFAULTS).forEach(key => {
  const $input = $.id(key)
  $values[key] = $.id(key + 'Value')
  $input.value = (CONFIG_TO_SLIDER[key] ?? Number)(config[key])

  $input.oninput = () => {
    config[key] = (SLIDER_TO_CONFIG[key] ?? Number)($input.value)
    updateValues()
    render()
  }
})
updateValues()

window.onresize = render
render()
