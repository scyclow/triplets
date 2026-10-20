import { DEFAULTS } from './glowConfig.js'
import { hexToRgb } from './viz.js'

// Adapted from rosettes/docs/sinewave.html: a rosette is a chain of gears, each
// a radius spinning a whole number of turns from a starting angle. The sum of
// the gears' y positions is the waveform; the rosette is the same sum in 2d.
//
// Here every sounding note is a gear. Over one cycle of the combined wave,
// a note at `freq` turns freq * cycleLength times, its radius is its volume,
// and it starts at the note's phase. So the rosette's y is the scope's sum line.
//
// Drawn as a glowing line with the glow.html falloff. Each segment of the curve
// is a quad around a capsule; MAX blending keeps the brightest glow where they
// overlap, which is the same as the glow of the nearest point on the curve.

const POINTS = 600
// alpha this low is treated as fully faded, which bounds how big the quads are
const MIN_ALPHA = 0.03

const VERTEX_SHADER = `
  attribute vec2 corner;  // -1 or 1, per quad corner
  attribute vec2 a;       // segment start, css px from center
  attribute vec2 b;       // segment end

  uniform vec2 resolution;  // css px
  uniform float reach;

  varying vec2 pos;
  varying vec2 segA;
  varying vec2 segB;

  void main() {
    vec2 dir = b - a;
    float len = length(dir);
    vec2 along = len > 0.0 ? dir / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);

    vec2 center = (a + b) / 2.0;
    pos = center
      + along * corner.x * (len / 2.0 + reach)
      + across * corner.y * reach;
    segA = a;
    segB = b;

    gl_Position = vec4(pos / (resolution / 2.0), 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;

  uniform float mid;
  uniform float steepness;
  uniform float reach;
  uniform vec3 primary;
  uniform vec3 secondary;

  varying vec2 pos;
  varying vec2 segA;
  varying vec2 segB;

  void main() {
    vec2 ab = segB - segA;
    float h = clamp(dot(pos - segA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float dist = length(pos - segA - ab * h);

    float d = max(dist - 0.5, 0.0);
    float alpha = 1.0 / (1.0 + pow(d / mid, steepness));
    // ease the last bit to 0 so the quad edges don't show
    alpha *= 1.0 - smoothstep(reach * 0.7, reach, dist);

    gl_FragColor = vec4(mix(secondary, primary, alpha) * alpha, 1.0);
  }
`

// gears: [{ turns, radius, phase }]. returns POINTS + 1 points, closed when
// every gear makes a whole number of turns
export function rosettePoints(gears) {
  return Array.from({ length: POINTS + 1 }, (_, i) => {
    const u = i / POINTS
    return gears.reduce(([x, y], g) => {
      const angle = g.phase + 2 * Math.PI * g.turns * u
      return [x + g.radius * Math.cos(angle), y + g.radius * Math.sin(angle)]
    }, [0, 0])
  })
}

export function createRosetteViz(canvas) {
  const gl = canvas.getContext('webgl')
  const minmax = gl.getExtension('EXT_blend_minmax')

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

  const uniforms = Object.fromEntries(
    ['resolution', 'reach', 'mid', 'steepness', 'primary', 'secondary']
      .map(name => [name, gl.getUniformLocation(program, name)])
  )
  const attributes = Object.fromEntries(
    ['corner', 'a', 'b'].map(name => [name, gl.getAttribLocation(program, name)])
  )

  // distance from the line where the falloff reaches MIN_ALPHA
  const reach = DEFAULTS.mid * (1 / MIN_ALPHA - 1) ** (1 / DEFAULTS.steepness) + 0.5
  gl.uniform1f(uniforms.reach, reach)
  gl.uniform1f(uniforms.mid, DEFAULTS.mid)
  gl.uniform1f(uniforms.steepness, DEFAULTS.steepness)

  // two triangles per segment, 6 vertices, each with its corner and both endpoints
  const CORNERS = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]
  const vertexData = new Float32Array(POINTS * 6 * 6)
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  const stride = 6 * 4
  gl.enableVertexAttribArray(attributes.corner)
  gl.vertexAttribPointer(attributes.corner, 2, gl.FLOAT, false, stride, 0)
  gl.enableVertexAttribArray(attributes.a)
  gl.vertexAttribPointer(attributes.a, 2, gl.FLOAT, false, stride, 2 * 4)
  gl.enableVertexAttribArray(attributes.b)
  gl.vertexAttribPointer(attributes.b, 2, gl.FLOAT, false, stride, 4 * 4)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  if (minmax) gl.blendEquation(minmax.MAX_EXT)

  const [bgR, bgG, bgB] = hexToRgb(DEFAULTS.bg)

  return {
    // gears: [{ turns, radius, phase }], colors: { primary, secondary } as rgb 0-1
    draw(gears, colors) {
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
      gl.clearColor(bgR, bgG, bgB, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      if (!gears.length) return

      // scale so the furthest point sits 40% of the way from center to edge
      const points = rosettePoints(gears)
      const maxDist = Math.max(...points.map(([x, y]) => Math.hypot(x, y)))
      const scale = maxDist > 0 ? Math.min(cssWidth, cssHeight) * 0.4 / maxDist : 1

      for (let i = 0; i < POINTS; i++) {
        const [ax, ay] = points[i]
        const [bx, by] = points[i + 1]
        CORNERS.forEach(([cx, cy], j) => {
          vertexData.set(
            [cx, cy, ax * scale, ay * scale, bx * scale, by * scale],
            (i * 6 + j) * 6
          )
        })
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.DYNAMIC_DRAW)

      gl.uniform2f(uniforms.resolution, cssWidth, cssHeight)
      gl.uniform3f(uniforms.primary, ...colors.primary)
      gl.uniform3f(uniforms.secondary, ...colors.secondary)

      gl.drawArrays(gl.TRIANGLES, 0, POINTS * 6)
    },
  }
}
