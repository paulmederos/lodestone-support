/* Lodestone strings: an instrument's open strings you can pluck, strum, and tune.
   three.js scene: the strings recede like a neck and taper toward the nut. A
   plucked string blurs into the lens shape a real vibrating string makes and
   glows in its note's color while it rings (a Karplus-Strong tone at the exact
   pitch). With the mic on, the nearest string lights and glows brighter as it
   comes into tune, and settles still when it's there, the same as the app. */

import * as THREE from "three";
import { INSTRUMENTS, findTuning, frequency, centsBetween, noteName, hue, hsb, nearestString } from "./tunings.js";
import { pluck } from "./pluck.js";
import { listen } from "./pitch.js";

// --- feel (one place to dial) ---------------------------------------------------
const LEN = 10;                 // string length (world units)
const SPACING = 1.0;            // string to string at the near end
const TAPER = 0.3;              // how much narrower the far end is
const PLUCK_AMP = 0.26;         // sway of a fresh pluck
const MIC_SWAY = 0.06;          // sway of a far-off string under the mic
const GLOW_CURVE = 1.6;         // same as the app's string glow
const IN_TUNE = 5;              // cents

const VERT = /* glsl */ `
  uniform float uX0, uTaper, uLen, uHalfW, uAmp;
  varying float vX, vEnvW, vU;
  void main() {
    float u = position.y + 0.5;                    // 0 near … 1 far
    float env = sin(3.14159265 * u);               // fixed at both ends
    float x0 = uX0 * (1.0 - uTaper * u);
    float halfW = uHalfW + uAmp * env;
    vX = position.x * 2.0 * halfW;                 // world offset from the string's rest line
    vEnvW = uAmp * env;
    vU = u;
    vec3 p = vec3(x0 + vX, (u - 0.5) * uLen, 0.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uCore, uBase, uGlow, uFade, uTime, uAmp;
  varying float vX, vEnvW, vU;
  void main() {
    float d = abs(vX);
    // the string at rest: a crisp core line
    float core = smoothstep(uCore, uCore * 0.35, d);
    // vibrating: a lens of blur, brightest at its edges where the string lingers
    float vib = 0.0;
    if (vEnvW > uCore * 0.6) {
      float r = clamp(d / vEnvW, 0.0, 1.0);
      float edge = smoothstep(1.0, 0.92, r);
      vib = (0.18 + 0.82 * pow(r, 6.0)) * edge * (0.85 + 0.15 * sin(uTime * 38.0 + vU * 6.0));
      core *= 1.0 - clamp(vEnvW / (uCore * 8.0), 0.0, 0.85);
    }
    float glow = exp(-pow(d / (uCore * 7.0 + vEnvW), 2.0)) * uGlow;
    float ends = smoothstep(0.0, 0.03, vU) * smoothstep(1.0, 0.86, vU);
    float a = (core * mix(uBase, 1.0, uGlow) + vib * (0.55 + 0.45 * uGlow) + glow * 0.55) * ends * uFade;
    vec3 col = mix(vec3(1.0), uColor, 0.35 + 0.4 * uGlow);
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));   // additive blend multiplies by alpha once
  }`;

