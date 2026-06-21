/* ============================================================================
   Lodestone — web tuner
   A faithful browser port of the app's signal chain and visuals:
     mic → YIN pitch detection → RMS + clarity gates → one-euro smoothing
         → note/cents → rainbow color flood + particle ring + filling orb dial.
   Pure Web Audio + Canvas. No dependencies. Audio is processed only in your
   browser and never leaves the device.
   ========================================================================== */

(() => {
  "use strict";

  // ---- tuning constants (mirror NoteMath.swift / Tuning) --------------------
  const A4 = 440;
  const IN_TUNE_CENTS = 5;
  const RED_ANCHOR = 4;            // E → red (guitar low-E reads red)
  const NOTE_NAMES = ["C","C♯","D","D♯","E","F","F♯","G","G♯","A","A♯","B"];

  // detection window / bounds
  const FFT = 4096;                // ~93ms at 44.1k — robust on low strings
  const MIN_FREQ = 40;             // covers bass low strings
  const MAX_FREQ = 1100;
  const YIN_THRESH = 0.12;
  const RMS_GATE = 0.008;          // silence gate (low — let clarity do the work)
  const CLARITY_GATE = 0.5;        // reject mushy frames
  const IDLE_MS = 420;             // fade to idle after this much silence

  // ---- DOM ------------------------------------------------------------------
  const stage   = document.getElementById("stage");
  const canvas  = document.getElementById("particles");
  const letterEl= document.getElementById("letter");
  const idleEl  = document.getElementById("idle");
  const centsEl = document.getElementById("cents");
  const readEl  = document.getElementById("readout");
  const orbEl   = document.getElementById("orb");
  const fillEl  = orbEl.querySelector(".fill");
  const startBtn= document.getElementById("start");
  const startSub= document.getElementById("startSub");
  if (!stage || !canvas) return;

  const ctx = canvas.getContext("2d");

  // ---- helpers --------------------------------------------------------------
  function hsbToCss(h, s, b) {
    // h,s,b in 0..1 — matches SwiftUI Color(hue:saturation:brightness:)
    const i = Math.floor(h * 6);
    const f = h * 6 - i;
    const p = b * (1 - s);
    const q = b * (1 - f * s);
    const t = b * (1 - (1 - f) * s);
    let r, g, bl;
    switch (i % 6) {
      case 0: r=b; g=t; bl=p; break;
      case 1: r=q; g=b; bl=p; break;
      case 2: r=p; g=b; bl=t; break;
      case 3: r=p; g=q; bl=b; break;
      case 4: r=t; g=p; bl=b; break;
      default:r=b; g=p; bl=q; break;
    }
    return `rgb(${Math.round(r*255)}, ${Math.round(g*255)}, ${Math.round(bl*255)})`;
  }

  function noteFrom(freq, clarity) {
    const midiExact = 69 + 12 * Math.log2(freq / A4);
    const midi = Math.round(midiExact);
    const cents = (midiExact - midi) * 100;
    const pc = ((midi % 12) + 12) % 12;
    return {
      freq, midi, cents, clarity,
      pitchClass: pc,
      octave: Math.floor(midi / 12) - 1,
      name: NOTE_NAMES[pc],
      hue: (((pc - RED_ANCHOR) % 12) + 12) % 12 / 12,
      inTune: Math.abs(cents) <= IN_TUNE_CENTS,
    };
  }

  function bgFor(note) {
    if (!note) return getComputedStyle(stage).getPropertyValue("--stage-idle") || "#0c0a1c";
    const sat = note.inTune ? 1.0 : 0.55;
    const bri = note.inTune ? 0.62 : 0.42;
    return hsbToCss(note.hue, sat, bri);
  }

  // ---- YIN pitch detection --------------------------------------------------
  // de Cheveigné & Kawahara (2002), bounded to the musical tau range.
  function detectYIN(buf, sampleRate) {
    const n = buf.length;

    // RMS gate first
    let rms = 0;
    for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / n);
    if (rms < RMS_GATE) return null;

    const tauMin = Math.max(2, Math.floor(sampleRate / MAX_FREQ));
    const tauMax = Math.min(Math.floor(n / 2), Math.floor(sampleRate / MIN_FREQ));

    const d = new Float32Array(tauMax + 1);
    for (let tau = tauMin; tau <= tauMax; tau++) {
      let sum = 0;
      const lim = n - tau;
      for (let i = 0; i < lim; i++) {
        const diff = buf[i] - buf[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    // cumulative mean normalized difference
    const dp = new Float32Array(tauMax + 1);
    dp[0] = 1;
    let running = 0;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      running += d[tau];
      dp[tau] = running > 0 ? d[tau] * (tau - tauMin + 1) / running : 1;
    }

    // absolute threshold: first local min below threshold
    let tau = -1;
    for (let t = tauMin + 1; t < tauMax; t++) {
      if (dp[t] < YIN_THRESH) {
        while (t + 1 < tauMax && dp[t + 1] < dp[t]) t++;
        tau = t; break;
      }
    }
    if (tau === -1) {
      // fall back to global min
      let best = tauMin, bestVal = dp[tauMin] || 1;
      for (let t = tauMin + 1; t <= tauMax; t++) {
        if (dp[t] < bestVal) { bestVal = dp[t]; best = t; }
      }
      if (bestVal > 0.6) return null;   // too mushy
      tau = best;
    }

    // parabolic interpolation for sub-sample precision
    let betterTau = tau;
    if (tau > tauMin && tau < tauMax) {
      const a = dp[tau - 1], b = dp[tau], c = dp[tau + 1];
      const denom = (2 * (2 * b - a - c));
      if (denom !== 0) betterTau = tau + (c - a) / denom;
    }

    const freq = sampleRate / betterTau;
    if (freq < MIN_FREQ || freq > MAX_FREQ) return null;
    const clarity = Math.max(0, Math.min(1, 1 - dp[tau]));
    if (clarity < CLARITY_GATE) return null;
    return { freq, clarity };
  }

  // ---- one-euro filter (mirror TunerEngine smoothing) -----------------------
  function makeOneEuro(minCutoff = 1.2, beta = 0.012, dCutoff = 1.0) {
    let xPrev = null, dxPrev = 0, tPrev = null;
    const alpha = (cutoff, dt) => {
      const tau = 1 / (2 * Math.PI * cutoff);
      return 1 / (1 + tau / dt);
    };
    return {
      reset() { xPrev = null; dxPrev = 0; tPrev = null; },
      filter(x, t) {
        if (xPrev === null) { xPrev = x; tPrev = t; return x; }
        const dt = Math.max(1e-3, (t - tPrev) / 1000);
        tPrev = t;
        const dx = (x - xPrev) / dt;
        const aD = alpha(dCutoff, dt);
        dxPrev = dxPrev + aD * (dx - dxPrev);
        const cutoff = minCutoff + beta * Math.abs(dxPrev);
        const a = alpha(cutoff, dt);
        xPrev = xPrev + a * (x - xPrev);
        return xPrev;
      },
    };
  }

  // ---- particle ring (port of ParticleRing.swift) ---------------------------
  const COUNT = 180;
  const MAX_SCATTER = 52;
  function seeded(seed) {
    let state = BigInt(seed) & 0xFFFFFFFFFFFFFFFFn;
    const M = 6364136223846793005n, A = 1442695040888963407n, MASK = 0xFFFFFFFFFFFFFFFFn;
    return () => {
      state = (state * M + A) & MASK;
      return Number(state >> 11n) / 9007199254740992; // /2^53
    };
  }
  const particles = (() => {
    const rng = seeded(0x10DE5709);   // same seed + draw order as ParticleRing.swift
    const out = [];
    for (let i = 0; i < COUNT; i++) {
      out.push({
        angle: i / COUNT * 2 * Math.PI + (rng() - 0.5) * 0.08,
        phase: rng() * 2 * Math.PI,
        phase2: rng() * 2 * Math.PI,
        speed: 1.1 + rng() * 1.7,
        radialAmp: 0.35 + rng() * 0.65,
        angAmp: rng(),
        dot: 1.2 + rng() * 1.8,
        alpha: 0.45 + rng() * 0.5,
      });
    }
    return out;
  })();

  function sizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return r;
  }
  let box = sizeCanvas();
  window.addEventListener("resize", () => { box = sizeCanvas(); });

  // ---- state ----------------------------------------------------------------
  let note = null;             // current DetectedNote or null
  let eased = 1.0;             // chaos eased over time (1 = wandering)
  let lastVoiceAt = 0;
  const euro = makeOneEuro();
  let smoothedFreq = null;
  let smoothedMidi = null;
  const startTime = performance.now();

  let audioCtx = null, analyser = null, micStream = null, timeBuf = null;
  let demoMode = false, demoState = null;

  // ---- render loop ----------------------------------------------------------
  function setLetter(n) {
    if (!n) { letterEl.classList.add("hidden"); idleEl.style.opacity = "1"; return; }
    idleEl.style.opacity = "0";
    const acc = n.name.length > 1 ? `<sup>♯</sup>` : "";
    letterEl.classList.remove("hidden");
    if (letterEl.dataset.pc !== String(n.pitchClass)) {
      letterEl.dataset.pc = String(n.pitchClass);
      letterEl.innerHTML = `${n.name[0]}${acc}<span class="oct">${n.octave}</span>`;
    }
  }

  function centsLabel(n) {
    if (n.inTune) return "in tune";
    const c = Math.abs(Math.round(n.cents));
    return n.cents > 0 ? `${c}¢ sharp` : `${c}¢ flat`;
  }

  function applyNoteToUI() {
    const has = !!note;
    stage.classList.toggle("has-note", has);
    stage.classList.toggle("in-tune", !!(note && note.inTune));
    stage.style.setProperty("--note-bg", bgFor(note));

    if (has) {
      setLetter(note);
      centsEl.textContent = centsLabel(note);
      readEl.textContent = `${note.name}${note.octave}  ·  ${Math.round(note.freq)} Hz`;
      // dial
      const clamped = Math.max(-50, Math.min(50, note.cents));
      const closeness = 1 - Math.min(1, Math.abs(note.cents) / 50);
      orbEl.style.left = `${50 + (clamped / 50) * 42}%`;
      fillEl.style.setProperty("--fill", closeness.toFixed(3));
    } else {
      setLetter(null);
    }
  }

  let wasInTune = false;
  function tick() {
    const now = performance.now();
    const t = (now - startTime) / 1000;

    // ---- get a fresh note (mic or demo) ----
    let detected = null;
    if (demoMode) {
      detected = demoTick(now);
    } else if (analyser) {
      analyser.getFloatTimeDomainData(timeBuf);
      const raw = detectYIN(timeBuf, audioCtx.sampleRate);
      if (raw) {
        // snap on note change, smooth a held note
        if (smoothedFreq === null || Math.abs(raw.freq / smoothedFreq - 1) > 0.03) {
          euro.reset();
          smoothedFreq = euro.filter(raw.freq, now);
        } else {
          smoothedFreq = euro.filter(raw.freq, now);
        }
        detected = noteFrom(smoothedFreq, raw.clarity);
        lastVoiceAt = now;
      }
    }

    if (detected) {
      note = detected;
    } else if (now - lastVoiceAt > IDLE_MS) {
      note = null;
      smoothedFreq = null;
    }

    // ---- chaos easing (port: easeOut ~0.5s toward target) ----
    const chaos = note ? Math.min(1, Math.abs(note.cents) / 50) : 1.0;
    eased += (chaos - eased) * 0.12;

    // ---- UI ----
    applyNoteToUI();

    // haptic on lock-in (mobile)
    const nowIn = !!(note && note.inTune);
    if (nowIn && !wasInTune && navigator.vibrate) navigator.vibrate(8);
    wasInTune = nowIn;

    // ---- particles ----
    drawParticles(t, eased, nowIn);

    requestAnimationFrame(tick);
  }

  function drawParticles(t, easedChaos, inTune) {
    const w = box.width, h = box.height;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) / 2 - MAX_SCATTER - 4;

    // faint guide ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1; ctx.stroke();

    ctx.globalCompositeOperation = "lighter";
    const glow = inTune ? 1.0 : 0.82;
    for (let k = 0; k < COUNT; k++) {
      const p = particles[k];
      const n = Math.sin(t * p.speed + p.phase) * 0.6
              + Math.sin(t * p.speed * 1.7 + p.phase2) * 0.4;
      const radius = R + 1.6 * Math.sin(t * 2 + p.phase)
                   + easedChaos * MAX_SCATTER * p.radialAmp * n;
      const ang = p.angle + easedChaos * 0.13 * p.angAmp * Math.sin(t * p.speed * 0.8 + p.phase2);
      const x = cx + Math.cos(ang) * radius;
      const y = cy + Math.sin(ang) * radius;
      const r = p.dot * (inTune ? 1.15 : 1.0);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(255,255,255,${(p.alpha * glow).toFixed(3)})`;
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  // ---- demo mode (mirror the app's -demo) -----------------------------------
  const DEMO_STRINGS = [
    { name: "E", oct: 2, freq: 82.41 },
    { name: "A", oct: 2, freq: 110.0 },
    { name: "D", oct: 3, freq: 146.83 },
    { name: "G", oct: 3, freq: 196.0 },
    { name: "B", oct: 3, freq: 246.94 },
    { name: "E", oct: 4, freq: 329.63 },
  ];
  function startDemo() {
    demoMode = true;
    demoState = { i: 0, t0: performance.now() };
    stage.classList.remove("pre-start");
    if (startBtn) startBtn.hidden = true;
  }
  function demoTick(now) {
    const s = demoState;
    const period = 2600;                       // ms per string
    const elapsed = now - s.t0;
    if (elapsed > period) { s.i = (s.i + 1) % DEMO_STRINGS.length; s.t0 = now; }
    const local = (now - s.t0) / period;        // 0..1
    const target = DEMO_STRINGS[s.i];
    // sweep from +38¢ → in tune, hold, drift slightly
    const ease = 1 - Math.pow(1 - Math.min(1, local * 1.6), 3);
    const cents = 38 * (1 - ease) + Math.sin(now / 320) * 1.2 * ease;
    const freq = target.freq * Math.pow(2, cents / 1200);
    lastVoiceAt = now;
    return noteFrom(freq, 1.0);
  }

  // ---- mic start ------------------------------------------------------------
  async function startMic() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AC();
      await audioCtx.resume();
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = audioCtx.createMediaStreamSource(micStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT;
      timeBuf = new Float32Array(analyser.fftSize);
      src.connect(analyser);
      stage.classList.remove("pre-start");
      if (startBtn) startBtn.hidden = true;
    } catch (err) {
      // denied / unsupported → offer the demo instead
      if (startSub) {
        startSub.innerHTML = `Mic unavailable — <a href="#" id="demoLink">see a live demo →</a>`;
        const dl = document.getElementById("demoLink");
        if (dl) dl.addEventListener("click", (e) => { e.preventDefault(); startDemo(); });
      }
    }
  }

  // ---- wire up --------------------------------------------------------------
  if (startBtn) startBtn.addEventListener("click", startMic);

  // before the user starts, quiet the particle field behind the start prompt
  stage.classList.add("pre-start");

  // ?demo=1 auto-runs the demo (also our QA hook, mirrors -demo)
  const params = new URLSearchParams(location.search);
  if (params.has("demo")) startDemo();

  requestAnimationFrame(tick);
})();
