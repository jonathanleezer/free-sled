'use strict';
// ---------------------------------------------------------------------------
// FREE SLED — an original downhill sledding game.
// World units are logical pixels; 16 px = 1 metre. Physics runs at 120 Hz.
// ---------------------------------------------------------------------------
(() => {
const PX_PER_M = 16;
const STEP = 1 / 120;
const GRAV = 520;
const VMAX = 250;                 // top speed pointing straight downhill (px/s)
const TUCK_MULT = 1.42;           // tuck boost multiplier
const DIR_DEG = [0, 28, 55, 90];  // sled heading per steering notch
const CELL = 256;
const PLOW_AT_M = 2000;

const MODES = {
  free:   { name: 'FREE RUN', desc: 'ENDLESS HILL. HOW FAR CAN YOU GO?' },
  gates:  { name: 'GATE RUN', desc: 'THREAD EVERY GATE. MISSES COST 5 SEC.', len: 800 * PX_PER_M, halfW: 230 },
  bigair: { name: 'BIG AIR', desc: 'HIT RAMPS, LAND TRICKS, SCORE BIG.', len: 1000 * PX_PER_M, halfW: 230 },
};
const MODE_KEYS = ['free', 'gates', 'bigair'];
const START_Y = 150;

// ---- canvas -----------------------------------------------------------------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
let W = 640, H = 360, SCALE = 2;
function resize() {
  const iw = window.innerWidth, ih = window.innerHeight;
  SCALE = Math.max(1, Math.floor(Math.min(iw / 420, ih / 320)));
  W = Math.ceil(iw / SCALE); H = Math.ceil(ih / SCALE);
  canvas.width = W; canvas.height = H;
  canvas.style.width = (W * SCALE) + 'px'; canvas.style.height = (H * SCALE) + 'px';
  ctx.imageSmoothingEnabled = false;
}
window.addEventListener('resize', resize);
resize();

// ---- helpers ------------------------------------------------------------------
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const rad = d => d * Math.PI / 180;
const sign = v => v < 0 ? -1 : v > 0 ? 1 : 0;
function hash3(a, b, c) {
  let h = (Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const fmtTime = t => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};

// ---- persistence (best effort) ------------------------------------------------------
let BEST = { free: 0, freeStyle: 0, gates: 0, bigair: 0 };
try { const s = JSON.parse(localStorage.getItem('freesled.best.v1')); if (s) BEST = Object.assign(BEST, s); } catch (e) {}
function saveBest() { try { localStorage.setItem('freesled.best.v1', JSON.stringify(BEST)); } catch (e) {} }
let muted = false;
try { muted = localStorage.getItem('freesled.muted') === '1'; } catch (e) {}
Snd.setMuted(muted);

// ---- object types -------------------------------------------------------------------
// hw/hh: hit box half width / height above the base point. h: obstacle height (air clearance).
const T = {
  pine_big:   { sprs: ['pine_big0', 'pine_big1'], hw: 4, hh: 4, h: 58, kind: 'crash' },
  pine_med:   { sprs: ['pine_med0', 'pine_med1'], hw: 3, hh: 3, h: 40, kind: 'crash' },
  pine_small: { sprs: ['pine_small0', 'pine_small1'], hw: 3, hh: 3, h: 18, kind: 'crash' },
  pine_snowy: { sprs: ['pine_snowy0', 'pine_snowy1'], hw: 4, hh: 4, h: 56, kind: 'crash' },
  tree_dead:  { sprs: ['dead0', 'dead1'], hw: 2, hh: 3, h: 40, kind: 'crash' },
  rock:       { sprs: ['rock0', 'rock1'], hw: 5, hh: 4, h: 8, kind: 'trip' },
  rock_big:   { sprs: ['rockbig0', 'rockbig1'], hw: 9, hh: 5, h: 15, kind: 'crash' },
  stump:      { sprs: ['stump0'], hw: 5, hh: 4, h: 9, kind: 'trip' },
  mogul:      { sprs: ['mogul0', 'mogul1'], hw: 8, hh: 5, h: 0, kind: 'bump' },
  ramp:       { sprs: ['ramp'], hw: 13, hh: 14, yo: 8, h: 0, kind: 'ramp' },
  snowman:    { sprs: ['snowman0', 'snowman1'], hw: 5, hh: 4, h: 24, kind: 'crash' },
  snowpile:   { sprs: ['snowpile'], hw: 0, hh: 0, h: 0, kind: 'deco' },
  flag_r:     { sprs: ['flag_r'], hw: 1.5, hh: 3, h: 20, kind: 'trip' },
  flag_b:     { sprs: ['flag_b'], hw: 1.5, hh: 3, h: 20, kind: 'trip' },
  pole:       { sprs: ['pole'], hw: 1.5, hh: 3, h: 15, kind: 'trip' },
  sign:       { sprs: ['sign'], hw: 2, hh: 3, h: 26, kind: 'trip' },
  lodge:      { sprs: ['lodge'], hw: 34, hh: 22, h: 999, kind: 'crash' },
  bannerpost: { sprs: null, hw: 1.5, hh: 3, h: 40, kind: 'trip' },
  ice:        { zone: true, kind: 'zone' },
  powder:     { zone: true, kind: 'zone' },
};

let OBJ_ID = 1;
function makeObj(type, x, y, r, extra) {
  const t = T[type];
  const o = { id: OBJ_ID++, type, x, y, kind: t.kind, hw: t.hw || 0, hh: t.hh || 0, yo: t.yo || 0, h: t.h || 0 };
  if (t.sprs) o.spr = t.sprs[Math.floor((r ? r() : Math.random()) * t.sprs.length)];
  if (extra) Object.assign(o, extra);
  return o;
}

// zone sprites (ice sheets, deep powder) baked per object
const zoneCache = new Map();
function zoneSprite(o) {
  const key = o.type + o.rx + 'x' + o.ry + ':' + (o.seed % 4);
  let s = zoneCache.get(key);
  if (s) return s;
  const w = o.rx * 2 + 2, h = o.ry * 2 + 2;
  const b = new PB(w, h);
  const r = rng32(o.seed);
  const cx = w / 2, cy = h / 2;
  const wob = [r(), r(), r(), r()];
  b.ellipse(cx, cy, o.rx, o.ry, (dx, dy, nx, ny) => {
    const ang = Math.atan2(ny, nx);
    const edge = 0.86 + 0.08 * Math.sin(ang * 3 + wob[0] * 6) + 0.05 * Math.sin(ang * 5 + wob[1] * 6);
    const rr = Math.hypot(nx, ny);
    if (rr > edge) return null;
    if (o.type === 'ice') {
      if (rr > edge - 0.1) return 'I';
      const streak = (dx * 0.5 - dy * 1.6 + wob[2] * 30);
      if (Math.abs(((streak % 9) + 9) % 9) < 0.9 && rr < 0.75) return 'j';
      return 'i';
    }
    // deep powder: brighter, lumpy, with blue-gray pock marks
    if (rr > edge - 0.08) return 'W';
    const hsh = hash3(Math.floor(dx), Math.floor(dy), o.seed) % 23;
    if (hsh === 0) return 'W';
    if (hsh === 1) return 'l';
    return 'w';
  });
  s = b.sprite(cx, cy);
  zoneCache.set(key, s);
  return s;
}

// ---- input -----------------------------------------------------------------------------
const keys = {};
const pressed = new Set();
const keyMap = {
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  Space: 'hop', ShiftLeft: 'tuck', ShiftRight: 'tuck', KeyF: 'tuck',
  Enter: 'enter', NumpadEnter: 'enter', Escape: 'esc', KeyP: 'pause', KeyR: 'restart', KeyM: 'mute', KeyH: 'help', KeyQ: 'quit',
};
window.addEventListener('keydown', e => {
  const k = keyMap[e.code];
  if (!k) return;
  e.preventDefault();
  Snd.init();
  if (!keys[k]) pressed.add(k);
  keys[k] = true;
  pointer.active = false;
});
window.addEventListener('keyup', e => { const k = keyMap[e.code]; if (k) keys[k] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (scene === 'play' && game && !game.over && !game.result) game.paused = true; });

const pointer = { active: false, x: 0, y: 0, down: false, downT: 0, sx: 0, sy: 0, tap: false };
function pointerPos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / SCALE, (e.clientY - r.top) / SCALE]; }
canvas.addEventListener('pointerdown', e => {
  Snd.init();
  [pointer.x, pointer.y] = pointerPos(e);
  pointer.sx = pointer.x; pointer.sy = pointer.y;
  pointer.down = true; pointer.downT = performance.now(); pointer.active = true;
  pointer.touch = e.pointerType !== 'mouse';
  pressed.add('pdown');
});
canvas.addEventListener('pointermove', e => {
  [pointer.x, pointer.y] = pointerPos(e);
  if (e.pointerType === 'mouse' || pointer.down) pointer.active = true;
});
window.addEventListener('pointerup', e => {
  if (!pointer.down) return;
  pointer.down = false;
  const held = performance.now() - pointer.downT;
  const moved = Math.hypot(pointer.x - pointer.sx, pointer.y - pointer.sy);
  if (held < 260 && moved < 8) pressed.add('tap');
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

// ---- world ------------------------------------------------------------------------------
class World {
  constructor(mode, seed) {
    this.mode = mode; this.seed = seed;
    this.course = MODES[mode].len ? MODES[mode] : null;
    this.cells = new Map();
    this.statics = [];
    this.buildStatics();
    this.statics.sort((a, b) => a.y - b.y);
  }
  buildStatics() {
    const S = this.statics, r = rng32(this.seed ^ 0xabc);
    S.push(makeObj('lodge', -150, 96, r));
    S.push(makeObj('sign', -92, 112, r, { label: 'COCOA' }));
    S.push(makeObj('pine_snowy', -205, 70, r), makeObj('pine_big', -232, 110, r), makeObj('pine_snowy', 120, 60, r), makeObj('pine_med', 150, 92, r));
    S.push(makeObj('snowman', 98, 124, r));
    const bannerText = this.course ? MODES[this.mode].name : 'START';
    this.addBanner(START_Y, 'start', bannerText);
    if (!this.course) return;
    const len = this.course.len, hw = this.course.halfW;
    for (let y = START_Y + 40; y < len + 400; y += 96) {
      S.push(makeObj('pole', -hw, y, r), makeObj('pole', hw, y, r));
    }
    this.addBanner(len, 'finish', 'FINISH');
    if (this.mode === 'gates') {
      this.gates = [];
      let i = 0;
      for (let y = START_Y + 340; y < len - 220; y += 400 + Math.floor(r() * 60)) {
        const gx = Math.round(Math.sin(y / 1100 + this.seed) * 110 + (r() - 0.5) * 80);
        const gw = 64;
        const col = i % 2 ? 'flag_b' : 'flag_r';
        const gate = { id: OBJ_ID++, type: 'gate', kind: 'gate', x: gx, y, w: gw, idx: i, state: null, color: col === 'flag_r' ? '#d8333a' : '#2f5fd0' };
        this.gates.push(gate);
        S.push(gate);
        S.push(makeObj(col, gx - gw / 2, y, r), makeObj(col, gx + gw / 2, y, r));
        i++;
      }
    }
    if (this.mode === 'bigair') {
      for (let y = START_Y + 380; y < len - 300; y += 340 + Math.floor(r() * 220)) {
        const n = r() < 0.35 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const x = n === 1 ? Math.round((r() - 0.5) * 220) : (k ? 70 : -70) + Math.round((r() - 0.5) * 40);
          S.push(makeObj('ramp', x, y, r));
        }
      }
    }
  }
  addBanner(y, kind, text) {
    const hw = 64;
    const b = { id: OBJ_ID++, type: 'banner', kind: 'deco', x: 0, y, hw, banner: kind, text };
    this.statics.push(b);
    this.statics.push(makeObj('bannerpost', -hw, y), makeObj('bannerpost', hw, y));
  }
  cell(cx, cy) {
    const key = cx + ',' + cy;
    let c = this.cells.get(key);
    if (!c) { c = this.genCell(cx, cy); this.cells.set(key, c); }
    return c;
  }
  genCell(cx, cy) {
    const r = rng32(hash3(cx, cy, this.seed));
    const out = [];
    const x0 = cx * CELL, y0 = cy * CELL;
    const place = (type, x, y, extra) => { const o = makeObj(type, Math.round(x), Math.round(y), r, extra); out.push(o); return o; };
    const crowded = (x, y, d) => out.some(o => Math.abs(o.x - x) < d && Math.abs(o.y - y) < d * 0.8);
    const trees = ['pine_big', 'pine_big', 'pine_med', 'pine_med', 'pine_small', 'pine_snowy', 'tree_dead'];
    const course = this.course;
    // the hill above the start: dense backdrop forest
    if (y0 + CELL <= 0) {
      for (let i = 0; i < 14; i++) {
        const x = x0 + r() * CELL, y = y0 + r() * CELL;
        if (!crowded(x, y, 16)) place(trees[Math.floor(r() * 4)], x, y);
      }
      return out;
    }
    const depthM = Math.max(0, y0) / PX_PER_M;
    const tries = 7 + Math.min(7, Math.floor(depthM / 450));
    for (let i = 0; i < tries + 8; i++) {
      const x = x0 + r() * CELL, y = y0 + r() * CELL;
      if (y < 0) { if (r() < 0.6 && !crowded(x, y, 18)) place(trees[Math.floor(r() * 4)], x, y); continue; }
      // keep the start area clear
      if (y < START_Y + 120 && Math.abs(x) < 260) continue;
      const inCourseY = course && y < course.len + 300;
      const inCourse = inCourseY && Math.abs(x) < course.halfW + 14;
      if (inCourseY && !inCourse) {
        // forest lining the course
        if (Math.abs(x) < course.halfW + 34) continue;
        if (!crowded(x, y, 14)) place(trees[Math.floor(r() * trees.length)], x, y);
        continue;
      }
      if (i >= tries) continue;
      if (crowded(x, y, 26)) continue;
      if (inCourse) {
        if (this.mode === 'gates') {
          if (r() < 0.25) this.mogulField(place, crowded, r, x, y, 2 + Math.floor(r() * 2));
          else if (r() < 0.15) place('pine_small', x, y);
          continue;
        }
        // big air: moguls, rocks, snowmen, the odd tree
        const p = r();
        if (p < 0.22) this.mogulField(place, crowded, r, x, y, 3 + Math.floor(r() * 2));
        else if (p < 0.36) place('rock', x, y);
        else if (p < 0.42) place('snowman', x, y);
        else if (p < 0.52) place('pine_small', x, y);
        else if (p < 0.58) place('stump', x, y);
        else if (p < 0.62) place('powder', x, y, { rx: 30 + Math.floor(r() * 12), ry: 12 + Math.floor(r() * 4), seed: Math.floor(r() * 1e6) });
        continue;
      }
      // free hill
      const p = r();
      if (p < 0.40) place(trees[Math.floor(r() * trees.length)], x, y);
      else if (p < 0.47) place('rock', x, y);
      else if (p < 0.50) place('rock_big', x, y);
      else if (p < 0.55) place('stump', x, y);
      else if (p < 0.65) this.mogulField(place, crowded, r, x, y, 2 + Math.floor(r() * 3));
      else if (p < 0.69) place('ramp', x, y);
      else if (p < 0.72) place('snowman', x, y);
      else if (p < 0.75) place('ice', x, y, { rx: 26 + Math.floor(r() * 16), ry: 10 + Math.floor(r() * 5), seed: Math.floor(r() * 1e6) });
      else if (p < 0.78) place('powder', x, y, { rx: 32 + Math.floor(r() * 16), ry: 13 + Math.floor(r() * 5), seed: Math.floor(r() * 1e6) });
      else if (p < 0.80 && r() < 0.5) {
        // small grove
        for (let k = 0; k < 5; k++) { const tx = x + (r() - 0.5) * 70, ty = y + (r() - 0.5) * 50; if (!crowded(tx, ty, 14)) place(trees[Math.floor(r() * 5)], tx, ty); }
      }
    }
    return out;
  }
  mogulField(place, crowded, r, x, y, rows) {
    const cols = 2 + Math.floor(r() * 3);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const mx = x + (i - cols / 2) * 30 + (j % 2) * 15, my = y + j * 22;
      if (!(my < START_Y + 120 && Math.abs(mx) < 260)) place('mogul', mx + (r() - 0.5) * 4, my);
    }
  }
  // gather objects overlapping a rectangle
  query(x0, y0, x1, y1, out) {
    const c0 = Math.floor(x0 / CELL), c1 = Math.floor(x1 / CELL), r0 = Math.floor(y0 / CELL), r1 = Math.floor(y1 / CELL);
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      for (const o of this.cell(cx, cy)) if (!o.dead && o.x >= x0 && o.x <= x1 && o.y >= y0 && o.y <= y1) out.push(o);
    }
    const S = this.statics;
    let lo = 0, hi = S.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (S[m].y < y0) lo = m + 1; else hi = m; }
    for (let i = lo; i < S.length && S[i].y <= y1; i++) { const o = S[i]; if (!o.dead && o.x >= x0 - 80 && o.x <= x1 + 80) out.push(o); }
    return out;
  }
  prune(camY) {
    if (this.cells.size < 400) return;
    for (const [k, v] of this.cells) { const cy = +k.split(',')[1]; if ((cy + 1) * CELL < camY - 900) this.cells.delete(k); }
  }
}

