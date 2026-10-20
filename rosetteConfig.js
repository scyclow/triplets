// the rosette scratchpad's settings (rosetteLab.html). paste a config from the page here to change the defaults.
// lengths are in rosette units, except the look's, which are css px
export const DEFAULTS = {
  style: 'numismatic',

  // gears (see generateGears in rosetteGL.js)
  seed: 1,
  gears: 2,
  amplitude: 0.12,
  rotationMin: 1,
  rotationMax: 16,
  oddRotations: true,
  smoothed: false,
  symmetry: 'vertical',
  starts: 'fixed',

  // layers
  layers: 20,
  minSize: 3.5,
  spacing: 3.5,
  radiaChange: 0,
  layerRotation: 0,
  pointCount: 1200,

  // numismatic style only (see styles.js in real-world-assets)
  numismatic: {
    amplitude: 2.25,
    shrink: 1,
    minAmplitude: 0.7,
    overlap: 0.25,
    oscillations: 36,
    oscillationsPerLayer: 0,
    minWavelength: 1.25,
    evenSwings: true,
    repeats: 6,
    spread: 1,
    curve: 1,
    floor: 1.2,
  },

  // look
  lineWidth: 1,
  glowMid: 1.5,
  glowSteepness: 2.5,
  bg: '#000000',
  stroke: '#ff1900',
  secondary: '#ffa200',
}
