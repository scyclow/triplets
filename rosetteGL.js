// The rosette algorithm from real-world-assets/docs, drawn with WebGL.
//
// Ported: rolling gears (generateGears, withSymmetry, withStarts in gears.js), a layer's ring (ring() in
// rosette.js: a circle base gear with the gears riding on it, radia change, layer rotation), and two styles
// from styles.js: standard (every layer its own closed line) and numismatic (layers of woven waves).
// Left out: the other styles, non-circle bases, noise, curve², spiral, shadow/multiple passes, aura, clipping.
//
// The vertex shader computes every point of every ring from the gears. The CPU only rolls the gears and lays
// out the numismatic layers (each one's size and swing count, which needs its ring's circumference).
// Every ring is drawn as a loop of points alternating in (even) and out (odd) of the ring at `size` by `swing`,
// joined by curves (catmull-rom, tension `curve`). standard is the same with no swing and straight lines.

const TWO_PI = Math.PI * 2
export const MAX_GEARS = 12
// cubic curve pieces per span between two points (numismatic). standard draws straight lines
const CURVE_STEPS = 6

// ---------------------------------------------------------------------------------------------------- random

// mulberry32, as createRandom in real-world-assets utils.js
function createRandom(seed) {
  let s = seed >>> 0
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const rnd = (mn, mx) => {
    const out = next()
    if (mx != null) return mn + out * (mx - mn)
    if (mn != null) return out * mn
    return out
  }
  const prb = x => rnd() < x
  return { rnd, prb, posOrNeg: (x=1) => x * (prb(0.5) ? 1 : -1) }
}

// ---------------------------------------------------------------------------------------------------- gears

// generateGears from gears.js, with fixed starts: each gear turns `rotation` times per trip around the base
// gear (negative turns backwards), starting `phase` of a turn in, with a radius of `radia` times the layer's size
function generateGears({ count, rolled, rotationMin, rotationMax, radiaMin, radiaMax, oddRotations, positive }, r) {
  return Array.from({ length: Math.max(count, rolled) }, () => {
    let rotation = rotationMin
      ? r.posOrNeg(Math.trunc(r.rnd(rotationMin, rotationMax)))
      : Math.trunc(r.rnd(-rotationMax, rotationMax))
    if (positive) rotation = Math.abs(rotation)
    if (oddRotations && rotation % 2 === 0) rotation += rotation < 0 ? -1 : 1
    return { rotation, radia: r.rnd(radiaMin, radiaMax), phase: 0 }
  }).slice(0, count)
}

// withSymmetry from gears.js
function withSymmetry(gears, symmetry, r) {
  return gears.map(g => {
    if (symmetry === 'none') return { ...g, phase: r.rnd() }
    if (symmetry === 'vertical') return { ...g, phase: 0 }
    let rotation = g.rotation || 1
    if (symmetry === 'both') {
      if (rotation % 2 === 0) rotation += rotation < 0 ? -1 : 1
      return { ...g, rotation, phase: 0 }
    }
    return { ...g, rotation, phase: rotation % 2 ? 0 : (1 - rotation) / (4 * rotation) }
  })
}

// withStarts from gears.js
function withStarts(gears, starts, r) {
  const picked = starts === 'random' ? (r.rnd() < 0.5 ? 'fixed' : 'even') : starts
  if (picked !== 'even') return gears
  return gears.map(g => ({ ...g, phase: g.phase + (r.rnd() < 0.5 ? 0 : 0.5) }))
}

// the gears for a config, as real-world-assets rolls them: always MAX_GEARS rolled and the first `gears` kept,
// so changing the count changes nothing else
export function rollGears(c) {
  const gears = generateGears({
    count: c.gears,
    rolled: MAX_GEARS,
    rotationMin: c.rotationMin,
    rotationMax: c.rotationMax,
    radiaMin: c.amplitude / 2,
    radiaMax: c.amplitude,
    oddRotations: c.oddRotations,
    positive: c.smoothed,
  }, createRandom(c.seed))
  return withStarts(withSymmetry(gears, c.symmetry, createRandom(c.seed + 7919)), c.starts, createRandom(c.seed + 7927))
}

// ---------------------------------------------------------------------------------------------------- rings