// ---- game state ----------------------------------------------------------------------------
let scene = 'title';      // title | play
let overlay = null;        // help (title) screen
let menuSel = 0;
let game = null;
let titleWorld = new World('free', 777);
let titleCam = { x: 0, y: -40 };
const flakes = [];
for (let i = 0; i < 90; i++) flakes.push({ x: Math.random() * 2000, y: Math.random() * 1200, s: Math.random(), w: Math.random() * 6 });

function newGame(mode) {
  const seed = (Math.random() * 1e9) | 0;
  const world = new World(mode, seed);
  const p = {
    x: 0, y: 40, z: 0, vz: 0, vx: 0, vy: 0, dir: 0, heading: 0, speed: 0,
    state: 'ready', t: 0, stamina: 1, tucking: false, braking: false,
    spin: 0, flipT: -1, flips: 0, superT: 0, airT: 0, tricksDone: [], ignore: null,
    tumbleRot: 0, crashSledAng: 0, crashSledOff: [0, 0], repeatT: 0, scootT: 0, onIce: false, inPowder: false,
    lastTrackX: null,
  };
  game = {
    mode, world, p, seed,
    time: 0, started: false, score: 0, crashes: 0, bestTrick: '', bestTrickPts: 0,
    missed: 0, passed: 0, penalty: 0,
    cam: { x: 0, y: p.y - H * 0.3, shake: 0 },
    particles: [], texts: [], tracks: [], npcs: [], npcT: 3,
    plow: null, plowWarned: false,
    msg: null, paused: false, over: false, result: null, resultT: 0,
    smoke: [], vis: [],
  };
  scene = 'play';
  Snd.start();
}

// ---- particles / text ------------------------------------------------------------------------
function spray(x, y, n, vx, vy, spread = 40, col) {
  const P = game.particles;
  for (let i = 0; i < n; i++) {
    if (P.length > 600) P.shift();
    P.push({ x, y, z: 1, vx: vx + (Math.random() - 0.5) * spread, vy: vy + (Math.random() - 0.5) * spread, vz: 30 + Math.random() * 70,
      life: 0.35 + Math.random() * 0.35, t: 0, c: col || (Math.random() < 0.7 ? '#ffffff' : '#c9d8ec') });
  }
}
function puff(x, y, n, power = 90, cols = ['#ffffff', '#c9d8ec', '#e7eff9']) {
  const P = game.particles;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = Math.random() * power;
    P.push({ x, y, z: 2 + Math.random() * 6, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6, vz: 40 + Math.random() * 120, life: 0.5 + Math.random() * 0.5, t: 0, c: cols[i % cols.length], big: Math.random() < 0.3 });
  }
}
function floatText(x, y, text, color = '#1b1b2b', sub) {
  game.texts.push({ x, y, text, sub, color, t: 0 });
}
function bigMsg(text, sub, dur = 2.2, color = '#d8333a') { game.msg = { text, sub, t: 0, dur, color }; }

