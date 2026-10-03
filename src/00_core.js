/* =====================================================================================
   THREADLINE: CITY UNDER TENSION — core utilities
   Namespace, seeded PRNG, math scratch pools, ObjectPool, event bus, settings defaults,
   on-screen error console. Must not touch the DOM at load time (Node physics tests load it).
   ===================================================================================== */
'use strict';
var TL = (typeof globalThis !== 'undefined' ? globalThis : window).TL || {};
(typeof globalThis !== 'undefined' ? globalThis : window).TL = TL;

TL.VERSION = '1.0.0';

// ------------------------------------------------------------------ constants
TL.C = {
  G: 16.0,                 // gameplay gravity (m/s^2); stronger than Earth for weighty city-scale swings
  PHYS_HZ: 120,            // fixed physics rate
  MAX_SUBSTEPS: 14,
  MAX_SPEED: 140,          // hard numerical safety clamp (m/s)
  PLAYER_MASS: 80,
  CAP_R: 0.38,             // capsule radius
  CAP_OFF: [-0.57, -0.08, 0.42], // capsule sphere centers relative to body center (y)
  FEET: 0.95,              // body center height above feet
  WATER_Y: -3.0,
  CITY_HALF: 800,          // city spans [-800, 800] in x and z
  CELL: 80,                // block grid (road centerlines every 80 m)
  ROAD_W: 16,
  CHUNK: 80,               // streaming chunk = one grid cell
  RIVER_X0: 168, RIVER_X1: 312,
  BRIDGE_Z: -160,
};

// ------------------------------------------------------------------ math helpers
TL.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
TL.lerp = (a, b, t) => a + (b - a) * t;
TL.invExpU = { value: 1 };   // 1 / night exposure boost (windows compensate so they stay as bright as before)
TL.smooth = (e0, e1, x) => { const t = TL.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
TL.damp = (a, b, lambda, dt) => TL.lerp(a, b, 1 - Math.exp(-lambda * dt));
TL.wrapAngle = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
TL.dampAngle = (a, b, lambda, dt) => a + TL.wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
TL.finite3 = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

// ------------------------------------------------------------------ seeded PRNG (mulberry32) + hashing
TL.hash2 = function (x, y, seed) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0);
};
TL.hashStr = function (s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
TL.RNG = class {
  constructor(seed) { this.s = (seed >>> 0) || 1; }
  next() { let t = (this.s += 0x6D2B79F5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p) { return this.next() < p; }
};

// ------------------------------------------------------------------ scratch vector pools (no hot-loop allocation)
TL.V = (() => {
  const N = 256; const pool = []; let i = 0;
  function get() { const v = pool[i]; i = (i + 1) % N; return v.set(0, 0, 0); }
  function init() { if (typeof THREE !== 'undefined' && !pool.length) for (let k = 0; k < N; k++) pool.push(new THREE.Vector3()); }
  return { get, init };
})();

// ------------------------------------------------------------------ generic object pool
TL.ObjectPool = class {
  constructor(factory, reset, initial = 0) {
    this.factory = factory; this.reset = reset || (() => {}); this.free = []; this.live = new Set();
    for (let k = 0; k < initial; k++) this.free.push(factory());
  }
  get() { const o = this.free.pop() || this.factory(); this.live.add(o); return o; }
  release(o) { if (!this.live.has(o)) return; this.live.delete(o); this.reset(o); this.free.push(o); }
  releaseAll() { for (const o of Array.from(this.live)) this.release(o); }
  get size() { return this.live.size; }
};

// ------------------------------------------------------------------ event bus
TL.Events = class {
  constructor() { this.map = new Map(); }
  on(ev, fn) { if (!this.map.has(ev)) this.map.set(ev, []); this.map.get(ev).push(fn); return () => this.off(ev, fn); }
  off(ev, fn) { const a = this.map.get(ev); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(ev, a, b, c) { const l = this.map.get(ev); if (l) for (let i = 0; i < l.length; i++) { try { l[i](a, b, c); } catch (e) { TL.logError(e); } } }
};
TL.bus = new TL.Events();

// ------------------------------------------------------------------ settings (persisted by SaveManager)
TL.defaultSettings = () => ({
  quality: 'high',          // low | medium | high | ultra
  renderDist: 520,
  sensitivity: 1.0, invertY: false, shake: 1.0, fovEffect: 1.0, autoFollow: 0.6, swingCam: 1.0, baseFov: 68,
  windLevel: .7, speedEffects: .25,
  swingAssist: 60,          // 0..100
  swingMode: 'single',      // single: Shift + mouse hand selection; multi: original Shift-only swing
  aimAssist: 50,
  holdToggle: { swing: 'hold', glide: 'toggle', aim: 'hold' },
  dodgeWindow: 1.0, parryWindow: 1.0, qteAuto: false, puzzleHints: true, gameSpeed: 1.0,
  subtitles: true, subSize: 1.0, subBg: 0.6, speakerLabels: true,
  highContrast: false, outlines: false, uiScale: 1.0, centerDot: true, reducedMotion: false, reducedFlashes: false,
  vol: { master: 0.8, music: 0.5, sfx: 0.8, ambience: 0.7, ui: 0.6 }, mono: false,
  musicTrack: true,         // play the embedded music/*.mp3 playlist (14b_music.js) instead of the procedural score
  showFps: true, debugPhysics: false, debugPerf: false,
  bindings: null,           // filled by Input with defaults
  padBindings: null,
});

// ------------------------------------------------------------------ on-screen error console
TL.errors = [];
TL.logError = function (e, where) {
  const msg = (where ? '[' + where + '] ' : '') + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  TL.errors.push(msg);
  if (TL.errors.length > 50) TL.errors.shift();
  if (typeof console !== 'undefined') console.error(msg);
  if (typeof document !== 'undefined') {
    const el = document.getElementById('errConsole');
    if (el) { el.style.display = 'block'; const d = document.createElement('div'); d.textContent = msg; el.appendChild(d); while (el.childNodes.length > 12) el.removeChild(el.firstChild); }
  }
};

TL.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
TL.fmtTime = (h) => { const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