// ring() from rosette.js, for one point: progress (0-1) around the layer of a given size. angle 0 is straight
// down, turning toward +x. the shader's ringPoint is the same
function ringPoint(c, gears, progress, size) {
  const t = Math.max(0, (size - c.minSize) / c.spacing)
  let x = Math.sin(TWO_PI * progress) * size
  let y = Math.cos(TWO_PI * progress) * size
  for (const g of gears) {
    const radia = g.radia - c.radiaChange * t / Math.max(c.layers - 1, 1)
    const angle = (progress + g.phase) * g.rotation * TWO_PI
    x += Math.sin(angle) * size * radia
    y += Math.cos(angle) * size * radia
  }
  const turn = c.layerRotation * t * Math.PI / 180
  return [x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)]
}

function ringLength(c, gears, size) {
  let total = 0
  let prev = ringPoint(c, gears, 0, size)
  for (let i = 1; i <= c.pointCount; i++) {
    const p = ringPoint(c, gears, i / c.pointCount, size)
    total += Math.hypot(p[0] - prev[0], p[1] - prev[1])
    prev = p
  }
  return total
}

// every layer as its own closed line
function standardRings(c) {
  return Array.from({ length: c.layers }, (_, t) => ({
    size: c.minSize + t * c.spacing,
    swing: 0,
    n: c.pointCount / 2,
    start: 0,
  }))
}

// the numismatic style from styles.js: the layout of its layers, as rings to draw. see there for what every
// setting does
function numismaticRings(c, gears) {
  const { amplitude, shrink, minAmplitude, overlap, oscillations, oscillationsPerLayer, minWavelength, evenSwings, repeats, spread, curve, floor } = c.numismatic
  const unit = c.spacing
  const outer = c.minSize + (c.layers - 1) * c.spacing

  const swingAt = size => Math.max(minAmplitude * unit, amplitude * unit * (1 - shrink + shrink * size / outer))
  const sizeReaching = top => {
    const a = amplitude * unit * (1 - shrink)
    const b = amplitude * unit * shrink / outer
    const size = (top - a) / (1 + b)
    return a + b * size >= minAmplitude * unit ? size : top - minAmplitude * unit
  }

  const swingsAt = (size, k) => {
    const around = ringLength(c, gears, size)
    const swings = Math.max(2, Math.min(Math.round(oscillations - k * oscillationsPerLayer), Math.floor(around / (minWavelength * unit))))
    return evenSwings ? swings - swings % 2 : swings
  }

  const startsFor = n => Array.from({ length: repeats }, (_, r) => r / repeats * spread / n)

  const lowestSwing = ({ n }, p) => Math.min(...startsFor(n).map(start => {
    const u = ((((p - start) * 2 * n) % 2) + 2) % 2
    const fromIn = Math.min(u, 2 - u)
    return (1 - curve) * (2 * fromIn - 1) - curve * Math.cos(Math.PI * fromIn)
  }))

  const sizeInside = (outerLayer, n) => {
    const worst = Math.max(...startsFor(n).flatMap(start =>
      Array.from({ length: n }, (_, j) => lowestSwing(outerLayer, start + (j + 0.5) / n))
    ))
    return Math.min(
      sizeReaching(outerLayer.size + swingAt(outerLayer.size) * Math.min(worst, 0) + overlap * unit),
      outerLayer.size - unit / 10
    )
  }

  const nextIn = (outerLayer, k) => {
    let n = swingsAt(outerLayer.size, k + 1)
    let size = sizeInside(outerLayer, n)
    for (let tries = 0; tries < 3 && swingsAt(size, k + 1) !== n; tries++) {
      n = swingsAt(size, k + 1)
      size = sizeInside(outerLayer, n)
    }
    return { size, n }
  }

  const first = sizeReaching(outer)
  const layers = [{ size: first, n: swingsAt(first, 0) }]
  while (layers.length < 100) {
    const next = nextIn(layers.at(-1), layers.length - 1)
    if (next.size - swingAt(next.size) < floor * unit) break
    layers.push(next)
  }

  return layers.flatMap(({ size, n }) => startsFor(n).map(start => ({ size, swing: swingAt(size), n, start })))
}

// ---------------------------------------------------------------------------------------------------- drawing