// ---- player helpers -----------------------------------------------------------------------------
function dirAngle(dir) { return rad(DIR_DEG[Math.abs(dir)]) * sign(dir); }
function playerBox(p) { return { x0: p.x - 4, x1: p.x + 4, y0: p.y - 1, y1: p.y + 7 }; }
function objBox(o) { return { x0: o.x - o.hw, x1: o.x + o.hw, y0: o.y - o.hh - o.yo, y1: o.y - o.yo }; }
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function crash(o, kind) {
  const p = game.p;
  p.ignore = o;
  game.crashes++;
  game.cam.shake = 0.25;
  if (o && o.type === 'snowman') {
    o.dead = true;
    const pile = makeObj('snowpile', o.x, o.y + 2);
    game.world.cell(Math.floor(o.x / CELL), Math.floor(o.y / CELL)).push(pile);
    puff(o.x, o.y - 8, 26, 110);
    Snd.splat();
    floatText(p.x, p.y - 26, 'SPLAT!');
  }
  if (kind === 'crash') {
    p.state = 'down'; p.t = 0; p.speed = 0; p.z = 0; p.vz = 0;
    p.crashSledAng = p.heading * 180 / Math.PI + 60 + Math.random() * 60;
    p.crashSledOff = [(Math.random() < 0.5 ? -1 : 1) * 11, 4];
    if (!o || o.type !== 'snowman') { Snd.crash(); floatText(p.x, p.y - 26, ['OUCH!', 'BONK!', 'OOF!', 'THWACK!'][Math.floor(Math.random() * 4)]); }
    puff(p.x, p.y, 14, 60);
  } else {
    p.state = 'tumble'; p.t = 0; p.speed *= 0.65; p.z = 0; p.vz = 0;
    Snd.thud();
    floatText(p.x, p.y - 26, ['WHOA!', 'YIKES!', 'OOPS!'][Math.floor(Math.random() * 3)]);
    puff(p.x, p.y, 10, 50);
  }
  p.spin = 0; p.flipT = -1; p.superT = 0; p.tricksDone = [];
  p.lastTrackX = null;
}

function launch(vz, kind) {
  const p = game.p;
  p.state = 'air'; p.vz = vz; p.z = 0.5; p.airT = 0;
  p.vx = Math.sin(p.heading) * p.speed; p.vy = Math.cos(p.heading) * p.speed;
  p.spin = 0; p.flipT = -1; p.flips = 0; p.superT = 0; p.tricksDone = [];
  p.lastTrackX = null;
  p.launchKind = kind;
  if (kind === 'ramp') { Snd.jump(); spray(p.x, p.y + 6, 12, 0, p.speed * 0.4, 60); }
  else if (kind === 'hop') Snd.hop();
  else Snd.land();
}

function land() {
  const p = game.p;
  p.z = 0; p.vz = 0;
  const spinDeg = Math.abs(p.spin);
  const spinRem = ((p.spin % 360) + 360) % 360;
  const spinOk = spinRem < 40 || spinRem > 320;
  const flipOk = p.flipT < 0;
  const superOk = !keys.up || p.superT < 0.05 || !p.superHeld;
  p.superHeld = false;
  if (!spinOk || !flipOk || !superOk) {
    const why = !spinOk ? 'SIDEWAYS!' : !flipOk ? 'HEAD PLANT!' : 'LET GO!';
    crash(null, 'trip');
    game.texts.pop();
    floatText(p.x, p.y - 26, 'BAIL!', '#d8333a', why);
    return;
  }
  // score the trick list
  const parts = [];
  let pts = 0, types = 0;
  const spins = Math.floor((spinDeg + 40) / 360);
  if (spins > 0) { const n = spins * 360; parts.push(n + ' SPIN'); pts += 100 * spins * spins + 50 * spins; types++; }
  if (p.flips > 0) { parts.push(p.flips === 1 ? 'FRONT FLIP' : p.flips === 2 ? 'DOUBLE FLIP' : p.flips + 'X FLIP'); pts += 250 * p.flips * p.flips; types++; }
  if (p.superT >= 0.2) { parts.push('SUPERMAN'); pts += Math.round(60 + p.superT * 320); types++; }
  if (types === 0 && p.airT > 0.7) { parts.push('BIG AIR'); pts += Math.round(p.airT * 40); }
  if (types > 1) { parts.push('COMBO X' + types); pts *= types; }
  if (pts > 0) {
    pts = Math.round(pts / 10) * 10;
    game.score += pts;
    const label = parts.join(' + ');
    floatText(p.x, p.y - 30, '+' + pts, types ? '#2f5fd0' : '#1b1b2b', label);
    if (pts > game.bestTrickPts) { game.bestTrickPts = pts; game.bestTrick = label; }
    if (types) Snd.trick(types); else Snd.land();
  } else Snd.land();
  p.state = 'ride';
  p.speed = Math.hypot(p.vx, p.vy);
  spray(p.x, p.y + 4, 10, 0, 0, 90);
  p.spin = 0; p.flipT = -1; p.flips = 0; p.superT = 0;
}

// ---- update: player ------------------------------------------------------------------------------------
function updatePlayer(dt) {
  const p = game.p;
  p.t += dt;
  const steerL = pressed.has('left'), steerR = pressed.has('right');
  const anyGo = pressed.has('down') || pressed.has('hop') || steerL || steerR || pressed.has('tap') || (pointer.active && pointer.down);

  if (p.state === 'ready') {
    if (anyGo) { p.state = 'ride'; if (steerL) p.dir = -1; if (steerR) p.dir = 1; game.started = true; }
    return;
  }
  if (p.state === 'finished') {
    p.speed = Math.max(0, p.speed - 260 * dt);
    p.heading += (0 - p.heading) * Math.min(1, dt * 4);
    p.x += Math.sin(p.heading) * p.speed * dt; p.y += Math.cos(p.heading) * p.speed * dt;
    if (p.speed > 20) spray(p.x, p.y + 6, 1, 0, 0, 60);
    addTrack(p);
    return;
  }
  if (p.state === 'plowed') return;

  if (p.state === 'down') {
    const getUp = pressed.has('left') || pressed.has('right') || pressed.has('down') || pressed.has('hop') || pressed.has('up') || pressed.has('tap');
    if ((p.t > 0.55 && getUp) || p.t > 2.4) {
      p.state = 'ride'; p.dir = 0; p.heading = 0; p.speed = 0;
      if (steerL) p.dir = -1; if (steerR) p.dir = 1;
    }
    return;
  }
  if (p.state === 'tumble') {
    p.speed = Math.max(0, p.speed - 330 * dt);
    p.tumbleRot += dt * 900;
    p.x += Math.sin(p.heading) * p.speed * dt; p.y += Math.cos(p.heading) * p.speed * dt;
    if (Math.random() < 0.5) spray(p.x, p.y + 4, 1, 0, 0, 50);
    if (p.t > 0.75) { p.state = 'down'; p.t = 0.35; p.crashSledAng = p.heading * 180 / Math.PI + 90; p.crashSledOff = [10, 5]; }
    return;
  }

  // ---- steering input (ride + air share pointer logic) -------------------------------
  let wantDir = null;
  if (pointer.active && (!pointer.touch || pointer.down)) {
    const sx = p.x - game.cam.rx, sy = p.y - p.z - game.cam.ry;
    const dx = pointer.x - sx, dy = pointer.y - sy;
    if (Math.hypot(dx, dy) > 6) {
      if (dy < 0) wantDir = 3 * sign(dx);
      else {
        const ang = Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
        let best = 0;
        for (let i = 1; i < 4; i++) if (Math.abs(DIR_DEG[i] - ang) < Math.abs(DIR_DEG[best] - ang)) best = i;
        wantDir = best * sign(dx);
      }
    }
  }

  if (p.state === 'ride') {
    // keyboard steering with auto-repeat
    if (steerL || steerR) p.repeatT = 0.24;
    else if (keys.left || keys.right) { p.repeatT -= dt; }
    const stepDir = s => {
      if (s < 0 ? p.dir > -3 : p.dir < 3) p.dir += s;
      else if (p.speed < 30) { p.x += s * 7; p.scootT = 0.18; spray(p.x - s * 6, p.y + 4, 3, -s * 40, 0, 20); } // push along sideways
    };
    if (steerL) stepDir(-1);
    if (steerR) stepDir(1);
    if (p.repeatT <= 0 && (keys.left || keys.right)) { p.repeatT = 0.12; stepDir(keys.left ? -1 : 1); }
    if (pressed.has('down')) p.dir = 0;
    if (wantDir !== null && !p.onIce) p.dir = wantDir;

    // surfaces
    p.onIce = false; p.inPowder = false;
    const near = game.vis;
    for (const o of near) {
      if (o.kind !== 'zone') continue;
      const nx = (p.x - o.x) / (o.rx * 0.85), ny = (p.y + 4 - o.y) / (o.ry * 0.85);
      if (nx * nx + ny * ny < 1) { if (o.type === 'ice') p.onIce = true; else p.inPowder = true; }
    }
    // heading eases toward the steering notch (not on ice)
    const target = dirAngle(p.dir);
    if (!p.onIce) {
      const d = target - p.heading;
      p.heading += clamp(d, -9 * dt, 9 * dt);
    }
    // tuck stamina
    p.tucking = keys.tuck && p.stamina > 0.02 && Math.abs(p.dir) < 3;
    if (p.tucking) p.stamina = Math.max(0, p.stamina - dt / 2.8);
    else p.stamina = Math.min(1, p.stamina + dt / 9);
    p.braking = (keys.up || (pointer.active && pointer.down && wantDir !== null && Math.abs(wantDir) === 3)) && !p.onIce;

    const cs = Math.max(0, Math.cos(p.heading));
    let vt = VMAX * Math.pow(cs, 0.8) * (p.tucking ? TUCK_MULT : 1) * (p.onIce ? 1.12 : 1) * (p.inPowder ? 0.55 : 1);
    if (Math.abs(p.dir) === 3 && !p.onIce) {
      p.speed = Math.max(0, p.speed - 430 * dt);
      if (p.speed > 25) spray(p.x + Math.sin(p.heading) * 4, p.y + 6, 2, -Math.sin(p.heading) * 40, 60, 40);
    } else if (p.speed < vt) {
      p.speed = Math.min(vt, p.speed + 230 * Math.max(0.3, cs) * (p.inPowder ? 0.5 : 1) * dt);
    } else {
      p.speed = Math.max(vt, p.speed - (p.inPowder ? 420 : 110) * dt);
    }
    if (p.braking) {
      p.speed = Math.max(0, p.speed - 360 * dt);
      if (p.speed > 15) { spray(p.x - 5, p.y - 8, 1, -30, -20, 30); spray(p.x + 5, p.y - 8, 1, 30, -20, 30); }
    }
    if (p.inPowder && p.speed > 40 && Math.random() < 0.4) spray(p.x, p.y + 8, 1, 0, 10, 50);
    if (p.onIce && p.speed > 60 && Math.random() < 0.15) spray(p.x, p.y + 6, 1, 0, 0, 20, '#ffffff');
    // carving spray when the heading is swinging
    if (Math.abs(target - p.heading) > 0.15 && p.speed > 80) spray(p.x, p.y + 6, 1, -Math.cos(p.heading) * 60 * sign(target - p.heading), 0, 30);

    p.x += Math.sin(p.heading) * p.speed * dt;
    p.y += Math.cos(p.heading) * p.speed * dt;
    p.scootT = Math.max(0, p.scootT - dt);
    addTrack(p);

    if (pressed.has('hop') || (pressed.has('tap') && pointer.touch)) { launch(135, 'hop'); }
    else collidePlayer(false);
    if (pressed.has('pdown') && !pointer.touch && game.p.state === 'ride') launch(135, 'hop');
    return;
  }

  if (p.state === 'air') {
    p.airT += dt;
    p.z += p.vz * dt; p.vz -= GRAV * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    // tricks
    let spinIn = (keys.left ? -1 : 0) + (keys.right ? 1 : 0);
    if (pointer.active && pointer.down) spinIn = sign(pointer.x - (p.x - game.cam.rx)) || spinIn;
    p.spin += spinIn * 720 * dt;
    if (pressed.has('down') && p.flipT < 0) p.flipT = 0;
    if (p.flipT >= 0) { p.flipT += dt / 0.55; if (p.flipT >= 1) { p.flipT = -1; p.flips++; } }
    if (keys.up) { p.superT += dt; p.superHeld = true; } else p.superHeld = false;
    p.stamina = Math.min(1, p.stamina + dt / 9);
    if (p.z <= 0 && p.vz < 0) { land(); return; }
    collidePlayer(true);
  }
}

