/* Lodestone pitch listener: the web tuner's signal chain as a small module.
   mic → YIN (de Cheveigné & Kawahara, 2002) → RMS + clarity gates → one-euro
   smoothing. Audio is processed in the browser and never leaves the device. */

const YIN_THRESH = 0.12;
const RMS_GATE = 0.008;
const CLARITY_GATE = 0.5;
const MAX_FREQ = 1400;          // violin E5 is 659 Hz; headroom for harmonics

export function detectYIN(buf, sampleRate, minFreq = 60) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / n) < RMS_GATE) return null;

  const tauMin = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
  const tauMax = Math.min(Math.floor(n / 2), Math.floor(sampleRate / minFreq));
  const d = new Float32Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) {
    let sum = 0;
    const lim = n - tau;
    for (let i = 0; i < lim; i++) { const x = buf[i] - buf[i + tau]; sum += x * x; }
    d[tau] = sum;
  }
  const dp = new Float32Array(tauMax + 1);
  let running = 0;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    running += d[tau];
    dp[tau] = running > 0 ? d[tau] * (tau - tauMin + 1) / running : 1;
  }
  let tau = -1;
  for (let t = tauMin + 1; t < tauMax; t++) {
    if (dp[t] < YIN_THRESH) { while (t + 1 < tauMax && dp[t + 1] < dp[t]) t++; tau = t; break; }
  }
  if (tau === -1) {
    let best = tauMin;
    for (let t = tauMin + 1; t <= tauMax; t++) if (dp[t] < dp[best]) best = t;
    if (dp[best] > 0.6) return null;
    tau = best;
  }
  let better = tau;
  if (tau > tauMin && tau < tauMax) {
    const a = dp[tau - 1], b = dp[tau], c = dp[tau + 1];
    const denom = 2 * (2 * b - a - c);
    if (denom !== 0) better = tau + (c - a) / denom;
  }
  const clarity = Math.max(0, Math.min(1, 1 - dp[tau]));
  if (clarity < CLARITY_GATE) return null;
  return { freq: sampleRate / better, clarity };
}

function oneEuro(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
  let xPrev = null, dxPrev = 0;
  const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
  return {
    filter(x, dt) {
      if (xPrev === null) { xPrev = x; return x; }
      const dx = (x - xPrev) / dt;
      const aD = alpha(dCutoff, dt);
      const dxHat = aD * dx + (1 - aD) * dxPrev;
      const a = alpha(minCutoff + beta * Math.abs(dxHat), dt);
      const xHat = a * x + (1 - a) * xPrev;
      xPrev = xHat; dxPrev = dxHat;
      return xHat;
    },
    reset(x) { xPrev = x; dxPrev = 0; },
  };
}

/** Starts the mic and calls onPitch({freq, clarity}) ~30×/s, onSilence() after
    a gap. `minFreq` can be changed live (bass needs ~28 Hz). */
export async function listen({ onPitch, onSilence, minFreq = 60 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const euro = oneEuro();
  let smoothed = null, silentFrames = 0, last = performance.now(), running = true;
  const state = { minFreq };

  const timer = setInterval(() => {
    if (!running) return;
    analyser.getFloatTimeDomainData(buf);
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    const hit = detectYIN(buf, ctx.sampleRate, state.minFreq);
    if (!hit) {
      if (++silentFrames === 12) { smoothed = null; onSilence && onSilence(); }
      return;
    }
    silentFrames = 0;
    if (smoothed && Math.abs(1200 * Math.log2(hit.freq / smoothed)) > 80) { euro.reset(hit.freq); smoothed = hit.freq; }
    else smoothed = euro.filter(hit.freq, Math.max(dt, 1 / 120));
    onPitch && onPitch({ freq: smoothed, clarity: hit.clarity });
  }, 33);

  return {
    set minFreq(v) { state.minFreq = v; },
    stop() {
      running = false; clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}