const VERTEX_SHADER = `
  #define MAX_GEARS ${MAX_GEARS}
  #define TWO_PI 6.2831853

  attribute vec4 ring;   // size, swing, n (swings), start (0-1 around)
  attribute vec4 seg;    // span between points j and j + 1, curve step, quad corner x, y

  uniform vec3 gears[MAX_GEARS];  // rotation, radia, phase
  uniform int gearCount;
  uniform float minSize;
  uniform float spacing;
  uniform float radiaChange;
  uniform float layerCount;
  uniform float layerRotation;
  uniform float floorSize;
  uniform float curve;
  uniform float steps;
  uniform float scale;      // css px per rosette unit
  uniform vec2 resolution;  // css px
  uniform float reach;      // css px

  varying vec2 pos;
  varying vec2 segA;
  varying vec2 segB;

  // ring() from rosette.js, for one point
  vec2 ringPoint(float progress, float size) {
    float t = max(0.0, (size - minSize) / spacing);
    vec2 p = vec2(sin(TWO_PI * progress), cos(TWO_PI * progress)) * size;
    for (int j = 0; j < MAX_GEARS; j++) {
      if (j >= gearCount) break;
      float radia = gears[j].y - radiaChange * t / max(layerCount - 1.0, 1.0);
      float angle = (progress + gears[j].z) * gears[j].x * TWO_PI;
      p += vec2(sin(angle), cos(angle)) * size * radia;
    }
    float turn = radians(layerRotation * t);
    return vec2(p.x * cos(turn) - p.y * sin(turn), p.x * sin(turn) + p.y * cos(turn));
  }

  // the k-th point around the loop: in (even) or out (odd) of the ring
  vec2 loopPoint(float k) {
    float progress = ring.w + k / (2.0 * ring.z);
    bool isOut = mod(k, 2.0) > 0.5;
    float size = isOut ? ring.x + ring.y : max(floorSize, ring.x - ring.y);
    return ringPoint(progress, size);
  }

  // the curve from point j to j + 1, u of the way along (curveLoop in styles.js)
  vec2 curveAt(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float u) {
    vec2 a = p1 + curve * (p2 - p0) / 6.0;
    vec2 b = p2 - curve * (p3 - p1) / 6.0;
    float v = 1.0 - u;
    return v * v * v * p1 + 3.0 * v * v * u * a + 3.0 * v * u * u * b + u * u * u * p2;
  }

  void main() {
    float j = seg.x;
    vec2 p0 = loopPoint(j - 1.0);
    vec2 p1 = loopPoint(j);
    vec2 p2 = loopPoint(j + 1.0);
    vec2 p3 = loopPoint(j + 2.0);

    // css px, y up (the rosette's +y is down the screen)
    vec2 flip = vec2(scale, -scale);
    vec2 a = curveAt(p0, p1, p2, p3, seg.y / steps) * flip;
    vec2 b = curveAt(p0, p1, p2, p3, (seg.y + 1.0) / steps) * flip;

    vec2 dir = b - a;
    float len = length(dir);
    vec2 along = len > 0.0 ? dir / len : vec2(1.0, 0.0);
    vec2 across = vec2(-along.y, along.x);
    pos = (a + b) / 2.0
      + along * seg.z * (len / 2.0 + reach)
      + across * seg.w * reach;
    segA = a;
    segB = b;

    gl_Position = vec4(pos / (resolution / 2.0), 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision highp float;

  uniform float lineWidth;
  uniform float mid;
  uniform float steepness;
  uniform float reach;
  uniform vec3 stroke;
  uniform vec3 secondary;

  varying vec2 pos;
  varying vec2 segA;
  varying vec2 segB;

  void main() {
    vec2 ab = segB - segA;
    float h = clamp(dot(pos - segA, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    float dist = length(pos - segA - ab * h);

    // solid across the line's width, then the glow.html falloff, eased to 0 at the quad's edge
    float d = max(dist - lineWidth / 2.0, 0.0);
    float alpha = 1.0 / (1.0 + pow(d / mid, steepness));
    alpha *= 1.0 - smoothstep(reach * 0.7, reach, dist);

    gl_FragColor = vec4(mix(secondary, stroke, alpha) * alpha, 1.0);
  }
`

// alpha this low counts as faded, which bounds how far each line's quad reaches
const MIN_ALPHA = 0.02
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)

