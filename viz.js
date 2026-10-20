import { DEFAULTS } from './glowConfig.js'

// Glow squares (same shape and falloff as glow.html) that start at the center
// when a note plays and grow linearly to the edges over the note's duration.
//
// Color: the note's frequency shifts the hue of the default stroke color.
// hue shift = (freq / BASE_FREQ - 1) * 360, so 1x -> 0deg, 1.5x -> 180deg, 2x -> 360deg.
// The secondary color keeps the same hsl offset from the primary as the defaults have.

const BASE_FREQ = 130
const MAX_SQUARES = 8

const VERTEX_SHADER = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;

  #define MAX_SQUARES ${MAX_SQUARES}

  uniform vec2 resolution;
  uniform float pixelRatio;
  uniform float mid;
  uniform float steepness;
  uniform vec3 bg;
  uniform int count;
  uniform vec2 sizes[MAX_SQUARES];
  uniform vec3 primaries[MAX_SQUARES];
  uniform vec3 secondaries[MAX_SQUARES];

  void main() {
    vec2 p = (gl_FragCoord.xy - resolution / 2.0) / pixelRatio;
    vec3 color = bg;

    // oldest to newest, each drawn over the last
    for (int i = 0; i < MAX_SQUARES; i++) {
      if (i >= count) break;

      vec2 q = abs(p) - sizes[i] / 2.0;
      float dist = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
      float d = max(dist - 0.5, 0.0);
      float alpha = 1.0 / (1.0 + pow(d / mid, steepness));

      vec3 squareColor = mix(secondaries[i], primaries[i], alpha);
      color = mix(color, squareColor, alpha);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`

// COLOR

export const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]

  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0)
    : max === g ? (b - r) / d + 2
    : (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb([h, s, l]) {
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0), f(8), f(4)]
}

const PRIMARY_HSL = rgbToHsl(hexToRgb(DEFAULTS.stroke))
const SECONDARY_HSL = rgbToHsl(hexToRgb(DEFAULTS.secondary))
const SECONDARY_HUE_OFFSET = SECONDARY_HSL[0] - PRIMARY_HSL[0]

const wrapHue = h => ((h % 360) + 360) % 360

export function colorsForFreq(freq) {
  const hue = PRIMARY_HSL[0] + (freq / BASE_FREQ - 1) * 360
  return {
    primary: hslToRgb([wrapHue(hue), PRIMARY_HSL[1], PRIMARY_HSL[2]]),
    secondary: hslToRgb([wrapHue(hue + SECONDARY_HUE_OFFSET), SECONDARY_HSL[1], SECONDARY_HSL[2]]),
  }
}

// RENDERER

export function createViz(canvas) {
  const gl = canvas.getContext('webgl')

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

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  const uniforms = Object.fromEntries(
    ['resolution', 'pixelRatio', 'mid', 'steepness', 'bg', 'count', 'sizes', 'primaries', 'secondaries']
      .map(name => [name, gl.getUniformLocation(program, name)])
  )

  gl.uniform1f(uniforms.mid, DEFAULTS.mid)
  gl.uniform1f(uniforms.steepness, DEFAULTS.steepness)
  gl.uniform3f(uniforms.bg, ...hexToRgb(DEFAULTS.bg))

  // the shape keeps the default width:height ratio
  const aspect = DEFAULTS.height / DEFAULTS.width

  let notes = []

  return {
    // two layers playing the same note at the same time (like triplets and
    // triplets 2) only get one square
    addNote(time, duration, freq) {
      if (notes.some(n => n.time === time && n.freq === freq)) return
      notes.push({ time, duration, freq, ...colorsForFreq(freq) })
    },

    // the newest note sounding at `now`, if any
    newestNote(now) {
      return notes
        .filter(n => n.time <= now && now < n.time + n.duration)
        .sort((a, b) => a.time - b.time)
        .at(-1)
    },

    draw(now) {
      const pixelRatio = window.devicePixelRatio || 1
      const cssWidth = canvas.clientWidth
      const cssHeight = canvas.clientHeight
      const width = Math.round(cssWidth * pixelRatio)
      const height = Math.round(cssHeight * pixelRatio)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      gl.viewport(0, 0, width, height)

      notes = notes.filter(n => now < n.time + n.duration)
      const playing = notes
        .filter(n => n.time <= now)
        .sort((a, b) => a.time - b.time)
        .slice(-MAX_SQUARES)

      // full size is when the square's sides reach the canvas edges
      const fullWidth = Math.min(cssWidth, cssHeight / aspect)
      const sizes = new Float32Array(MAX_SQUARES * 2)
      const primaries = new Float32Array(MAX_SQUARES * 3)
      const secondaries = new Float32Array(MAX_SQUARES * 3)
      playing.forEach((n, i) => {
        const w = fullWidth * (now - n.time) / n.duration
        sizes.set([w, w * aspect], i * 2)
        primaries.set(n.primary, i * 3)
        secondaries.set(n.secondary, i * 3)
      })

      gl.uniform2f(uniforms.resolution, width, height)
      gl.uniform1f(uniforms.pixelRatio, pixelRatio)
      gl.uniform1i(uniforms.count, playing.length)
      gl.uniform2fv(uniforms.sizes, sizes)
      gl.uniform3fv(uniforms.primaries, primaries)
      gl.uniform3fv(uniforms.secondaries, secondaries)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
  }
}
