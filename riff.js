import { $ } from './$.js'
import { createSource, getCtx, setMasterVolume } from './audio.js'

// semitones above C, played as eighth notes
const C = 130
const RIFF = [
  0, // C
  4, // E
  3, // Eb
  6, // F#
  5, // F
  2, // D
  3, // D#
  4, // E
]
const SUBDIVISIONS = 2

const LOOKAHEAD = 0.1
const SCHEDULE_INTERVAL_MS = 25

const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

const semitonesToFreq = n => C * 2 ** (n / 12)
const semitonesToName = n => {
  const octave = Math.floor(n / 12)
  const name = NOTE_NAMES[((n % 12) + 12) % 12]
  return octave === 0 ? name : `${name} (${octave > 0 ? '+' : ''}${octave} oct)`
}

const $start = $.id('start')
const $bpm = $.id('bpm')
const $bpmValue = $.id('bpmValue')

// read by the scheduler for every note, so changes land on the next note
let bpm
const updateBpm = () => {
  bpm = Number($bpm.value)
  $bpmValue.innerHTML = bpm
}
$bpm.oninput = updateBpm
updateBpm()

const $volume = $.id('volume')
const $volumeValue = $.id('volumeValue')

const updateVolume = () => {
  setMasterVolume(Number($volume.value))
  $volumeValue.innerHTML = Number($volume.value).toFixed(2) + 'x'
}
$volume.oninput = updateVolume
updateVolume()

// fraction of each eighth note that sounds; the rest is silence before the next note
let noteLengthRatio
const $noteLength = $.id('noteLength')
const $noteLengthValue = $.id('noteLengthValue')

const updateNoteLength = () => {
  noteLengthRatio = Number($noteLength.value)
  $noteLengthValue.innerHTML = Math.round(noteLengthRatio * 100) + '%'
}
$noteLength.oninput = updateNoteLength
updateNoteLength()

// one slider per note, in semitones above C. edits RIFF in place,
// so changes land the next time that note comes around
const $notes = $.id('notes')
RIFF.forEach((semitones, i) => {
  const $noteName = $.span()
  const $noteFreq = $.span()
  const $note = $.create('input')(null, {
    type: 'range', min: -12, max: 24, step: 1, value: semitones
  })
  const updateNote = () => {
    RIFF[i] = Number($note.value)
    $noteName.innerHTML = semitonesToName(RIFF[i])
    $noteFreq.innerHTML = semitonesToFreq(RIFF[i]).toFixed(2) + 'hz'
  }
  $note.oninput = updateNote
  updateNote()

  $notes.append($note, $noteName, $noteFreq)
})

$start.onclick = () => {
  $start.disabled = true

  const ctx = getCtx()
  const src = createSource('sine', C)

  let noteIx = 0
  let nextNoteTime = ctx.currentTime + 0.05

  setInterval(() => {
    while (nextNoteTime < ctx.currentTime + LOOKAHEAD) {
      const noteLength = 60 / bpm / SUBDIVISIONS
      const freq = semitonesToFreq(RIFF[noteIx % RIFF.length])

      src.scheduleNote(freq, nextNoteTime, noteLength * noteLengthRatio)

      nextNoteTime += noteLength
      noteIx++
    }
  }, SCHEDULE_INTERVAL_MS)
}