export function createRosetteGL(canvas) {
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
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
  gl.useProgram(program)

  const uniforms = Object.fromEntries([
    'gears', 'gearCount', 'minSize', 'spacing', 'radiaChange', 'layerCount', 'layerRotation', 'floorSize',
    'curve', 'steps', 'scale', 'resolution', 'reach', 'lineWidth', 'mid', 'steepness', 'stroke', 'secondary',
  ].map(name => [name, gl.getUniformLocation(program, name)]))

  const ringAttr = gl.getAttribLocation(program, 'ring')
  const segAttr = gl.getAttribLocation(program, 'seg')
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.enableVertexAttribArray(ringAttr)
  gl.vertexAttribPointer(ringAttr, 4, gl.FLOAT, false, 8 * 4, 0)
  gl.enableVertexAttribArray(segAttr)
  gl.vertexAttribPointer(segAttr, 4, gl.FLOAT, false, 8 * 4, 4 * 4)

  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE)
  if (minmax) gl.blendEquation(minmax.MAX_EXT)

  let vertexCount = 0
  let extent = 1

  return {
    // rebuilds the rings from a config (see rosetteConfig.js). returns some stats about what was built
    build(c) {
      const gears = rollGears(c)
      const isNumismatic = c.style === 'numismatic'
      const rings = isNumismatic ? numismaticRings(c, gears) : standardRings(c)
      const steps = isNumismatic ? CURVE_STEPS : 1

      const segments = rings.reduce((total, r) => total + 2 * r.n * steps, 0)
      const data = new Float32Array(segments * 6 * 8)
      let o = 0
      rings.forEach(({ size, swing, n, start }) => {
        for (let j = 0; j < 2 * n; j++) {
          for (let s = 0; s < steps; s++) {
            for (const [cx, cy] of CORNERS) {
              data.set([size, swing, n, start, j, s, cx, cy], o)
              o += 8
            }
          }
        }
      })
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
      vertexCount = segments * 6

      // how far out it reaches, at most, for fitting it to the canvas
      const gearReach = 1 + gears.reduce((total, g) => total + Math.abs(g.radia), 0)
      extent = Math.max(...rings.map(r => (r.size + r.swing) * gearReach), 1e-6)

      const gearData = new Float32Array(MAX_GEARS * 3)
      gears.forEach((g, i) => gearData.set([g.rotation, g.radia, g.phase], i * 3))
      gl.uniform3fv(uniforms.gears, gearData)
      gl.uniform1i(uniforms.gearCount, gears.length)
      gl.uniform1f(uniforms.minSize, c.minSize)
      gl.uniform1f(uniforms.spacing, c.spacing)
      gl.uniform1f(uniforms.radiaChange, c.radiaChange)
      gl.uniform1f(uniforms.layerCount, c.layers)
      gl.uniform1f(uniforms.layerRotation, c.layerRotation)
      gl.uniform1f(uniforms.floorSize, isNumismatic ? c.numismatic.floor * c.spacing : 0)
      gl.uniform1f(uniforms.curve, isNumismatic ? c.numismatic.curve : 0)
      gl.uniform1f(uniforms.steps, steps)

      return { gears, rings: rings.length, segments }
    },

    draw(c) {
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
      gl.clearColor(...hexToRgb(c.bg), 1)
      gl.clear(gl.COLOR_BUFFER_BIT)

      const reach = c.lineWidth / 2 + c.glowMid * (1 / MIN_ALPHA - 1) ** (1 / c.glowSteepness)
      gl.uniform1f(uniforms.scale, Math.min(cssWidth, cssHeight) * 0.45 / extent)
      gl.uniform2f(uniforms.resolution, cssWidth, cssHeight)
      gl.uniform1f(uniforms.reach, reach)
      gl.uniform1f(uniforms.lineWidth, c.lineWidth)
      gl.uniform1f(uniforms.mid, c.glowMid)
      gl.uniform1f(uniforms.steepness, c.glowSteepness)
      gl.uniform3f(uniforms.stroke, ...hexToRgb(c.stroke))
      gl.uniform3f(uniforms.secondary, ...hexToRgb(c.secondary))

      gl.drawArrays(gl.TRIANGLES, 0, vertexCount)
    },
  }
}