function addTrack(p) {
  if (p.speed < 2 && p.state !== 'ride') return;
  const tr = game.tracks;
  const px = Math.cos(p.heading), py = -Math.sin(p.heading); // perpendicular to heading
  const lx = Math.round(p.x - px * 4), ly = Math.round(p.y + 2 - py * 4), rx = Math.round(p.x + px * 4), ry = Math.round(p.y + 2 - py * -4);
  const ry2 = Math.round(p.y + 2 + py * 4);
  if (p.lastTrackX === null) { p.lastTrackX = [lx, ly, rx, ry2]; return; }
  const [a, b, c, d] = p.lastTrackX;
  if (Math.abs(lx - a) + Math.abs(ly - b) < 3) return;
  tr.push(a, b, lx, ly, c, d, rx, ry2);
  p.lastTrackX = [lx, ly, rx, ry2];
  if (tr.length > 8 * 2400) tr.splice(0, 8 * 400);
}

function collidePlayer(inAir) {
  const p = game.p;
  const pb = playerBox(p);
  let stillTouchingIgnored = false;
  for (const o of game.vis) {
    if (o.kind === 'zone' || o.kind === 'deco' || o.kind === 'gate' || o.dead) continue;
    if (!overlap(pb, objBox(o))) continue;
    if (o === p.ignore) { stillTouchingIgnored = true; continue; }
    if (inAir) {
      if (o.kind === 'bump' || o.kind === 'ramp') continue;
      if (p.z < o.h) { crash(o, o.kind === 'trip' && p.z < o.h * 0.6 ? 'trip' : 'crash'); return; }
      continue;
    }
    if (o.kind === 'ramp') {
      if (p.speed > 50) { launch(clamp(110 + p.speed * 0.95, 150, 430), 'ramp'); p.ignore = o; return; }
      continue;
    }
    if (o.kind === 'bump') {
      if (p.speed > 95) { launch(55 + p.speed * 0.25, 'bump'); p.ignore = o; return; }
      p.speed *= 0.995;
      continue;
    }
    crash(o, o.kind);
    return;
  }
  if (!stillTouchingIgnored) p.ignore = null;
}

// ---- gates / finish line -----------------------------------------------------------------------------
function updateCourse(prevY) {
  const p = game.p, w = game.world;
  if (p.state === 'plowed') return;
  if (!game.started && p.y >= START_Y) game.started = true;
  if (w.gates) {
    for (const g of w.gates) {
      if (g.state || !(prevY < g.y && p.y >= g.y)) continue;
      if (Math.abs(p.x - g.x) < g.w / 2) { g.state = 'pass'; game.passed++; Snd.gate(); floatText(g.x, g.y - 24, 'GATE ' + (g.idx + 1), '#2a7535'); }
      else { g.state = 'miss'; game.missed++; game.penalty += 5; Snd.miss(); floatText(p.x, p.y - 26, 'MISSED +5', '#d8333a'); }
    }
  }
  if (w.course && !game.result && prevY < w.course.len && p.y >= w.course.len) {
    // anything left unchecked is a miss
    if (w.gates) for (const g of w.gates) if (!g.state) { g.state = 'miss'; game.missed++; game.penalty += 5; }
    game.result = { mode: game.mode, time: game.time, total: game.time + game.penalty, score: game.score };
    if (p.state === 'air') land();
    p.state = 'finished';
    Snd.finish();
    let rec = false;
    if (game.mode === 'gates') { if (!BEST.gates || game.result.total < BEST.gates) { BEST.gates = +game.result.total.toFixed(2); rec = true; } }
    else if (game.mode === 'bigair') { if (game.score > BEST.bigair) { BEST.bigair = game.score; rec = true; } }
    game.result.record = rec;
    saveBest();
    bigMsg('FINISH!', null, 1.6, '#2a7535');
  }
}

// ---- NPCs -----------------------------------------------------------------------------------------------------
function spawnNPC() {
  const p = game.p, cam = game.cam;
  const r = Math.random();
  const below = cam.y + H + 40;
  if (r < 0.4) {
    game.npcs.push({ type: 'dog', x: p.x + (Math.random() - 0.5) * W * 0.9, y: below + Math.random() * 120, vx: 0, vy: 0, face: 1, state: 'wander', t: 0, cool: 0, wt: 0 });
  } else if (r < 0.72) {
    game.npcs.push({ type: 'saucer', x: p.x + (Math.random() - 0.5) * W * 0.8, y: below, vy: 95 + Math.random() * 40, vx: 0, rot: Math.random() * 360, rs: (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 120), t: 0, wob: Math.random() * 6, state: 'ride' });
  } else {
    const fromLeft = Math.random() < 0.5;
    game.npcs.push({ type: 'xc', x: p.x + (fromLeft ? -1 : 1) * (W / 2 + 30), y: below - Math.random() * 60, vx: (fromLeft ? 1 : -1) * (28 + Math.random() * 14), vy: 12, t: 0, state: 'walk' });
  }
}
function npcBox(n) {
  if (n.type === 'dog') return { x0: n.x - 6, x1: n.x + 6, y0: n.y - 6, y1: n.y + 1 };
  if (n.type === 'saucer') return { x0: n.x - 7, x1: n.x + 7, y0: n.y - 7, y1: n.y + 7 };
  return { x0: n.x - 5, x1: n.x + 5, y0: n.y - 4, y1: n.y + 1 };
}
function updateNPCs(dt) {
  const p = game.p;
  if (game.mode !== 'gates' && p.state !== 'ready') {
    game.npcT -= dt;
    if (game.npcT <= 0) { game.npcT = 2.2 + Math.random() * 3.5; if (game.npcs.length < 6 && p.speed > 40) spawnNPC(); }
  }
  const pb = playerBox(p);
  for (const n of game.npcs) {
    n.t += dt;
    if (n.type === 'dog') {
      n.cool = Math.max(0, n.cool - dt);
      const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy);
      if (n.state === 'wander') {
        n.wt -= dt;
        if (n.wt <= 0) { n.wt = 0.8 + Math.random() * 1.5; const a = Math.random() * Math.PI * 2; const s = Math.random() < 0.3 ? 0 : 40; n.vx = Math.cos(a) * s; n.vy = Math.sin(a) * s * 0.5; }
        if (d < 150 && n.cool <= 0 && p.state !== 'down') { n.state = 'chase'; n.t = 0; Snd.bark(); floatText(n.x, n.y - 16, 'WOOF!', '#5e3517'); }
      } else if (n.state === 'chase') {
        const s = 215;
        n.vx = dx / (d || 1) * s; n.vy = dy / (d || 1) * s + p.speed * Math.cos(p.heading) * 0.0;
        if (n.t > 2.6 || p.state === 'down') { n.state = 'sit'; n.t = 0; n.vx = 0; n.vy = 0; n.cool = 4; }
        if (Math.random() < dt * 1.2) { Snd.bark(); floatText(n.x, n.y - 16, 'WOOF!', '#5e3517'); }
      } else if (n.state === 'sit') {
        n.vx = 0; n.vy = 0;
        if (n.t > 2.5) { n.state = 'wander'; n.t = 0; }
      }
      if (Math.abs(n.vx) > 2) n.face = sign(n.vx);
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (p.state === 'ride' && n.state === 'chase' && overlap(pb, npcBox(n))) {
        crash(null, 'trip'); game.texts.pop(); floatText(p.x, p.y - 26, 'BAD DOG!', '#5e3517');
        Snd.bark(); n.state = 'sit'; n.t = 0; n.cool = 5;
      }
    } else if (n.type === 'saucer') {
      if (n.state === 'ride') {
        n.rot += n.rs * dt;
        n.vx = Math.sin(n.t * 1.3 + n.wob) * 26;
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (Math.random() < 0.2) spray(n.x, n.y + 6, 1, 0, 0, 30);
        // saucers run into the scenery too
        const hits = [];
        game.world.query(n.x - 10, n.y - 10, n.x + 10, n.y + 14, hits);
        for (const o of hits) if ((o.kind === 'crash') && overlap(npcBox(n), objBox(o))) { n.state = 'spill'; n.t = 0; Snd.thud(); puff(n.x, n.y, 8, 40); break; }
        if (p.state === 'ride' || (p.state === 'air' && p.z < 10)) {
          if (overlap(pb, npcBox(n))) { crash(null, 'crash'); game.texts.pop(); floatText(p.x, p.y - 26, 'SORRY!', '#d8333a'); n.state = 'spill'; n.t = 0; }
        }
      } else { n.vy = Math.max(0, n.vy - 200 * dt); n.y += n.vy * dt; n.rot += n.rs * dt * Math.max(0, 1 - n.t); }
    } else if (n.type === 'xc') {
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (p.state === 'ride' && overlap(pb, npcBox(n))) { crash(null, 'trip'); game.texts.pop(); floatText(p.x, p.y - 26, 'FORE!', '#7b4fc9'); n.vx *= -1; }
    }
  }
  const cy = game.cam.y;
  game.npcs = game.npcs.filter(n => n.y > cy - 260 && n.y < cy + H + 600 && Math.abs(n.x - p.x) < W * 1.5);
}