export function mountStrings(root, { tuningKey = "guitar.standard", selector = true } = {}) {
  let current = findTuning(root.dataset.tuning || tuningKey);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- DOM -------------------------------------------------------------------------
  root.classList.add("strings-app");
  root.innerHTML = `
    <div class="sa-readout" aria-live="polite">
      <span class="sa-note"></span><span class="sa-detail"></span>
    </div>
    <div class="sa-stage">
      <canvas class="sa-canvas" aria-hidden="true"></canvas>
      <div class="sa-labels" role="group" aria-label="Strings"></div>
    </div>
    <div class="sa-controls">
      ${selector ? `<div class="sa-instruments" role="radiogroup" aria-label="Instrument">
        ${INSTRUMENTS.map((i) => `<button type="button" role="radio" data-i="${i.id}">${i.name}</button>`).join("")}
      </div>
      <label class="sa-tuning"><span class="sr-only">Tuning</span><select></select></label>` : ""}
      <button type="button" class="sa-mic"><span class="dot"></span><span class="txt">Tune with your mic</span></button>
    </div>
    <p class="sa-hint">Tap a string to hear its note. Drag across them to strum.</p>`;
  const $ = (s) => root.querySelector(s);
  const canvas = $(".sa-canvas"), stage = $(".sa-stage"), labels = $(".sa-labels");
  const noteEl = $(".sa-note"), detailEl = $(".sa-detail"), micBtn = $(".sa-mic");

  // ---- three ------------------------------------------------------------------------
  let renderer = null;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" }); }
  catch { root.classList.add("sa-no-webgl"); }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, -9.4, 8.6);
  camera.lookAt(0, -1.7, 0);                     // leaves room under the strings for the note labels

  let strings = [];              // { midi, mesh, uniforms, pluckT, micGlow, micSway, label }
  let audio = null;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  function thickness(midi) { return Math.max(0.018, Math.min(0.07, 0.068 - (midi - 28) * 0.00115)); }

  function build() {
    strings.forEach((s) => { scene.remove(s.mesh); s.mesh.geometry.dispose(); s.mesh.material.dispose(); });
    labels.innerHTML = "";
    const { tuning } = current;
    const n = tuning.strings.length;
    strings = tuning.strings.map((midi, i) => {
      const uniforms = {
        uX0: { value: (i - (n - 1) / 2) * SPACING }, uTaper: { value: TAPER }, uLen: { value: LEN },
        uHalfW: { value: 0.3 }, uAmp: { value: 0 }, uCore: { value: thickness(midi) },
        uBase: { value: 0.34 }, uGlow: { value: 0 }, uFade: { value: 0 }, uTime: { value: 0 },
        uColor: { value: new THREE.Color(1, 1, 1) },
      };
      const [r, g, b] = rgb(hue(midi), 0.5, 1);
      uniforms.uColor.value.setRGB(r, g, b);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 96),
        new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG,
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      scene.add(mesh);
      const name = noteName(midi, tuning.flats);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "sa-label";
      label.innerHTML = `${name.display}<sub>${name.octave}</sub>`;
      label.setAttribute("aria-label", `Play ${name.display}${name.octave}, ${frequency(midi).toFixed(1)} hertz`);
      label.addEventListener("click", (e) => { if (e.detail === 0) play(i); });   // keyboard
      labels.appendChild(label);
      return { midi, mesh, uniforms, pluckT: -99, micGlow: 0, micSway: 0, label, fadeIn: now() + i * 0.04 };
    });
    layout();
    syncControls();
  }

  function rgb(h, s, b) {
    return hsb(h, s, b).match(/[\d.]+/g).slice(0, 3).map((v) => +v / 255);
  }

  // ---- sizing + projection -------------------------------------------------------
  function layout() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    if (renderer) { renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h, false); }
    camera.aspect = w / h;
    // keep the whole group in frame on narrow screens
    camera.fov = w / h < 0.8 ? 46 : 36;
    camera.updateProjectionMatrix();
    strings.forEach((s) => {
      const p = project(s.uniforms.uX0.value, -LEN / 2);
      s.label.style.left = `${p.x}px`;
      s.label.style.top = `${p.y + 10}px`;
    });
  }
  function project(x, y) {
    const v = new THREE.Vector3(x, y, 0).project(camera);
    return { x: (v.x + 1) / 2 * stage.clientWidth, y: (1 - v.y) / 2 * stage.clientHeight };
  }
  /** Screen x of string i at screen height y (the string is straight on screen). */
  function screenXAt(i, y) {
    const s = strings[i], x0 = s.uniforms.uX0.value;
    const a = project(x0, -LEN / 2), b = project(x0 * (1 - TAPER), LEN / 2);
    const t = (y - a.y) / (b.y - a.y);
    return a.x + (b.x - a.x) * Math.max(0, Math.min(1, t));
  }
  new ResizeObserver(layout).observe(stage);

  // ---- playing -------------------------------------------------------------------
  function ensureAudio() {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    return audio;
  }
  function play(i) {
    const s = strings[i];
    if (!s) return;
    const n = strings.length;
    pluck(ensureAudio(), frequency(s.midi), { pan: n > 1 ? (i / (n - 1) - 0.5) * 0.5 : 0 });
    s.pluckT = now();
    s.label.classList.add("hit");
    setTimeout(() => s.label.classList.remove("hit"), 180);
    if (!micOn) showNote(s.midi, null);
    flood(hue(s.midi), 0.5, 0.34);
    clearTimeout(play.fade);
    play.fade = setTimeout(() => { if (!micOn) flood(null); }, 1600);
  }

  // pointer: tap plucks the nearest string; dragging across strings strums
  let dragging = false, lastX = 0;
  stage.addEventListener("pointerdown", (e) => {
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bestD = Infinity;
    strings.forEach((_, i) => { const d = Math.abs(screenXAt(i, y) - x); if (d < bestD) { bestD = d; best = i; } });
    const gap = strings.length > 1 ? Math.abs(screenXAt(1, y) - screenXAt(0, y)) : 60;
    if (best >= 0 && bestD < gap * 0.6) play(best);
    dragging = true; lastX = x;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    strings.forEach((_, i) => {
      const sx = screenXAt(i, y);
      if ((lastX - sx) * (x - sx) < 0) play(i);                 // crossed this string
    });
    lastX = x;
  });
  const endDrag = () => { dragging = false; };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  // ---- mic -----------------------------------------------------------------------
  let micOn = false, mic = null, lit = -1, lastPitch = 0;
  micBtn.addEventListener("click", async () => {
    if (micOn) { mic && mic.stop(); mic = null; micOn = false; lit = -1; micUI(); flood(null); showIdle(); return; }
    try {
      mic = await listen({ minFreq: minFreqFor(), onPitch, onSilence });
      micOn = true; micUI();
      detailEl.textContent = "Play a string";
      noteEl.textContent = "";
    } catch {
      detailEl.textContent = "The mic isn't available here. Tap the strings to hear each note.";
    }
  });
  function minFreqFor() { return Math.min(...current.tuning.strings.map(frequency)) < 70 ? 28 : 60; }
  function micUI() { micBtn.classList.toggle("on", micOn); micBtn.querySelector(".txt").textContent = micOn ? "Listening" : "Tune with your mic"; }

  function onPitch({ freq }) {
    lastPitch = performance.now();
    const ts = current.tuning.strings;
    lit = nearestString(freq, ts, lit);
    if (lit < 0) {                                 // a fretted note: show it, light nothing
      const midi = Math.round(69 + 12 * Math.log2(freq / 440));
      showNote(midi, centsBetween(freq, midi), freq);
      strings.forEach((s) => { s.micGlow = 0; s.micSway = 0; });
      flood(hue(midi), 0.55, 0.42);
      return;
    }
    const cents = centsBetween(freq, ts[lit]);
    const close = 1 - Math.min(1, Math.abs(cents) / 50);
    strings.forEach((s, i) => {
      s.micGlow = i === lit ? Math.pow(close, GLOW_CURVE) : 0;
      s.micSway = i === lit && Math.abs(cents) > IN_TUNE && !reduceMotion ? MIC_SWAY * (1 - close) + 0.02 : 0;
    });
    showNote(ts[lit], cents, freq);
    const inTune = Math.abs(cents) <= IN_TUNE;
    flood(hue(ts[lit]), inTune ? 1 : 0.55, inTune ? 0.62 : 0.42);
    root.classList.toggle("in-tune", inTune);
  }
  function onSilence() {
    lit = -1;
    strings.forEach((s) => { s.micGlow = 0; s.micSway = 0; });
    root.classList.remove("in-tune");
    flood(null);
    detailEl.textContent = "Play a string";
    noteEl.textContent = "";
  }

  // ---- readout + color -----------------------------------------------------------
  function showNote(midi, cents, freq) {
    const name = noteName(midi, current.tuning.flats);
    noteEl.innerHTML = `${name.letter}${name.accidental ? `<span class="acc">${name.accidental}</span>` : ""}`;
    if (cents === null || cents === undefined) {
      detailEl.textContent = `${name.display}${name.octave} · ${frequency(midi).toFixed(2)} Hz`;
    } else if (Math.abs(cents) <= IN_TUNE) {
      detailEl.textContent = "in tune";
    } else if (cents < -50) detailEl.textContent = `tune up to ${name.display}`;
    else if (cents > 50) detailEl.textContent = `tune down to ${name.display}`;
    else detailEl.textContent = `${Math.abs(Math.round(cents))}¢ ${cents > 0 ? "sharp" : "flat"}`;
  }
  function showIdle() { noteEl.textContent = ""; detailEl.textContent = ""; }
  function flood(h, s, b) {
    root.style.setProperty("--flood", h === null || h === undefined ? "var(--flood-idle)" : hsb(h, s, b));
  }

  // ---- selector ------------------------------------------------------------------
  function syncControls() {
    if (!selector) return;
    root.querySelectorAll(".sa-instruments button").forEach((b) => {
      const on = b.dataset.i === current.instrument.id;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", on);
    });
    const sel = $(".sa-tuning select");
    sel.innerHTML = current.instrument.tunings.map((t) =>
      `<option value="${current.instrument.id}.${t.id}" ${t.id === current.tuning.id ? "selected" : ""}>${t.name} · ${t.strings.map((m) => noteName(m, t.flats).display).join(" ")}</option>`).join("");
    $(".sa-tuning").hidden = current.instrument.tunings.length < 2;
  }
  function setTuning(key) {
    current = findTuning(key);
    build();
    lit = -1;
    if (mic) mic.minFreq = minFreqFor();
    root.dispatchEvent(new CustomEvent("tuningchange", { detail: current.key, bubbles: true }));
  }
  if (selector) {
    root.querySelectorAll(".sa-instruments button").forEach((b) =>
      b.addEventListener("click", () => setTuning(`${b.dataset.i}.${INSTRUMENTS.find((i) => i.id === b.dataset.i).tunings[0].id}`)));
    $(".sa-tuning select").addEventListener("change", (e) => setTuning(e.target.value));
  }

  // ---- frame loop (only while on screen) -----------------------------------------
  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) requestAnimationFrame(frame); }).observe(root);

  function frame() {
    if (!visible) return;
    const t = now();
    strings.forEach((s) => {
      const u = s.uniforms;
      const since = t - s.pluckT;
      const t60 = Math.max(1.6, Math.min(5, 450 / frequency(s.midi)));
      const ring = since >= 0 && since < t60 ? Math.exp(-since / (t60 / 6.9)) : 0;
      const pluckAmp = reduceMotion ? 0 : PLUCK_AMP * ring;
      u.uAmp.value = Math.max(pluckAmp, s.micSway);
      u.uGlow.value = Math.max(s.micGlow, ring * 0.85);
      u.uHalfW.value = u.uCore.value * 9 + u.uAmp.value;
      u.uFade.value = Math.min(1, Math.max(0, (t - s.fadeIn) / 0.5));
      u.uTime.value = t;
    });
    if (micOn && performance.now() - lastPitch > 1200 && lit >= 0) onSilence();
    if (renderer) renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  // ?demo: no mic; sweeps each string from off into tune (the app's -demo), for QA
  if (new URLSearchParams(location.search).has("demo")) {
    micOn = true; micUI();
    const starts = [-45, 30, -140, 18, -60, 9];
    const t0 = performance.now();
    setInterval(() => {
      const el = (performance.now() - t0) / 1000, step = Math.floor(el / 2.8), ts = current.tuning.strings;
      const k = Math.min(1, (el % 2.8) / 1.8), eased = 1 - Math.pow(1 - k, 3);
      onPitch({ freq: frequency(ts[step % ts.length]) * Math.pow(2, starts[step % starts.length] * (1 - eased) / 1200) });
    }, 33);
  }

  build();
  requestAnimationFrame(frame);
  return { setTuning, play, get key() { return current.key; } };
}

// auto-mount any [data-strings] element
document.querySelectorAll("[data-strings]").forEach((el) =>
  mountStrings(el, { selector: el.dataset.selector !== "false" }));
