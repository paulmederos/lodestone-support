/* Lodestone tunings: the same instruments and tunings as the app
   (lodestone-ios/Lodestone/Model/Instruments.swift). Strings are MIDI note
   numbers in playing order, from the string nearest your face (lowest on
   guitar) to the farthest. Re-entrant ukulele isn't sorted by pitch: G4 C4 E4 A4. */

export const A4 = 440;
const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT  = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
const RED_ANCHOR = 4;              // E reads red, like the app

export const INSTRUMENTS = [
  { id: "guitar", name: "Guitar", tunings: [
    { id: "standard",       name: "Standard",       strings: [40, 45, 50, 55, 59, 64] },
    { id: "drop-d",         name: "Drop D",         strings: [38, 45, 50, 55, 59, 64] },
    { id: "half-step-down", name: "Half step down", strings: [39, 44, 49, 54, 58, 63], flats: true },
    { id: "d-standard",     name: "D standard",     strings: [38, 43, 48, 53, 57, 62] },
    { id: "drop-c",         name: "Drop C",         strings: [36, 43, 48, 53, 57, 62] },
    { id: "dadgad",         name: "DADGAD",         strings: [38, 45, 50, 55, 57, 62] },
    { id: "open-g",         name: "Open G",         strings: [38, 43, 50, 55, 59, 62] },
    { id: "open-d",         name: "Open D",         strings: [38, 45, 50, 54, 57, 62] },
  ]},
  { id: "bass", name: "Bass", tunings: [
    { id: "standard",    name: "Standard", strings: [28, 33, 38, 43] },
    { id: "drop-d",      name: "Drop D",   strings: [26, 33, 38, 43] },
    { id: "five-string", name: "5-string", strings: [23, 28, 33, 38, 43] },
  ]},
  { id: "ukulele", name: "Ukulele", tunings: [
    { id: "standard", name: "Standard", strings: [67, 60, 64, 69] },
    { id: "low-g",    name: "Low G",    strings: [55, 60, 64, 69] },
    { id: "baritone", name: "Baritone", strings: [50, 55, 59, 64] },
  ]},
  { id: "violin", name: "Violin", tunings: [
    { id: "standard", name: "Standard", strings: [55, 62, 69, 76] },
  ]},
];

/** "guitar.drop-d" → { instrument, tuning } */
export function findTuning(key) {
  const [iid, tid] = (key || "guitar.standard").split(".");
  const instrument = INSTRUMENTS.find((i) => i.id === iid) || INSTRUMENTS[0];
  const tuning = instrument.tunings.find((t) => t.id === tid) || instrument.tunings[0];
  return { instrument, tuning, key: `${instrument.id}.${tuning.id}` };
}

export const frequency = (midi) => A4 * Math.pow(2, (midi - 69) / 12);
export const centsBetween = (freq, midi) => 1200 * Math.log2(freq / frequency(midi));
export const pitchClass = (midi) => ((midi % 12) + 12) % 12;
export const hue = (midi) => (((pitchClass(midi) - RED_ANCHOR) % 12) + 12) % 12 / 12;

export function noteName(midi, flats = false) {
  const name = (flats ? FLAT : SHARP)[pitchClass(midi)];
  return { letter: name[0], accidental: name.slice(1), octave: Math.floor(midi / 12) - 1, display: name };
}

/** HSB → CSS rgb(), matching SwiftUI's Color(hue:saturation:brightness:). */
export function hsb(h, s, b, a = 1) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = b * (1 - s), q = b * (1 - f * s), t = b * (1 - (1 - f) * s);
  const [r, g, bl] = [[b, t, p], [q, b, p], [p, b, t], [p, q, b], [t, p, b], [b, p, q]][i % 6];
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(bl * 255)}, ${a})`;
}

/** The nearest open string, sticky to the previous one, or -1 when the note is
    far from every string (a fretted note). Same rules as the app. */
export function nearestString(freq, strings, previous = -1) {
  const d = strings.map((m) => Math.abs(centsBetween(freq, m)));
  let best = 0;
  d.forEach((v, i) => { if (v < d[best]) best = i; });
  if (d[best] > 300) return -1;
  if (previous >= 0 && previous < d.length && d[previous] <= d[best] + 40) return previous;
  return best;
}