// ---- the plow ---------------------------------------------------------------------------------------------------
function updatePlow(dt) {
  const p = game.p;
  const distM = Math.max(0, (p.y - START_Y) / PX_PER_M);
  if (game.mode === 'free' && !game.plow && distM >= PLOW_AT_M) {
    game.plow = { x: p.x + (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 80), y: game.cam.y - 70, vx: 0, vy: 0, t: 0, caughtT: -1 };
    Snd.horn();
    bigMsg('THE PLOW IS COMING!', 'HOLD SHIFT TO TUCK AND RUN!', 3.2);
  }
  const pl = game.plow;
  if (!pl) return;
  pl.t += dt;
  if (pl.caughtT >= 0) {
    pl.caughtT += dt;
    pl.vy = 300; pl.vx *= 0.95;
    pl.x += pl.vx * dt; pl.y += pl.vy * dt;
    p.x = pl.x; p.y = pl.y - 4; p.z = 10;
    spray(pl.x + (Math.random() - 0.5) * 40, pl.y + 4, 3, 0, 120, 100);
    if (pl.caughtT > 2.4 && !game.over) {
      game.over = { distM: Math.floor(distM), score: game.score };
      let rec = false;
      if (Math.floor(distM) > BEST.free) { BEST.free = Math.floor(distM); rec = true; }
      if (game.score > BEST.freeStyle) BEST.freeStyle = game.score;
      game.over.record = rec; saveBest();
      Snd.over();
    }
    return;
  }
  const spd = Math.min(285, 150 + pl.t * 30);
  const dx = p.x - pl.x, dy = (p.y + 4) - pl.y, d = Math.hypot(dx, dy) || 1;
  pl.vx += (dx / d * spd - pl.vx) * Math.min(1, dt * 2.2);
  pl.vy += (dy / d * spd - pl.vy) * Math.min(1, dt * 2.2);
  pl.x += pl.vx * dt; pl.y += pl.vy * dt;
  // rubber-band: it never falls too far behind
  if (pl.y < game.cam.y - 420) pl.y = game.cam.y - 420;
  // bulldoze the scenery
  const hits = [];
  game.world.query(pl.x - 30, pl.y - 20, pl.x + 30, pl.y + 10, hits);
  for (const o of hits) {
    if (o.kind === 'zone' || o.kind === 'gate' || o.type === 'banner' || o.type === 'lodge' || o.kind === 'deco') continue;
    if (Math.abs(o.x - pl.x) < 26 && Math.abs(o.y - pl.y) < 10) { o.dead = true; puff(o.x, o.y - 6, 12, 90, o.type.startsWith('pine') ? ['#ffffff', '#2f8a4e', '#1d5b36'] : undefined); }
  }
  for (const n of game.npcs) if (Math.abs(n.x - pl.x) < 26 && Math.abs(n.y - pl.y) < 10 && n.type !== 'gone') { n.y = -1e9; puff(n.x, n.y, 4); }
  spray(pl.x + (Math.random() - 0.5) * 44, pl.y + 2, 2, (Math.random() - 0.5) * 120, Math.max(30, pl.vy * 0.6), 60);
  // catch
  if (p.state !== 'plowed' && Math.abs(p.x - pl.x) < 22 && p.y + 4 > pl.y - 12 && p.y + 4 < pl.y + 8 && p.z < 24) {
    p.state = 'plowed'; pl.caughtT = 0; p.speed = 0;
    Snd.gulp(); Snd.horn();
    game.cam.shake = 0.4;
    floatText(p.x, p.y - 30, 'NOOOO!', '#d8333a');
  }
}

// ---- main update --------------------------------------------------------------------------------------------------
function tick(dt) {
  if (pressed.has('mute')) { muted = !muted; Snd.setMuted(muted); try { localStorage.setItem('freesled.muted', muted ? '1' : '0'); } catch (e) {} }
  if (scene === 'title') { tickTitle(dt); return; }
  const g = game;
  if (g.over || (g.result && g.resultT > 1.2)) {
    if (pressed.has('enter') || pressed.has('restart') || pressed.has('tap') || pressed.has('hop')) { newGame(g.mode); return; }
    if (pressed.has('esc') || pressed.has('quit')) { scene = 'title'; return; }
  }
  if (pressed.has('pause') || (pressed.has('esc') && !g.over && !g.result)) { g.paused = !g.paused; Snd.select(); }
  if (g.paused) {
    if (pressed.has('quit')) { scene = 'title'; g.paused = false; }
    if (pressed.has('restart')) newGame(g.mode);
    if (pressed.has('tap') || pressed.has('enter')) g.paused = false;
    Snd.update(0, 0, 0, 0);
    return;
  }
  if (pressed.has('restart') && !g.over) { newGame(g.mode); return; }

  const p = g.p;
  const prevY = p.y;
  // visible / nearby objects for this tick
  g.vis.length = 0;
  g.world.query(p.x - 60, p.y - 60, p.x + 60, p.y + 60, g.vis);

  updatePlayer(dt);
  updateCourse(prevY);
  updateNPCs(dt);
  updatePlow(dt);
  if (g.result) g.resultT += dt;
  if (g.started && !g.result && !g.over && p.state !== 'plowed') g.time += dt;

  // particles
  for (const q of g.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vz -= 300 * dt; if (q.z < 0) { q.z = 0; q.vx *= 0.8; q.vy *= 0.8; q.vz = 0; } }
  g.particles = g.particles.filter(q => q.t < q.life);
  for (const t of g.texts) t.t += dt;
  g.texts = g.texts.filter(t => t.t < 1.4);
  if (g.msg) { g.msg.t += dt; if (g.msg.t > g.msg.dur) g.msg = null; }
  // chimney smoke
  if (Math.random() < dt * 6) g.smoke.push({ x: -150 + 22 + (Math.random() - 0.5) * 2, y: 96 - 58, t: 0, s: 1 + Math.random() });
  for (const s of g.smoke) { s.t += dt; s.y -= 14 * dt; s.x += Math.sin(s.t * 2 + s.s) * 6 * dt + 4 * dt; }
  g.smoke = g.smoke.filter(s => s.t < 3);

  // camera: rider fixed about a third of the way down, lagging horizontally
  const cam = g.cam;
  const focus = (p.state === 'plowed' && g.plow) ? g.plow : p;
  cam.x += (focus.x - cam.x) * Math.min(1, dt * 3.2);
  const lookAhead = H * (0.3 + Math.min(0.06, p.speed / VMAX * 0.05));
  const fz = focus === p ? p.z * 0.55 : 0;
  cam.y += (focus.y - fz - lookAhead - cam.y) * Math.min(1, dt * 10);
  cam.shake = Math.max(0, cam.shake - dt);
  g.world.prune(cam.y);

  // sound mix
  const grounded = p.state === 'ride' || p.state === 'finished';
  let eng = 0, pitch = 0;
  if (g.plow) { const d = Math.hypot(g.plow.x - p.x, g.plow.y - p.y); eng = clamp(1 - d / 700, 0.15, 1); pitch = clamp(Math.hypot(g.plow.vx, g.plow.vy) / 285, 0, 1.2); }
  Snd.update(grounded ? Math.min(1, p.speed / VMAX) * (p.inPowder ? 0.5 : 1) : 0, grounded && (p.braking || Math.abs(p.dir) === 3) && p.speed > 20 ? 1 : 0, eng, pitch);
}

function tickTitle(dt) {
  titleCam.y += 42 * dt;
  titleCam.x = Math.sin(titleCam.y / 500) * 80;
  titleWorld.prune(titleCam.y);
  if (overlay === 'help') {
    if (pressed.size && !pressed.has('mute')) { overlay = null; Snd.select(); }
    Snd.update(0, 0, 0, 0);
    return;
  }
  const items = MODE_KEYS.length + 1;
  if (pressed.has('up')) { menuSel = (menuSel + items - 1) % items; Snd.select(); }
  if (pressed.has('down')) { menuSel = (menuSel + 1) % items; Snd.select(); }
  if (pressed.has('help')) { overlay = 'help'; Snd.select(); return; }
  if (pointer.active) {
    const row = menuRowAt(pointer.x, pointer.y);
    if (row >= 0 && row !== menuSel && !pointer.touch) menuSel = row;
    if (pressed.has('pdown') && row >= 0) { menuSel = row; pickMenu(); return; }
  }
  if (pressed.has('enter') || pressed.has('hop')) pickMenu();
  Snd.update(0, 0, 0, 0);
}
function pickMenu() {
  if (menuSel < MODE_KEYS.length) newGame(MODE_KEYS[menuSel]);
  else { overlay = 'help'; Snd.select(); }
}
let menuLayout = { x: 0, y: 0, w: 0, rowH: 14 };
function menuRowAt(x, y) {
  const m = menuLayout;
  if (x < m.x || x > m.x + m.w) return -1;
  const r = Math.floor((y - m.y) / m.rowH);
  return r >= 0 && r <= MODE_KEYS.length ? r : -1;
}

