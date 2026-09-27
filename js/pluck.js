/* Plucked-string reference tones: Karplus-Strong with an all-pass fractional
   delay, so the loop length is exact and the note is in tune (plain KS rounds
   the period to whole samples, which puts high strings several cents off). */

/** One pluck as raw samples. `t60` is how long it takes to fade 60 dB. */
export function ksSamples(sampleRate, freq, seconds = 3, t60 = 3.5, seed = 1) {
  const total = Math.floor(sampleRate * seconds);
  const out = new Float32Array(total);
  const period = sampleRate / freq;
  // loop delay = integer delay line + 0.5 (two-point average) + all-pass delta
  const nInt = Math.floor(period - 0.5 - 0.1);
  const delta = period - 0.5 - nInt;                 // 0.1 … 1.1: a stable all-pass
  const c = (1 - delta) / (1 + delta);
  const g = Math.pow(10, -3 / (t60 * freq));         // loss per trip around the loop

  // excitation: noise, softened so the attack isn't harsh, and a pluck-position
  // comb (plucked about a fifth of the way along the string)
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  const line = new Float32Array(nInt);
  for (let i = 0; i < nInt; i++) line[i] = rand();
  for (let pass = 0; pass < 2; pass++) for (let i = 1; i < nInt; i++) line[i] = 0.5 * (line[i] + line[i - 1]);
  const offset = Math.max(1, Math.round(nInt * 0.2));
  const excite = Float32Array.from(line);
  for (let i = 0; i < nInt; i++) line[i] = excite[i] - 0.8 * excite[(i + offset) % nInt];
  let peak = 0;
  for (let i = 0; i < nInt; i++) peak = Math.max(peak, Math.abs(line[i]));
  for (let i = 0; i < nInt; i++) line[i] /= peak || 1;

  let w = 0, prev = 0, apX = 0, apY = 0;
  for (let n = 0; n < total; n++) {
    const x = line[w];
    const avg = 0.5 * (x + prev); prev = x;
    const ap = c * avg + apX - c * apY; apX = avg; apY = ap;
    line[w] = ap * g;
    w = (w + 1) % nInt;
    out[n] = x;
  }
  // tiny fade-in against clicks, fade-out at the tail
  for (let i = 0; i < 64 && i < total; i++) out[i] *= i / 64;
  const tail = Math.floor(sampleRate * 0.25);
  for (let i = 0; i < tail; i++) out[total - 1 - i] *= i / tail;
  return out;
}

const cache = new Map();

/** Plays a pluck on `ctx`. Lower strings ring longer, like real ones. */
export function pluck(ctx, freq, { gain = 0.35, pan = 0 } = {}) {
  const key = `${ctx.sampleRate}:${freq.toFixed(3)}`;
  let buffer = cache.get(key);
  if (!buffer) {
    const t60 = Math.max(1.6, Math.min(5, 450 / freq));   // ~5 s on a low E, ~1.6 s up high
    const samples = ksSamples(ctx.sampleRate, freq, Math.min(4, t60 + 0.6), t60, Math.round(freq * 7));
    buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.copyToChannel(samples, 0);
    cache.set(key, buffer);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  let node = src.connect(amp);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(ctx.destination);
  src.start();
  return { duration: buffer.duration };
}