// ---- rendering --------------------------------------------------------------------------------------------------------
const BG = '#f4f8fd';
function drawSpr(s, x, y) { ctx.drawImage(s.c, Math.round(x - s.ax), Math.round(y - s.ay)); }

function drawGround(camX, camY) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  // deterministic speckle texture so motion reads even on empty snow
  const T0x = Math.floor(camX / 24), T0y = Math.floor(camY / 24);
  for (let ty = T0y; ty <= T0y + Math.ceil(H / 24) + 1; ty++) for (let tx = T0x; tx <= T0x + Math.ceil(W / 24) + 1; tx++) {
    const h = hash3(tx, ty, 99);
    const n = h & 3;
    for (let i = 0; i < n; i++) {
      const hx = (h >>> (4 + i * 9)) & 511;
      const x = tx * 24 + (hx % 24), y = ty * 24 + ((hx >> 4) % 24);
      ctx.fillStyle = (h >>> 30) === 0 ? '#dfe8f4' : '#e8eff8';
      ctx.fillRect(x - camX, y - camY, (h >>> 28) & 1 ? 2 : 1, 1);
    }
  }
}

function drawTracks(tr, camX, camY) {
  ctx.fillStyle = '#d6e1ef';
  const y0 = -4, y1 = H + 4;
  for (let i = 0; i < tr.length; i += 4) {
    let ax = tr[i] - camX, ay = tr[i + 1] - camY, bx = tr[i + 2] - camX, by = tr[i + 3] - camY;
    if ((ay < y0 && by < y0) || (ay > y1 && by > y1)) continue;
    // integer DDA (pixel-crisp lines)
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) | 0 || 1;
    for (let k = 0; k <= n; k++) ctx.fillRect(Math.round(ax + (bx - ax) * k / n), Math.round(ay + (by - ay) * k / n), 1, 1);
  }
}

function drawBanner(o, camX, camY) {
  const x = Math.round(o.x - camX), y = Math.round(o.y - camY);
  const hw = o.hw;
  // shadows
  ctx.fillStyle = 'rgba(93,122,166,0.25)';
  ctx.fillRect(x - hw + 1, y, 5, 2); ctx.fillRect(x + hw + 1, y, 5, 2);
  // posts
  for (const px of [x - hw, x + hw]) {
    ctx.fillStyle = '#1b1b2b'; ctx.fillRect(px - 2, y - 44, 5, 45);
    ctx.fillStyle = '#c98a4b'; ctx.fillRect(px - 1, y - 43, 3, 43);
    ctx.fillStyle = '#8a5527'; ctx.fillRect(px + 1, y - 43, 1, 43);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(px - 2, y - 46, 5, 3);
  }
  // cloth
  const top = y - 42, bh = 13;
  ctx.fillStyle = '#1b1b2b'; ctx.fillRect(x - hw + 2, top - 1, hw * 2 - 3, bh + 2);
  if (o.banner === 'finish') {
    for (let yy = 0; yy < bh; yy += 3) for (let xx = 0; xx < hw * 2 - 5; xx += 3) {
      ctx.fillStyle = ((xx + yy) / 3) % 2 ? '#1b1b2b' : '#ffffff';
      ctx.fillRect(x - hw + 3 + xx, top + yy, 3, 3);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 22, top + 2, 44, 9);
    drawText(ctx, o.text, x, top + 3, '#1b1b2b', 1, 'center');
  } else {
    ctx.fillStyle = '#d8333a'; ctx.fillRect(x - hw + 3, top, hw * 2 - 5, bh);
    ctx.fillStyle = '#9c1f2a'; ctx.fillRect(x - hw + 3, top + bh - 2, hw * 2 - 5, 2);
    ctx.fillStyle = '#f6c431'; ctx.fillRect(x - hw + 3, top, hw * 2 - 5, 1);
    drawText(ctx, o.text, x, top + 3, '#ffffff', 1, 'center');
  }
}

function drawSign(o, camX, camY) {
  drawSpr(SPR.sign, o.x - camX, o.y - camY);
  if (o.label) drawText(ctx, o.label, Math.round(o.x - camX), Math.round(o.y - camY) - 23, '#5e3517', 1, 'center');
}

function drawGate(g, camX, camY) {
  // a faint dotted line on the snow marks the gate
  const y = Math.round(g.y - camY) + 1;
  const x0 = Math.round(g.x - g.w / 2 - camX) + 3, x1 = Math.round(g.x + g.w / 2 - camX) - 2;
  ctx.fillStyle = g.state === 'pass' ? '#9fd8a8' : g.state === 'miss' ? '#f0a2a5' : '#d6e1ef';
  for (let x = x0; x < x1; x += 3) ctx.fillRect(x, y, 2, 1);
  if (!g.state || g.state) drawText(ctx, String(g.idx + 1), Math.round(g.x - camX), y - 12, g.state === 'miss' ? '#d8333a' : g.state === 'pass' ? '#2a7535' : '#9fb3cf', 1, 'center');
}

function playerSprite(p) {
  const deg = p.heading * 180 / Math.PI;
  if (p.state === 'tumble') return rotSprite('player', deg + p.tumbleRot, 10);
  if (p.state === 'air') return rotSprite('player', deg + p.spin, 4);
  return rotSprite('player', deg, 3);
}

function drawPlayer(p, camX, camY) {
  const x = p.x - camX, y = p.y - camY;
  if (p.state === 'down' || p.state === 'plowed') {
    const z = p.state === 'plowed' ? p.z : 0;
    const sled = rotSprite('sled', p.crashSledAng, 6);
    if (p.state === 'down') drawSpr(sled, x + p.crashSledOff[0], y + p.crashSledOff[1]);
    drawSpr(SPR.crash, x, y - z);
    // dizzy stars
    const t = performance.now() / 1000;
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + i * 2.094;
      const sx = Math.round(x + Math.cos(a) * 8), sy = Math.round(y - z - 10 + Math.sin(a) * 3);
      ctx.fillStyle = '#f6c431'; ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3);
    }
    return;
  }
  // shadow
  const sh = p.z > 0 ? Math.max(3, 9 - p.z * 0.04) : 9;
  ctx.fillStyle = 'rgba(93,122,166,0.28)';
  ctx.beginPath(); ctx.ellipse(Math.round(x + 2 + p.z * 0.15), Math.round(y + 3), sh, sh * 0.55, 0, 0, Math.PI * 2); ctx.fill();

  const yy = y - p.z - (p.scootT > 0 ? 1 : 0);
  if (p.state === 'air' && (p.flipT >= 0)) {
    // front flip: squash vertically through the rotation, showing the runners underneath
    const ph = p.flipT * Math.PI * 2;
    const c = Math.cos(ph);
    const base = Math.abs(c) < 0.001 ? 0.001 : c;
    const spr = c >= 0 ? playerSprite(p) : rotSprite('sledBottom', p.heading * 180 / Math.PI + p.spin, 4);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(yy - Math.sin(ph) * 6));
    ctx.scale(1, Math.max(0.15, Math.abs(base)));
    ctx.drawImage(spr.c, -Math.round(spr.ax), -Math.round(spr.ay));
    ctx.restore();
    return;
  }
  if (p.state === 'air' && p.superHeld) {
    // superman: rider lifts off the sled and stretches out behind it
    const deg = p.heading * 180 / Math.PI + p.spin;
    const a = rad(deg);
    const sled = rotSprite('sled', deg, 4), rider = rotSprite('rider', deg, 4);
    drawSpr(sled, x, yy);
    const ext = Math.min(9, p.superT * 40);
    drawSpr(rider, x - Math.sin(a) * ext, yy - Math.cos(a) * ext - 2);
    return;
  }
  const s = playerSprite(p);
  drawSpr(s, x, yy);
  if (p.tucking && p.state === 'ride' && p.speed > 100) {
    // wind streaks while tucked
    ctx.fillStyle = '#c9d8ec';
    for (let i = 0; i < 3; i++) { const ox = ((performance.now() / 20 + i * 37) % 24) - 12; ctx.fillRect(Math.round(x + ox), Math.round(yy - 16 - i * 3), 1, 4); }
  }
}

function drawNPC(n, camX, camY) {
  const x = n.x - camX, y = n.y - camY;
  if (n.type === 'dog') {
    const f = n.face > 0 ? 'r' : 'l';
    let s;
    if (n.state === 'sit' || (Math.abs(n.vx) + Math.abs(n.vy) < 3)) s = SPR['dogSit_' + f];
    else s = SPR[(Math.floor(n.t * (n.state === 'chase' ? 12 : 6)) % 2 ? 'dogA_' : 'dogB_') + f];
    ctx.fillStyle = 'rgba(93,122,166,0.25)'; ctx.fillRect(Math.round(x - 6), Math.round(y), 13, 2);
    drawSpr(s, x, y);
  } else if (n.type === 'saucer') {
    ctx.fillStyle = 'rgba(93,122,166,0.25)';
    ctx.beginPath(); ctx.ellipse(Math.round(x + 2), Math.round(y + 3), 9, 5, 0, 0, Math.PI * 2); ctx.fill();
    drawSpr(rotSprite('saucer', n.rot, 15), x, y);
    if (n.state === 'spill') drawText(ctx, '@', Math.round(x), Math.round(y - 16), '#9fd0ee', 1, 'center');
  } else if (n.type === 'xc') {
    const f = n.vx > 0 ? 'r' : 'l';
    ctx.fillStyle = 'rgba(93,122,166,0.25)'; ctx.fillRect(Math.round(x - 7), Math.round(y), 17, 2);
    drawSpr(SPR[(Math.floor(n.t * 3) % 2 ? 'xcA_' : 'xcB_') + f], x, y);
  }
}

function drawPlow(pl, camX, camY) {
  const s = Math.floor(performance.now() / 180) % 2 ? SPR.plow0 : SPR.plow1;
  const x = pl.x - camX, y = pl.y - camY;
  drawSpr(s, x + (Math.random() - 0.5) * 1.2, y);
  if (s === SPR.plow0) {
    ctx.fillStyle = 'rgba(255,170,40,0.35)';
    ctx.fillRect(Math.round(x - 9), Math.round(y - 44), 18, 3);
    ctx.fillRect(Math.round(x - 5), Math.round(y - 47), 10, 2);
  }
}

function drawWorld(world, camX, camY, withGame) {
  camX = Math.round(camX); camY = Math.round(camY);
  drawGround(camX, camY);
  const vis = [];
  world.query(camX - 80, camY - 40, camX + W + 80, camY + H + 80, vis);
  // ground layer: zones then tracks then gate lines
  for (const o of vis) if (o.kind === 'zone') { const s = zoneSprite(o); drawSpr(s, o.x - camX, o.y - camY); }
  if (withGame) drawTracks(game.tracks, camX, camY);
  for (const o of vis) if (o.type === 'gate') drawGate(o, camX, camY);
  for (const o of vis) if (o.type === 'mogul') drawSpr(SPR[o.spr], o.x - camX, o.y - camY);
  // y-sorted upright layer
  const list = [];
  for (const o of vis) if (o.kind !== 'zone' && o.type !== 'gate' && o.type !== 'mogul' && o.type !== 'bannerpost') list.push({ y: o.y, o });
  if (withGame) {
    const p = game.p;
    list.push({ y: p.y + 5, player: true });
    for (const n of game.npcs) list.push({ y: n.y, npc: n });
    if (game.plow) list.push({ y: game.plow.y + 2, plow: true });
  }
  list.sort((a, b) => a.y - b.y);
  for (const it of list) {
    if (it.player) drawPlayer(game.p, camX, camY);
    else if (it.npc) drawNPC(it.npc, camX, camY);
    else if (it.plow) drawPlow(game.plow, camX, camY);
    else {
      const o = it.o;
      if (o.type === 'banner') drawBanner(o, camX, camY);
      else if (o.type === 'sign') drawSign(o, camX, camY);
      else if (o.spr) drawSpr(SPR[o.spr], o.x - camX, o.y - camY);
      if (o.type === 'lodge' && withGame) for (const s of game.smoke) {
        const a = 1 - s.t / 3;
        ctx.fillStyle = `rgba(200,210,224,${(a * 0.8).toFixed(2)})`;
        const r = 1 + s.t * 1.3 * s.s;
        ctx.fillRect(Math.round(s.x - camX - r / 2), Math.round(s.y - camY - r / 2), Math.ceil(r), Math.ceil(r));
      }
    }
  }
}

function drawParticles(camX, camY) {
  for (const q of game.particles) {
    const a = 1 - q.t / q.life;
    if (a < 0.15 && Math.random() < 0.5) continue;
    ctx.fillStyle = q.c;
    const sz = q.big ? 2 : 1;
    ctx.fillRect(Math.round(q.x - camX), Math.round(q.y - q.z - camY), sz, sz);
  }
}

function drawSnowfall(dx, dy) {
  for (const f of flakes) {
    f.y += (14 + f.s * 26) / 60 - dy * (0.3 + f.s * 0.5);
    f.x += Math.sin((f.y + f.w * 50) / 40) * 0.15 - dx * (0.3 + f.s * 0.5);
    const X = ((f.x % W) + W) % W, Y = ((f.y % H) + H) % H;
    ctx.fillStyle = f.s > 0.7 ? '#ffffff' : '#dbe6f3';
    ctx.fillRect(Math.round(X), Math.round(Y), f.s > 0.85 ? 2 : 1, f.s > 0.85 ? 2 : 1);
    if (f.s > 0.7) { ctx.fillStyle = '#b9c9de'; ctx.fillRect(Math.round(X) + 1, Math.round(Y) + (f.s > 0.85 ? 2 : 1), 1, 1); }
  }
}

function panel(x, y, w, h, fill = '#ffffff') {
  ctx.fillStyle = 'rgba(27,27,43,0.25)'; ctx.fillRect(x + 2, y + 2, w, h);
  ctx.fillStyle = '#1b1b2b'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
}

function drawHUD() {
  const g = game, p = g.p;
  const distM = Math.max(0, Math.floor((p.y - START_Y) / PX_PER_M));
  const lines = [];
  lines.push(['TIME', fmtTime(g.time)]);
  if (g.mode === 'gates') {
    lines.push(['GATES', (g.passed) + '/' + g.world.gates.length]);
    lines.push(['MISSED', g.missed + (g.penalty ? ' +' + g.penalty + 'S' : '')]);
    lines.push(['TO GO', Math.max(0, Math.ceil((g.world.course.len - p.y) / PX_PER_M)) + 'M']);
  } else if (g.mode === 'bigair') {
    lines.push(['SCORE', String(g.score)]);
    lines.push(['TO GO', Math.max(0, Math.ceil((g.world.course.len - p.y) / PX_PER_M)) + 'M']);
  } else {
    lines.push(['DIST', distM + 'M']);
    lines.push(['STYLE', String(g.score)]);
  }
  const spd = p.state === 'air' ? Math.hypot(p.vx, p.vy) : (p.state === 'ride' || p.state === 'tumble' || p.state === 'finished') ? p.speed : 0;
  lines.push(['SPEED', Math.round(spd / PX_PER_M * 3.6) + ' KM/H']);
  const pw = 112, ph = lines.length * 10 + 6;
  const px = W - pw - 6, py = 6;
  panel(px, py, pw, ph);
  lines.forEach(([k, v], i) => {
    drawText(ctx, k, px + 5, py + 4 + i * 10, '#5b636d');
    drawText(ctx, v, px + pw - 5, py + 4 + i * 10, '#1b1b2b', 1, 'right');
  });
  // tuck meter
  const bx = 8, by = H - 14;
  drawText(ctx, 'TUCK', bx, by - 1, '#5b636d');
  panel(bx + 28, by, 52, 5, '#e7eff9');
  ctx.fillStyle = p.stamina < 0.25 ? '#d8333a' : p.tucking ? '#ff8a1f' : '#2f5fd0';
  ctx.fillRect(bx + 28, by, Math.round(52 * p.stamina), 5);
  if (muted) drawText(ctx, 'MUTED', W - 6, H - 12, '#9aa3ad', 1, 'right');
  // plow proximity
  if (g.plow && g.plow.caughtT < 0) {
    const d = Math.max(0, Math.round((p.y - g.plow.y) / PX_PER_M));
    const flash = Math.floor(performance.now() / 250) % 2;
    drawText(ctx, 'PLOW ' + d + 'M BEHIND', W / 2, 8, flash || d > 25 ? '#d8333a' : '#ff8a1f', 1, 'center', '#ffffff');
    if (g.plow.y < g.cam.y) {
      // arrow pointing at the off-screen plow
      const ax = clamp(Math.round(g.plow.x - g.cam.rx), 10, W - 10);
      ctx.fillStyle = flash ? '#ff8a1f' : '#d8333a';
      for (let i = 0; i < 4; i++) ctx.fillRect(ax - i, 20 + i, i * 2 + 1, 1);
    }
  } else if (g.mode === 'free' && distM > PLOW_AT_M - 150 && distM < PLOW_AT_M) {
    drawText(ctx, 'YOU HEAR AN ENGINE...', W / 2, 8, '#9aa3ad', 1, 'center');
  }
}

function drawCenterMsg() {
  const m = game.msg;
  if (!m) return;
  if (m.t < 0.15 && Math.floor(m.t * 30) % 2) return;
  const y = Math.round(H * 0.18);
  drawText(ctx, m.text, W / 2, y, m.color, 2, 'center', '#ffffff', null);
  if (m.sub) drawText(ctx, m.sub, W / 2, y + 20, '#1b1b2b', 1, 'center', '#ffffff');
}

function drawFloatTexts(camX, camY) {
  for (const t of game.texts) {
    const k = t.t / 1.4;
    if (k > 0.8 && Math.floor(t.t * 20) % 2) continue;
    const x = Math.round(t.x - camX), y = Math.round(t.y - camY - t.t * 18);
    drawText(ctx, t.text, x, y, t.color, 1, 'center', '#ffffff');
    if (t.sub) drawText(ctx, t.sub, x, y + 10, '#5b636d', 1, 'center', '#ffffff');
  }
}

function drawReadyPrompt() {
  const blink = Math.floor(performance.now() / 500) % 2;
  const y = Math.round(H * 0.62);
  panel(W / 2 - 110, y - 6, 220, 40, '#ffffff');
  drawText(ctx, MODES[game.mode].name, W / 2, y, '#d8333a', 1, 'center');
  drawText(ctx, MODES[game.mode].desc, W / 2, y + 11, '#5b636d', 1, 'center');
  if (blink) drawText(ctx, 'PRESS _ OR TAP TO PUSH OFF', W / 2, y + 22, '#1b1b2b', 1, 'center');
}

function drawResult() {
  const g = game, r = g.result;
  if (!r || g.resultT < 1.0) return;
  const w = 210, h = 104, x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2);
  panel(x, y, w, h);
  drawText(ctx, MODES[r.mode].name + ' COMPLETE', W / 2, y + 7, '#2a7535', 1, 'center');
  const rows = [];
  if (r.mode === 'gates') {
    rows.push(['RUN TIME', fmtTime(r.time)]);
    rows.push(['GATES MISSED', g.missed + ' (+' + g.penalty + 'S)']);
    rows.push(['FINAL TIME', fmtTime(r.total)]);
    rows.push(['BEST', BEST.gates ? fmtTime(BEST.gates) : '-']);
  } else {
    rows.push(['SCORE', String(r.score)]);
    rows.push(['TIME', fmtTime(r.time)]);
    rows.push(['CRASHES', String(g.crashes)]);
    rows.push(['BEST', String(BEST.bigair)]);
  }
  rows.forEach(([k, v], i) => { drawText(ctx, k, x + 10, y + 22 + i * 11, '#5b636d'); drawText(ctx, v, x + w - 10, y + 22 + i * 11, '#1b1b2b', 1, 'right'); });
  if (r.mode === 'bigair' && g.bestTrick) drawText(ctx, 'BEST: ' + g.bestTrick.slice(0, 32), W / 2, y + 68, '#2f5fd0', 1, 'center');
  if (r.record && Math.floor(performance.now() / 300) % 2) drawText(ctx, 'NEW RECORD!', W / 2, y + 79, '#d8333a', 1, 'center');
  drawText(ctx, 'ENTER: AGAIN   ESC: MENU', W / 2, y + h - 11, '#1b1b2b', 1, 'center');
}

function drawGameOver() {
  const g = game, o = g.over;
  if (!o) return;
  ctx.fillStyle = 'rgba(244,248,253,0.55)'; ctx.fillRect(0, 0, W, H);
  const w = 210, h = 100, x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2);
  panel(x, y, w, h);
  drawText(ctx, 'PLOWED!', W / 2, y + 7, '#d8333a', 2, 'center');
  const rows = [['DISTANCE', o.distM + 'M'], ['STYLE', String(o.score)], ['TIME', fmtTime(g.time)], ['BEST', BEST.free + 'M']];
  rows.forEach(([k, v], i) => { drawText(ctx, k, x + 10, y + 28 + i * 11, '#5b636d'); drawText(ctx, v, x + w - 10, y + 28 + i * 11, '#1b1b2b', 1, 'right'); });
  if (o.record && Math.floor(performance.now() / 300) % 2) drawText(ctx, 'NEW RECORD!', W / 2, y + 74, '#2f5fd0', 1, 'center');
  drawText(ctx, 'ENTER: AGAIN   ESC: MENU', W / 2, y + h - 11, '#1b1b2b', 1, 'center');
}

function drawPause() {
  ctx.fillStyle = 'rgba(244,248,253,0.6)'; ctx.fillRect(0, 0, W, H);
  const w = 180, h = 62, x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2);
  panel(x, y, w, h);
  drawText(ctx, 'PAUSED', W / 2, y + 8, '#1b1b2b', 2, 'center');
  drawText(ctx, 'P: RESUME   R: RESTART', W / 2, y + 30, '#5b636d', 1, 'center');
  drawText(ctx, 'Q: QUIT TO MENU', W / 2, y + 42, '#5b636d', 1, 'center');
}

function drawLogo(cx, y) {
  const t = performance.now() / 1000;
  drawText(ctx, 'FREE', cx - 2, y, '#2f5fd0', 4, 'center', '#1b1b2b', '#1b1b2b');
  drawText(ctx, 'SLED', cx + 6, y + 34, '#d8333a', 4, 'center', '#1b1b2b', '#1b1b2b');
  // a little sled on the logo, swaying
  const s = rotSprite('player', Math.sin(t * 2) * 28, 3);
  drawSpr(s, cx + 72, y + 46 + Math.sin(t * 4) * 1.5);
  // snow caps on the letters
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(cx - 2 - 58 + i * 24), y - 3, 14, 2);
}

function drawTitle() {
  drawWorld(titleWorld, titleCam.x - W / 2, titleCam.y, false);
  drawSnowfall(0, 0.7);
  ctx.fillStyle = 'rgba(244,248,253,0.35)'; ctx.fillRect(0, 0, W, H);
  if (overlay === 'help') { drawHelp(); return; }
  const cx = Math.round(W / 2);
  const ly = Math.max(14, Math.round(H * 0.1));
  drawLogo(cx, ly);
  // menu
  const mw = 220, rowH = 14;
  const my = ly + 86;
  menuLayout = { x: cx - mw / 2, y: my, w: mw, rowH };
  panel(cx - mw / 2, my - 4, mw, rowH * (MODE_KEYS.length + 1) + 6);
  const bestStr = k => k === 'free' ? (BEST.free ? BEST.free + 'M' : '') : k === 'gates' ? (BEST.gates ? fmtTime(BEST.gates) : '') : (BEST.bigair ? String(BEST.bigair) : '');
  MODE_KEYS.forEach((k, i) => {
    const y = my + i * rowH;
    if (menuSel === i) { ctx.fillStyle = '#dde8f7'; ctx.fillRect(cx - mw / 2, y - 3, mw, rowH); }
    drawText(ctx, (menuSel === i ? '} ' : '  ') + MODES[k].name, cx - mw / 2 + 8, y + 1, menuSel === i ? '#d8333a' : '#1b1b2b');
    const b = bestStr(k);
    if (b) drawText(ctx, 'BEST ' + b, cx + mw / 2 - 8, y + 1, '#5b636d', 1, 'right');
  });
  const hy = my + MODE_KEYS.length * rowH;
  if (menuSel === MODE_KEYS.length) { ctx.fillStyle = '#dde8f7'; ctx.fillRect(cx - mw / 2, hy - 3, mw, rowH); }
  drawText(ctx, (menuSel === MODE_KEYS.length ? '} ' : '  ') + 'HOW TO PLAY', cx - mw / 2 + 8, hy + 1, menuSel === MODE_KEYS.length ? '#d8333a' : '#1b1b2b');
  const sel = MODE_KEYS[menuSel];
  const dy = my + rowH * (MODE_KEYS.length + 1) + 8;
  if (sel) drawText(ctx, MODES[sel].desc, cx, dy, '#1b1b2b', 1, 'center', '#ffffff');
  drawText(ctx, '^_ CHOOSE   ENTER GO   H HELP   M SOUND', cx, H - 14, '#5b636d', 1, 'center', '#ffffff');
}

function drawHelp() {
  const w = Math.min(W - 16, 400), h = Math.min(H - 16, 300);
  const x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2);
  panel(x, y, w, h);
  drawText(ctx, 'HOW TO PLAY', W / 2, y + 6, '#d8333a', 2, 'center');
  const ctl = [
    ['{ }  A D', 'STEER (TAP AGAIN TO STOP SIDEWAYS)'],
    ['_  S', 'POINT STRAIGHT DOWNHILL'],
    ['^  W', 'DRAG HEELS TO BRAKE'],
    ['SPACE', 'HOP OVER ROCKS AND STUMPS'],
    ['SHIFT F', 'TUCK FOR SPEED (USES STAMINA)'],
    ['IN THE AIR', '{ } SPIN   _ FLIP   ^ SUPERMAN'],
    ['MOUSE/TOUCH', 'POINT TO STEER, CLICK/TAP TO HOP'],
    ['P  R  M', 'PAUSE  RESTART  SOUND'],
  ];
  let yy = y + 28;
  const colX = x + 10, col2 = x + Math.min(96, w * 0.28);
  for (const [k, v] of ctl) { drawText(ctx, k, colX, yy, '#2f5fd0'); drawText(ctx, v, col2, yy, '#1b1b2b'); yy += 10; }
  yy += 6;
  // legend with real sprites
  const legend = [
    ['pine_big0', 'CRASH'], ['rock0', 'TRIP (HOP IT)'], ['ramp', 'LAUNCH'], ['mogul0', 'BUMP AIR'],
    ['snowman0', 'SPLAT'], ['flag_r', 'GATE'], ['dogA_r', 'GOOD BOY?'], ['plow0', 'RUN!'],
  ];
  const cols = w > 330 ? 4 : 2;
  const cw = Math.floor((w - 20) / cols);
  legend.forEach(([s, label], i) => {
    const cx = x + 10 + (i % cols) * cw + cw / 2;
    const cy = yy + 46 + Math.floor(i / cols) * 62;
    if (cy > y + h - 16) return;
    drawSpr(SPR[s], cx, cy);
    drawText(ctx, label, Math.round(cx), cy + 6, '#5b636d', 1, 'center');
  });
  drawText(ctx, 'LAND STRAIGHT OR WIPE OUT. ICE: NO STEERING. POWDER: SLOW.', W / 2, y + h - 22, '#1b1b2b', 1, 'center');
  drawText(ctx, 'PRESS ANY KEY', W / 2, y + h - 11, '#9aa3ad', 1, 'center');
}

let lastCam = { x: 0, y: 0 };
function render() {
  ctx.imageSmoothingEnabled = false;
  if (scene === 'title') { drawTitle(); return; }
  const g = game, cam = g.cam;
  let sx = 0, sy = 0;
  if (cam.shake > 0) { sx = Math.round((Math.random() - 0.5) * 4); sy = Math.round((Math.random() - 0.5) * 4); }
  cam.rx = Math.round(cam.x - W / 2) + sx; cam.ry = Math.round(cam.y) + sy;
  drawWorld(g.world, cam.rx, cam.ry, true);
  drawParticles(cam.rx, cam.ry);
  drawFloatTexts(cam.rx, cam.ry);
  drawSnowfall(cam.rx - lastCam.x, cam.ry - lastCam.y);
  lastCam.x = cam.rx; lastCam.y = cam.ry;
  drawHUD();
  drawCenterMsg();
  if (g.p.state === 'ready') drawReadyPrompt();
  if (g.p.state === 'down' && g.p.t > 0.8 && Math.floor(performance.now() / 400) % 2) drawText(ctx, 'PRESS ANY ARROW TO GET UP', W / 2, Math.round(H * 0.75), '#5b636d', 1, 'center', '#ffffff');
  drawResult();
  drawGameOver();
  if (g.paused) drawPause();
}

// ---- boot ----------------------------------------------------------------------------------------------------------------
buildSprites();
let last = performance.now(), acc = 0;
function frame(now) {
  let dt = (now - last) / 1000; last = now;
  if (dt > 0.1) dt = 0.1;
  acc += dt;
  while (acc >= STEP) { tick(STEP); pressed.clear(); acc -= STEP; }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// debug hooks for automated testing
window.__freesled = { get game() { return game; }, newGame, get scene() { return scene; }, keys, pressed };
})();
