'use strict';
// ---------------------------------------------------------------------------
// FREE SLED — an original downhill sledding game.
// World units are logical pixels; 16 px = 1 metre. Physics runs at 120 Hz.
// Every sledder (you or a computer rival) is a "racer" driven by the same
// physics; only the input source differs.
// ---------------------------------------------------------------------------
(() => {
const PX_PER_M = 16;
const STEP = 1 / 120;
const GRAV = 520;
const VMAX = 250;                 // top speed pointing straight downhill (px/s)
const TUCK_MULT = 1.42;           // tuck boost multiplier
const WAX_MULT = 1.6;             // turbo wax multiplier
const DIR_DEG = [0, 28, 55, 90];  // sled heading per steering notch
const CELL = 256;
const PLOW_AT_M = 2000;

const MODES = {
  race:   { name: 'RACE', desc: 'BEAT 5 RIVALS DOWN THE HILL. GRAB GIFTS!', len: 1200 * PX_PER_M, halfW: 230 },
  free:   { name: 'FREE RUN', desc: 'ENDLESS HILL. HOW FAR CAN YOU GO?' },
  gates:  { name: 'GATE RUN', desc: 'THREAD EVERY GATE. MISSES COST 5 SEC.', len: 800 * PX_PER_M, halfW: 230 },
  bigair: { name: 'BIG AIR', desc: 'HIT RAMPS, LAND TRICKS, SCORE BIG.', len: 1000 * PX_PER_M, halfW: 230 },
};
const MODE_KEYS = ['race', 'free', 'gates', 'bigair'];
const START_Y = 150;
const RIVALS = ['max', 'zoe', 'ollie', 'pip', 'bea'];

const ITEMS = {
  snowball:  { name: 'SNOWBALL' },
  snowball3: { name: 'SNOWBALL X3' },
  slush:     { name: 'SLUSH' },
  wax:       { name: 'TURBO WAX' },
  shield:    { name: 'SNOW GLOBE' },
  blizzard:  { name: 'BLIZZARD' },
};
// item odds by race position: [leader weights, last-place weights]; interpolated in between
const ITEM_ODDS = {
  snowball:  [40, 8],
  snowball3: [4, 22],
  slush:     [38, 4],
  wax:       [4, 34],
  shield:    [14, 14],
  blizzard:  [0, 18],
};

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
const ordinal = n => n + (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');

// ---- persistence (best effort) ------------------------------------------------------
let BEST = { free: 0, freeStyle: 0, gates: 0, bigair: 0, racePlace: 0, raceTime: 0, raceWins: 0 };
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
  gift:       { sprs: ['gift0', 'gift1', 'gift2', 'gift3'], hw: 7, hh: 8, h: 0, kind: 'item' },
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
  const wob = [((o.seed % 97) / 97), ((o.seed % 89) / 89), ((o.seed % 83) / 83)];
  const cx = w / 2, cy = h / 2;
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
  KeyE: 'item', KeyX: 'item', ControlLeft: 'item', ControlRight: 'item',
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

const pointer = { active: false, x: 0, y: 0, down: false, downT: 0, sx: 0, sy: 0, btn: false, touch: false };
let itemBtn = null; // on-screen item button (race mode, touch)
function pointerPos(e) { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / SCALE, (e.clientY - r.top) / SCALE]; }
canvas.addEventListener('pointerdown', e => {
  Snd.init();
  [pointer.x, pointer.y] = pointerPos(e);
  pointer.touch = e.pointerType !== 'mouse';
  if (e.button === 2) { pressed.add('item'); return; }
  if (itemBtn && Math.hypot(pointer.x - itemBtn.x, pointer.y - itemBtn.y) < itemBtn.r + 4) { pressed.add('item'); pointer.btn = true; return; }
  pointer.btn = false;
  pointer.sx = pointer.x; pointer.sy = pointer.y;
  pointer.down = true; pointer.downT = performance.now(); pointer.active = true;
  pressed.add('pdown');
});
canvas.addEventListener('pointermove', e => {
  const [x, y] = pointerPos(e);
  if (pointer.btn) return;
  pointer.x = x; pointer.y = y;
  if (e.pointerType === 'mouse' || pointer.down) pointer.active = true;
});
window.addEventListener('pointerup', () => {
  if (pointer.btn) { pointer.btn = false; return; }
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
    this.giftRows = [];
    this.gifts = [];
    this.buildStatics();
    this.statics.sort((a, b) => a.y - b.y);
  }
  buildStatics() {
    const S = this.statics, r = rng32(this.seed ^ 0xabc);
    S.push(makeObj('lodge', -150, 96, r));
    S.push(makeObj('sign', -92, 112, r, { label: 'COCOA' }));
    S.push(makeObj('pine_snowy', -205, 70, r), makeObj('pine_big', -232, 110, r), makeObj('pine_snowy', 120, 60, r), makeObj('pine_med', 150, 92, r));
    if (this.mode !== 'race') S.push(makeObj('snowman', 98, 124, r));
    const bannerText = this.course ? MODES[this.mode].name : 'START';
    this.addBanner(START_Y, 'start', bannerText);
    if (!this.course) return;
    const len = this.course.len, hw = this.course.halfW;
    for (let y = START_Y + 40; y < len + 400; y += 96) S.push(makeObj('pole', -hw, y, r), makeObj('pole', hw, y, r));
    this.addBanner(len, 'finish', 'FINISH');
    if (this.mode === 'gates') {
      this.gates = [];
      let i = 0;
      for (let y = START_Y + 340; y < len - 220; y += 400 + Math.floor(r() * 60)) {
        const gx = Math.round(Math.sin(y / 1100 + this.seed) * 110 + (r() - 0.5) * 80);
        const gw = 64;
        const col = i % 2 ? 'flag_b' : 'flag_r';
        const gate = { id: OBJ_ID++, type: 'gate', kind: 'gate', x: gx, y, w: gw, idx: i, state: null };
        this.gates.push(gate);
        S.push(gate, makeObj(col, gx - gw / 2, y, r), makeObj(col, gx + gw / 2, y, r));
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
    if (this.mode === 'race') {
      // rows of gifts across the course
      for (let y = START_Y + 520; y < len - 400; y += 1150 + Math.floor(r() * 300)) {
        this.giftRows.push(y);
        const off = Math.round((r() - 0.5) * 60);
        for (const gx of [-150, -75, 0, 75, 150]) {
          const g = makeObj('gift', gx + off, y, r, { respawn: 0 });
          S.push(g); this.gifts.push(g);
        }
      }
      // a few ramps on the racing line
      for (let y = START_Y + 900; y < len - 600; y += 1500 + Math.floor(r() * 900)) {
        if (this.giftRows.some(g => Math.abs(g - y) < 120)) continue;
        S.push(makeObj('ramp', Math.round((r() - 0.5) * 240), y, r));
      }
    }
  }
  addBanner(y, kind, text) {
    const hw = 64;
    this.statics.push({ id: OBJ_ID++, type: 'banner', kind: 'deco', x: 0, y, hw, banner: kind, text });
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
      if (y < START_Y + 120 && Math.abs(x) < 260) continue;
      const inCourseY = course && y < course.len + 300;
      const inCourse = inCourseY && Math.abs(x) < course.halfW + 14;
      if (inCourseY && !inCourse) {
        if (Math.abs(x) < course.halfW + 34) continue;
        if (!crowded(x, y, 14)) place(trees[Math.floor(r() * trees.length)], x, y);
        continue;
      }
      if (i >= tries) continue;
      if (crowded(x, y, 26)) continue;
      if (inCourse) {
        if (this.mode === 'gates') {
          if (r() < 0.25) this.mogulField(place, r, x, y, 2 + Math.floor(r() * 2));
          else if (r() < 0.15) place('pine_small', x, y);
          continue;
        }
        if (this.mode === 'race') {
          if (y < START_Y + 260) continue;
          if (this.giftRows.some(g => Math.abs(g - y) < 50)) continue;
          if (Math.abs(x) > course.halfW - 8) continue;
          const p = r();
          if (p < 0.13) place(r() < 0.6 ? 'pine_small' : 'pine_med', x, y);
          else if (p < 0.23) place('rock', x, y);
          else if (p < 0.27) place('stump', x, y);
          else if (p < 0.35) this.mogulField(place, r, x, y, 2);
          else if (p < 0.38) place('snowman', x, y);
          else if (p < 0.40) place('rock_big', x, y);
          else if (p < 0.44) place('ice', x, y, { rx: 26 + Math.floor(r() * 12), ry: 10 + Math.floor(r() * 4), seed: Math.floor(r() * 1e6) });
          else if (p < 0.48) place('powder', x, y, { rx: 28 + Math.floor(r() * 12), ry: 12 + Math.floor(r() * 4), seed: Math.floor(r() * 1e6) });
          continue;
        }
        const p = r();
        if (p < 0.22) this.mogulField(place, r, x, y, 3 + Math.floor(r() * 2));
        else if (p < 0.36) place('rock', x, y);
        else if (p < 0.42) place('snowman', x, y);
        else if (p < 0.52) place('pine_small', x, y);
        else if (p < 0.58) place('stump', x, y);
        else if (p < 0.62) place('powder', x, y, { rx: 30 + Math.floor(r() * 12), ry: 12 + Math.floor(r() * 4), seed: Math.floor(r() * 1e6) });
        continue;
      }
      const p = r();
      if (p < 0.40) place(trees[Math.floor(r() * trees.length)], x, y);
      else if (p < 0.47) place('rock', x, y);
      else if (p < 0.50) place('rock_big', x, y);
      else if (p < 0.55) place('stump', x, y);
      else if (p < 0.65) this.mogulField(place, r, x, y, 2 + Math.floor(r() * 3));
      else if (p < 0.69) place('ramp', x, y);
      else if (p < 0.72) place('snowman', x, y);
      else if (p < 0.75) place('ice', x, y, { rx: 26 + Math.floor(r() * 16), ry: 10 + Math.floor(r() * 5), seed: Math.floor(r() * 1e6) });
      else if (p < 0.78) place('powder', x, y, { rx: 32 + Math.floor(r() * 16), ry: 13 + Math.floor(r() * 5), seed: Math.floor(r() * 1e6) });
      else if (p < 0.80 && r() < 0.5) {
        for (let k = 0; k < 5; k++) { const tx = x + (r() - 0.5) * 70, ty = y + (r() - 0.5) * 50; if (!crowded(tx, ty, 14)) place(trees[Math.floor(r() * 5)], tx, ty); }
      }
    }
    return out;
  }
  mogulField(place, r, x, y, rows) {
    const cols = 2 + Math.floor(r() * 3);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const mx = x + (i - cols / 2) * 30 + (j % 2) * 15, my = y + j * 22;
      if (!(my < START_Y + 120 && Math.abs(mx) < 260)) place('mogul', mx + (r() - 0.5) * 4, my);
    }
  }
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
    for (const [k] of this.cells) { const cy = +k.split(',')[1]; if ((cy + 1) * CELL < camY - 900) this.cells.delete(k); }
  }
}

// ---- game state ----------------------------------------------------------------------------
let scene = 'title';
let overlay = null;
let menuSel = 0;
let game = null;
const titleWorld = new World('free', 777);
const titleCam = { x: 0, y: -40 };
const flakes = [];
for (let i = 0; i < 90; i++) flakes.push({ x: Math.random() * 2000, y: Math.random() * 1200, s: Math.random(), w: Math.random() * 6 });

function makeRacer(o) {
  return Object.assign({
    x: 0, y: 40, z: 0, vz: 0, vx: 0, vy: 0, dir: 0, heading: 0, speed: 0,
    state: 'ready', t: 0, stamina: 1, tucking: false, braking: false,
    spin: 0, flipT: -1, flips: 0, superT: 0, superHeld: false, airT: 0, ignore: null,
    tumbleRot: 0, crashSledAng: 0, crashSledOff: [0, 0], repeatT: 0, scootT: 0, onIce: false, inPowder: false,
    lastTrackX: null, isPlayer: false, ai: false, skin: 'player', name: 'YOU',
    item: null, itemCount: 0, roulette: 0, rouletteIdx: 0, itemHold: 0,
    waxT: 0, shieldT: 0, frozenT: 0, finishT: null, place: 1,
    aiT: 0, aiTarget: 0, aiHeading: 0, lane: 0, skill: 0.95, pace: 1, aiRest: false, aiSpin: 0, getUpAt: 1,
    near: [],
  }, o);
}

function newGame(mode) {
  const seed = (Math.random() * 1e9) | 0;
  const world = new World(mode, seed);
  const p = makeRacer({ isPlayer: true });
  const racers = [p];
  if (mode === 'race') {
    // starting grid: two rows of three behind the banner; you start in the back row
    const grid = [[-60, START_Y - 48], [0, START_Y - 48], [60, START_Y - 48], [-60, START_Y - 82], [60, START_Y - 82]];
    p.x = 0; p.y = START_Y - 82;
    const skills = [0.985, 0.97, 0.955, 0.94, 0.925].sort(() => Math.random() - 0.5);
    RIVALS.forEach((k, i) => {
      const s = skills[i];
      racers.push(makeRacer({
        ai: true, skin: k, name: SKINS[k].name, x: grid[i][0], y: grid[i][1],
        skill: s, pace: 0.955 + (s - 0.925) * 0.75, lane: grid[i][0], aiTarget: grid[i][0], getUpAt: 0.8 + Math.random() * 0.6,
      }));
    });
  }
  game = {
    mode, world, p, racers, seed,
    time: 0, started: false, score: 0, crashes: 0, bestTrick: '', bestTrickPts: 0,
    missed: 0, passed: 0, penalty: 0,
    cam: { x: p.x, y: p.y - H * 0.3, shake: 0, rx: 0, ry: 0 },
    particles: [], texts: [], tracks: [], npcs: [], npcT: 3,
    shots: [], hazards: [], flash: 0,
    plow: null,
    msg: null, paused: false, over: false, result: null, resultT: 0,
    countdown: mode === 'race' ? 3.6 : 0, startPress: null,
    smoke: [], vis: [],
  };
  scene = 'play';
  Snd.start();
}

// ---- particles / text ------------------------------------------------------------------------
function spray(x, y, n, vx, vy, spread = 40, col) {
  const P = game.particles;
  for (let i = 0; i < n; i++) {
    if (P.length > 700) P.shift();
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
function floatText(x, y, text, color = '#1b1b2b', sub) { game.texts.push({ x, y, text, sub, color, t: 0 }); }
function bigMsg(text, sub, dur = 2.2, color = '#d8333a') { game.msg = { text, sub, t: 0, dur, color }; }
// is this racer worth showing effects/sounds for?
function seen(r) {
  if (r.isPlayer) return true;
  const c = game.cam;
  return Math.abs(r.x - c.x) < W / 2 + 20 && r.y > c.y - 20 && r.y < c.y + H + 20;
}
function say(r, text, color, sub) { if (seen(r)) floatText(r.x, r.y - 26, text, color, sub); }
function sfx(r, name, ...a) { if (r.isPlayer || seen(r)) Snd[name](...a); }

// ---- racer physics ---------------------------------------------------------------------------------
function dirAngle(dir) { return rad(DIR_DEG[Math.abs(dir)]) * sign(dir); }
function racerBox(r) { return { x0: r.x - 4, x1: r.x + 4, y0: r.y - 1, y1: r.y + 7 }; }
function objBox(o) { return { x0: o.x - o.hw, x1: o.x + o.hw, y0: o.y - o.hh - o.yo, y1: o.y - o.yo }; }
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function popShield(r) {
  r.shieldT = 0;
  sfx(r, 'shieldPop');
  if (seen(r)) puff(r.x, r.y - 4, 14, 80, ['#cfeaf8', '#9fd0ee', '#ffffff']);
  say(r, 'BLOCKED!', '#3c9bd6');
}

function crash(r, o, kind, text) {
  if (r.shieldT > 0) {
    popShield(r);
    r.ignore = o; r.speed *= 0.6;
    if (r.state === 'air') { r.state = 'ride'; r.z = 0; r.vz = 0; r.speed = Math.hypot(r.vx, r.vy) * 0.6; }
    return;
  }
  r.ignore = o;
  if (r.isPlayer) { game.crashes++; game.cam.shake = 0.25; }
  if (o && o.type === 'snowman') {
    o.dead = true;
    game.world.cell(Math.floor(o.x / CELL), Math.floor(o.y / CELL)).push(makeObj('snowpile', o.x, o.y + 2));
    puff(o.x, o.y - 8, 26, 110);
    sfx(r, 'splat');
    say(r, 'SPLAT!');
  }
  if (kind === 'crash') {
    r.state = 'down'; r.t = 0; r.speed = 0; r.z = 0; r.vz = 0;
    r.crashSledAng = r.heading * 180 / Math.PI + 60 + Math.random() * 60;
    r.crashSledOff = [(Math.random() < 0.5 ? -1 : 1) * 11, 4];
    if (!o || o.type !== 'snowman') { sfx(r, 'crash'); say(r, text || ['OUCH!', 'BONK!', 'OOF!', 'THWACK!'][Math.floor(Math.random() * 4)]); }
    if (seen(r)) puff(r.x, r.y, 14, 60);
  } else {
    r.state = 'tumble'; r.t = 0; r.speed *= 0.65; r.z = 0; r.vz = 0;
    sfx(r, 'thud');
    say(r, text || ['WHOA!', 'YIKES!', 'OOPS!'][Math.floor(Math.random() * 3)], text === 'BAIL!' ? '#d8333a' : undefined);
    if (seen(r)) puff(r.x, r.y, 10, 50);
  }
  r.spin = 0; r.flipT = -1; r.superT = 0; r.superHeld = false; r.aiSpin = 0;
  r.lastTrackX = null;
}

function launch(r, vz, kind) {
  r.state = 'air'; r.vz = vz; r.z = 0.5; r.airT = 0;
  r.vx = Math.sin(r.heading) * r.speed; r.vy = Math.cos(r.heading) * r.speed;
  r.spin = 0; r.flipT = -1; r.flips = 0; r.superT = 0;
  r.lastTrackX = null;
  if (kind === 'ramp') {
    sfx(r, 'jump'); if (seen(r)) spray(r.x, r.y + 6, 12, 0, r.speed * 0.4, 60);
    // rivals show off a 360 now and then
    if (r.ai && vz > 280 && Math.random() < 0.55) r.aiSpin = (Math.random() < 0.5 ? -1 : 1) * 360;
  } else if (kind === 'hop') sfx(r, 'hop');
  else sfx(r, 'land');
}

function land(r) {
  r.z = 0; r.vz = 0;
  const spinDeg = Math.abs(r.spin);
  const spinRem = ((r.spin % 360) + 360) % 360;
  const spinOk = spinRem < 40 || spinRem > 320;
  const flipOk = r.flipT < 0;
  const superOk = !r.superHeld || r.superT < 0.05;
  r.superHeld = false;
  if (!spinOk || !flipOk || !superOk) {
    const why = !spinOk ? 'SIDEWAYS!' : !flipOk ? 'HEAD PLANT!' : 'LET GO!';
    const sh = r.shieldT;
    crash(r, null, 'trip', 'BAIL!');
    if (!sh && r.isPlayer) game.texts[game.texts.length - 1].sub = why;
    return;
  }
  r.state = 'ride';
  r.speed = Math.hypot(r.vx, r.vy);
  if (seen(r)) spray(r.x, r.y + 4, 10, 0, 0, 90);
  if (!r.isPlayer) { if (r.aiSpin) say(r, '360!', SKINS[r.skin].coatD); r.spin = 0; r.aiSpin = 0; sfx(r, 'land'); return; }
  const parts = [];
  let pts = 0, types = 0;
  const spins = Math.floor((spinDeg + 40) / 360);
  if (spins > 0) { parts.push(spins * 360 + ' SPIN'); pts += 100 * spins * spins + 50 * spins; types++; }
  if (r.flips > 0) { parts.push(r.flips === 1 ? 'FRONT FLIP' : r.flips === 2 ? 'DOUBLE FLIP' : r.flips + 'X FLIP'); pts += 250 * r.flips * r.flips; types++; }
  if (r.superT >= 0.2) { parts.push('SUPERMAN'); pts += Math.round(60 + r.superT * 320); types++; }
  if (types === 0 && r.airT > 0.7) { parts.push('BIG AIR'); pts += Math.round(r.airT * 40); }
  if (types > 1) { parts.push('COMBO X' + types); pts *= types; }
  if (pts > 0) {
    pts = Math.round(pts / 10) * 10;
    game.score += pts;
    const label = parts.join(' + ');
    floatText(r.x, r.y - 30, '+' + pts, types ? '#2f5fd0' : '#1b1b2b', label);
    if (pts > game.bestTrickPts) { game.bestTrickPts = pts; game.bestTrick = label; }
    // in a race, landed tricks give a little burst of speed
    if (game.mode === 'race' && types) { r.waxT = Math.max(r.waxT, 0.4 + 0.3 * types); }
    if (types) Snd.trick(types); else Snd.land();
  } else Snd.land();
  r.spin = 0; r.flipT = -1; r.flips = 0; r.superT = 0;
}

function addTrack(r) {
  if (r.speed < 2 && r.state !== 'ride') return;
  const tr = game.tracks;
  const px = Math.cos(r.heading), py = -Math.sin(r.heading);
  const lx = Math.round(r.x - px * 4), ly = Math.round(r.y + 2 - py * 4), rx = Math.round(r.x + px * 4), ry = Math.round(r.y + 2 + py * 4);
  if (r.lastTrackX === null) { r.lastTrackX = [lx, ly, rx, ry]; return; }
  const [a, b, c, d] = r.lastTrackX;
  if (Math.abs(lx - a) + Math.abs(ly - b) < 3) return;
  tr.push(a, b, lx, ly, c, d, rx, ry);
  r.lastTrackX = [lx, ly, rx, ry];
  if (tr.length > 8 * 3600) tr.splice(0, 8 * 600);
}

function collideRacer(r, inAir) {
  const rb = racerBox(r);
  let stillTouchingIgnored = false;
  for (const o of r.near) {
    if (o.kind === 'zone' || o.kind === 'deco' || o.kind === 'gate' || o.dead) continue;
    if (!overlap(rb, objBox(o))) continue;
    if (o.kind === 'item') { if (!o.hidden && r.z < 26) grabGift(r, o); continue; }
    if (o === r.ignore) { stillTouchingIgnored = true; continue; }
    if (inAir) {
      if (o.kind === 'bump' || o.kind === 'ramp') continue;
      if (r.z < o.h) { crash(r, o, o.kind === 'trip' && r.z < o.h * 0.6 ? 'trip' : 'crash'); return; }
      continue;
    }
    if (o.kind === 'ramp') {
      if (r.speed > 50) { launch(r, clamp(110 + r.speed * 0.95, 150, 430), 'ramp'); r.ignore = o; return; }
      continue;
    }
    if (o.kind === 'bump') {
      if (r.speed > 95) { launch(r, 55 + r.speed * 0.25, 'bump'); r.ignore = o; return; }
      r.speed *= 0.995;
      continue;
    }
    crash(r, o, o.kind);
    return;
  }
  if (!stillTouchingIgnored) r.ignore = null;
}

// Player input -> the generic control record every racer is driven by
function playerControl(p) {
  const c = {
    stepL: pressed.has('left'), stepR: pressed.has('right'), holdL: !!keys.left, holdR: !!keys.right,
    straight: pressed.has('down'), brake: !!keys.up, hop: pressed.has('hop') || (pressed.has('tap') && pointer.touch) || (pressed.has('pdown') && !pointer.touch),
    tuck: !!keys.tuck, spin: (keys.left ? -1 : 0) + (keys.right ? 1 : 0), flip: pressed.has('down'), superman: !!keys.up,
    getUp: ['left', 'right', 'down', 'hop', 'up', 'tap'].some(k => pressed.has(k)), wantDir: null, item: pressed.has('item'),
  };
  if (pointer.active && (!pointer.touch || pointer.down)) {
    const sx = p.x - game.cam.rx, sy = p.y - p.z - game.cam.ry;
    const dx = pointer.x - sx, dy = pointer.y - sy;
    if (Math.hypot(dx, dy) > 6) {
      if (dy < 0) c.wantDir = 3 * sign(dx);
      else {
        const ang = Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
        let best = 0;
        for (let i = 1; i < 4; i++) if (Math.abs(DIR_DEG[i] - ang) < Math.abs(DIR_DEG[best] - ang)) best = i;
        c.wantDir = best * sign(dx);
      }
      if (pointer.down) c.spin = sign(dx) || c.spin;
    }
    if (pointer.down && c.wantDir !== null && Math.abs(c.wantDir) === 3) c.brake = true;
  }
  return c;
}

function updateRacer(r, dt, c) {
  r.t += dt;
  r.waxT = Math.max(0, r.waxT - dt);
  r.shieldT = Math.max(0, r.shieldT - dt);
  r.frozenT = Math.max(0, r.frozenT - dt);
  if (r.state === 'ready') return;
  if (r.state === 'finished') {
    r.speed = Math.max(0, r.speed - 260 * dt);
    r.heading += (0 - r.heading) * Math.min(1, dt * 4);
    r.x += Math.sin(r.heading) * r.speed * dt; r.y += Math.cos(r.heading) * r.speed * dt;
    if (r.speed > 20 && seen(r)) spray(r.x, r.y + 6, 1, 0, 0, 60);
    addTrack(r);
    return;
  }
  if (r.state === 'plowed') return;
  if (r.state === 'down') {
    if ((r.t > 0.55 && c.getUp) || r.t > (r.ai ? r.getUpAt : 2.4)) {
      r.state = 'ride'; r.dir = 0; r.heading = 0; r.speed = 0;
      if (c.stepL) r.dir = -1; if (c.stepR) r.dir = 1;
    }
    return;
  }
  if (r.state === 'tumble') {
    r.speed = Math.max(0, r.speed - 330 * dt);
    r.tumbleRot += dt * 900;
    r.x += Math.sin(r.heading) * r.speed * dt; r.y += Math.cos(r.heading) * r.speed * dt;
    if (Math.random() < 0.5 && seen(r)) spray(r.x, r.y + 4, 1, 0, 0, 50);
    if (r.t > 0.75) { r.state = 'down'; r.t = 0.35; r.crashSledAng = r.heading * 180 / Math.PI + 90; r.crashSledOff = [10, 5]; }
    return;
  }

  if (r.state === 'ride') {
    if (!r.ai) {
      if (c.stepL || c.stepR) r.repeatT = 0.24;
      else if (c.holdL || c.holdR) r.repeatT -= dt;
      const stepDir = s => {
        if (s < 0 ? r.dir > -3 : r.dir < 3) r.dir += s;
        else if (r.speed < 30) { r.x += s * 7; r.scootT = 0.18; spray(r.x - s * 6, r.y + 4, 3, -s * 40, 0, 20); }
      };
      if (c.stepL) stepDir(-1);
      if (c.stepR) stepDir(1);
      if (r.repeatT <= 0 && (c.holdL || c.holdR)) { r.repeatT = 0.12; stepDir(c.holdL ? -1 : 1); }
      if (c.straight) r.dir = 0;
      if (c.wantDir !== null && !r.onIce) r.dir = c.wantDir;
    }
    // surfaces
    r.onIce = false; r.inPowder = false;
    for (const o of r.near) {
      if (o.kind !== 'zone') continue;
      const nx = (r.x - o.x) / (o.rx * 0.85), ny = (r.y + 4 - o.y) / (o.ry * 0.85);
      if (nx * nx + ny * ny < 1) { if (o.type === 'ice') r.onIce = true; else r.inPowder = true; }
    }
    const target = r.ai ? r.aiHeading : dirAngle(r.dir);
    if (!r.onIce) r.heading += clamp(target - r.heading, -(r.frozenT > 0 ? 3 : 9) * dt, (r.frozenT > 0 ? 3 : 9) * dt);
    r.tucking = c.tuck && r.stamina > 0.02 && Math.abs(r.dir) < 3 && r.waxT <= 0;
    if (r.tucking) r.stamina = Math.max(0, r.stamina - dt / 2.8);
    else r.stamina = Math.min(1, r.stamina + dt / 9);
    r.braking = c.brake && !r.onIce;

    const cs = Math.max(0, Math.cos(r.heading));
    const powder = r.inPowder && r.waxT <= 0;
    let mult = r.waxT > 0 ? WAX_MULT : r.tucking ? TUCK_MULT : 1;
    if (r.ai) mult *= r.pace * c.rubber;
    let vt = VMAX * Math.pow(cs, 0.8) * mult * (r.onIce ? 1.12 : 1) * (powder ? 0.55 : 1) * (r.frozenT > 0 ? 0.45 : 1);
    if (Math.abs(r.dir) === 3 && !r.onIce) {
      r.speed = Math.max(0, r.speed - 430 * dt);
      if (r.speed > 25) spray(r.x + Math.sin(r.heading) * 4, r.y + 6, 2, -Math.sin(r.heading) * 40, 60, 40);
    } else if (r.speed < vt) {
      r.speed = Math.min(vt, r.speed + (r.waxT > 0 ? 600 : 230) * Math.max(0.3, cs) * (powder ? 0.5 : 1) * dt);
    } else {
      r.speed = Math.max(vt, r.speed - (powder ? 420 : r.frozenT > 0 ? 500 : 110) * dt);
    }
    if (r.braking) {
      r.speed = Math.max(0, r.speed - 360 * dt);
      if (r.speed > 15) { spray(r.x - 5, r.y - 8, 1, -30, -20, 30); spray(r.x + 5, r.y - 8, 1, 30, -20, 30); }
    }
    if (seen(r)) {
      if (powder && r.speed > 40 && Math.random() < 0.4) spray(r.x, r.y + 8, 1, 0, 10, 50);
      if (r.onIce && r.speed > 60 && Math.random() < 0.15) spray(r.x, r.y + 6, 1, 0, 0, 20, '#ffffff');
      if (Math.abs(target - r.heading) > 0.15 && r.speed > 80) spray(r.x, r.y + 6, 1, -Math.cos(r.heading) * 60 * sign(target - r.heading), 0, 30);
      if (r.waxT > 0 && Math.random() < 0.7) spray(r.x + (Math.random() - 0.5) * 6, r.y - 10, 1, 0, -40, 30, Math.random() < 0.5 ? '#ffd76a' : '#ff8a1f');
    }
    r.x += Math.sin(r.heading) * r.speed * dt;
    r.y += Math.cos(r.heading) * r.speed * dt;
    r.scootT = Math.max(0, r.scootT - dt);
    addTrack(r);
    if (c.hop) launch(r, 135, 'hop');
    else collideRacer(r, false);
    return;
  }

  if (r.state === 'air') {
    r.airT += dt;
    r.z += r.vz * dt; r.vz -= GRAV * dt;
    r.x += r.vx * dt; r.y += r.vy * dt;
    if (r.ai) {
      if (r.aiSpin) { const st = sign(r.aiSpin) * 720 * dt; if (Math.abs(r.spin + st) >= Math.abs(r.aiSpin)) { r.spin = r.aiSpin; } else r.spin += st; }
    } else {
      r.spin += c.spin * 720 * dt;
      if (c.flip && r.flipT < 0) r.flipT = 0;
      if (r.flipT >= 0) { r.flipT += dt / 0.55; if (r.flipT >= 1) { r.flipT = -1; r.flips++; } }
      if (c.superman) { r.superT += dt; r.superHeld = true; } else r.superHeld = false;
    }
    r.stamina = Math.min(1, r.stamina + dt / 9);
    if (r.z <= 0 && r.vz < 0) { land(r); return; }
    collideRacer(r, true);
  }
}

// ---- computer rivals ------------------------------------------------------------------------------------
function aiControl(r, dt) {
  const g = game, p = g.p, halfW = g.world.course.halfW;
  const c = { tuck: false, hop: false, brake: false, getUp: false, rubber: 1, item: false };
  // rubber band: rivals far ahead of you ease off, rivals far behind push harder
  if (!p.finishT) {
    const gap = r.y - p.y;
    c.rubber = 1 + clamp(-gap / 2200, -0.07, 0.09);
  }
  if (r.state !== 'ride') return c;
  r.aiT -= dt;
  if (r.aiT <= 0) {
    r.aiT = 0.07 + Math.random() * 0.06;
    const look = 140 + r.speed * 0.4;
    const objs = [];
    g.world.query(r.x - 140, r.y, r.x + 140, r.y + look, objs);
    if (Math.random() < 0.02) r.lane = clamp(r.lane + (Math.random() - 0.5) * 160, -150, 150);
    const sloppy = Math.random() > r.skill;   // a lapse: this decision ignores obstacles
    let best = r.aiTarget, bestCost = Infinity;
    for (let off = -120; off <= 120; off += 15) {
      const tx = clamp(r.x + off, -halfW + 24, halfW - 24);
      let cost = Math.abs(tx - r.lane) * 0.025 + Math.abs(off) * 0.03 + Math.abs(tx - r.aiTarget) * 0.01;
      if (!sloppy) for (const o of objs) {
        const ahead = o.y - r.y;
        if (ahead < 2) continue;
        const f = ahead / look;
        if (f > 1) continue;
        const lx = r.x + (tx - r.x) * Math.min(1, ahead / (look * 0.55));
        const d = Math.abs(o.x - lx);
        if (o.kind === 'crash' || o.kind === 'trip') { if (d < o.hw + 9) cost += (o.kind === 'crash' ? 140 : 70) * (1.3 - f); }
        else if (o.kind === 'ramp') { if (d < o.hw - 2) cost -= 14; }
        else if (o.kind === 'item') { if (!o.hidden && !r.item && !r.roulette && d < 9) cost -= 22; }
        else if (o.kind === 'zone') { if (Math.abs(o.x - lx) < o.rx * 0.8 && ahead < look * 0.7) cost += o.type === 'powder' ? 26 : 3; }
      }
      if (!sloppy) for (const h of g.hazards) if (h.y > r.y && h.y < r.y + look && Math.abs(h.x - tx) < 18) cost += 60;
      // don't ride straight into the back of another sledder
      for (const o of g.racers) if (o !== r && o.y > r.y && o.y < r.y + 40 && Math.abs(o.x - tx) < 10) cost += 15;
      if (cost < bestCost) { bestCost = cost; best = tx; }
    }
    r.aiTarget = best;
  }
  r.aiHeading = clamp(Math.atan2(r.aiTarget - r.x, 85), -0.95, 0.95);
  // tuck on straights, saving some stamina
  if (r.stamina < 0.1) r.aiRest = true;
  if (r.stamina > 0.7) r.aiRest = false;
  c.tuck = !r.aiRest && Math.abs(r.heading) < 0.3 && r.frozenT <= 0;
  // items
  if (r.item && r.roulette <= 0) {
    r.itemHold += dt;
    const it = r.item;
    const ahead = g.racers.some(o => o !== r && o.y > r.y + 30 && o.y < r.y + 380 && Math.abs(o.x - r.x) < 140 && !o.finishT);
    const behind = g.racers.some(o => o !== r && o.y < r.y - 20 && o.y > r.y - 240 && Math.abs(o.x - r.x) < 60);
    if (it === 'wax' && r.itemHold > 0.4 && Math.abs(r.heading) < 0.4) c.item = true;
    else if (it === 'blizzard' && r.itemHold > 0.8) c.item = true;
    else if (it === 'shield' && r.itemHold > 1.2) c.item = true;
    else if ((it === 'snowball' || it === 'snowball3') && ((ahead && r.itemHold > 0.5) || r.itemHold > 7)) { c.item = true; r.itemHold = it === 'snowball3' ? 0.2 : 0; }
    else if (it === 'slush' && ((behind && r.itemHold > 0.5) || r.itemHold > 9)) c.item = true;
  }
  return c;
}

// ---- items ----------------------------------------------------------------------------------------------
function rollItem(r) {
  const n = game.racers.length;
  const f = n > 1 ? (r.place - 1) / (n - 1) : 0; // 0 = leader, 1 = last
  let total = 0;
  const w = {};
  for (const k in ITEM_ODDS) { w[k] = ITEM_ODDS[k][0] * (1 - f) + ITEM_ODDS[k][1] * f; total += w[k]; }
  let x = Math.random() * total;
  for (const k in w) { x -= w[k]; if (x <= 0) return k; }
  return 'snowball';
}
function grabGift(r, o) {
  o.hidden = true; o.respawn = 3;
  if (seen(r)) puff(o.x, o.y - 6, 16, 90, ['#d8333a', '#f6c431', '#3fa34d', '#2f5fd0', '#ffffff']);
  sfx(r, 'pop');
  if (r.item || r.roulette > 0) return;
  r.roulette = r.isPlayer ? 1.1 : 0.6;
  r.rouletteIdx = 0;
}
function useItem(r) {
  const it = r.item;
  if (!it || r.roulette > 0) return;
  const g = game;
  const consume = () => { if (it === 'snowball3' && --r.itemCount > 0) return; r.item = null; r.itemCount = 0; r.itemHold = 0; };
  if (it === 'snowball' || it === 'snowball3') {
    // target: nearest rival ahead within range
    let target = null, bd = Infinity;
    for (const o of g.racers) {
      if (o === r || o.finishT) continue;
      const dy = o.y - r.y, dx = Math.abs(o.x - r.x);
      if (dy > 10 && dy < 480 && dx < 220 && dy + dx < bd) { bd = dy + dx; target = o; }
    }
    const sp = Math.max(r.speed, 120) + 230;
    const h = target ? Math.atan2(target.x - r.x, target.y - r.y) : r.heading;
    g.shots.push({ x: r.x, y: r.y + 6, vx: Math.sin(h) * sp, vy: Math.cos(h) * sp, sp, owner: r, target, t: 0 });
    sfx(r, 'toss');
  } else if (it === 'slush') {
    g.hazards.push({ x: r.x - Math.sin(r.heading) * 16, y: r.y - Math.cos(r.heading) * 16, t: 0, owner: r });
    sfx(r, 'slurp');
    say(r, 'SLUSH!', '#7b93ab');
  } else if (it === 'wax') {
    r.waxT = 2.6; sfx(r, 'boost'); say(r, 'TURBO WAX!', '#ff8a1f');
  } else if (it === 'shield') {
    r.shieldT = 10; sfx(r, 'shield'); say(r, 'SNOW GLOBE!', '#3c9bd6');
  } else if (it === 'blizzard') {
    let hit = 0;
    for (const o of g.racers) {
      if (o === r || o.place >= r.place || o.finishT) continue;
      if (o.shieldT > 0) { popShield(o); continue; }
      o.frozenT = 2.8; hit++;
      if (o.isPlayer) { g.flash = 0.5; bigMsg('BLIZZARD!', r.name + ' SENT A STORM', 1.6, '#3c9bd6'); }
    }
    Snd.blizzard();
    if (r.isPlayer) { g.flash = 0.35; bigMsg('BLIZZARD!', hit ? hit + ' RIVAL' + (hit > 1 ? 'S' : '') + ' SNOWED IN' : 'NOBODY AHEAD!', 1.6, '#3c9bd6'); }
  }
  consume();
}
function hitRacer(r, cause, by) {
  if (r.finishT || r.state === 'down' || r.state === 'tumble' || r.state === 'plowed') return false;
  if (r.shieldT > 0) { popShield(r); return true; }
  crash(r, null, 'trip', cause === 'snowball' ? 'SPLAT!' : 'SLIPPED!');
  if (r.isPlayer && by) game.texts[game.texts.length - 1].sub = 'FROM ' + by.name;
  if (by && by.isPlayer && !r.isPlayer) floatText(r.x, r.y - 36, 'HIT ' + r.name + '!', '#2a7535');
  return true;
}
function updateItems(dt) {
  const g = game;
  for (const r of g.racers) {
    if (r.roulette > 0) {
      r.roulette -= dt;
      const idx = Math.floor(r.roulette * 14);
      if (idx !== r.rouletteIdx) { r.rouletteIdx = idx; if (r.isPlayer) Snd.tick(); }
      if (r.roulette <= 0) {
        r.roulette = 0; r.item = rollItem(r); r.itemCount = r.item === 'snowball3' ? 3 : 1; r.itemHold = 0;
        if (r.isPlayer) { Snd.getItem(); floatText(r.x, r.y - 30, ITEMS[r.item].name, '#2f5fd0'); }
      }
    }
  }
  // gifts respawn
  for (const o of g.world.gifts) if (o.hidden) { o.respawn -= dt; if (o.respawn <= 0) o.hidden = false; }
  // snowballs
  for (const s of g.shots) {
    s.t += dt;
    if (s.target && !s.target.finishT && s.target.y > s.y - 10) {
      const want = Math.atan2(s.target.x - s.x, s.target.y - s.y), cur = Math.atan2(s.vx, s.vy);
      let d = want - cur; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const nh = cur + clamp(d, -3.2 * dt, 3.2 * dt);
      s.vx = Math.sin(nh) * s.sp; s.vy = Math.cos(nh) * s.sp;
    }
    s.x += s.vx * dt; s.y += s.vy * dt;
    if (Math.random() < 0.5) g.particles.push({ x: s.x, y: s.y, z: 5, vx: 0, vy: 0, vz: 0, life: 0.25, t: 0, c: '#e7eff9' });
    const sb = { x0: s.x - 3, x1: s.x + 3, y0: s.y - 3, y1: s.y + 3 };
    for (const r of g.racers) {
      if ((r === s.owner && s.t < 0.5) || r.z > 18) continue;
      if (overlap(sb, { x0: r.x - 6, x1: r.x + 6, y0: r.y - 8, y1: r.y + 8 })) {
        hitRacer(r, 'snowball', s.owner); s.dead = true;
        if (seen(r)) { puff(s.x, s.y, 14, 70); Snd.splat(); }
        break;
      }
    }
    if (s.dead) continue;
    const hits = [];
    g.world.query(s.x - 8, s.y - 4, s.x + 8, s.y + 8, hits);
    for (const o of hits) if ((o.kind === 'crash') && overlap(sb, objBox(o))) { s.dead = true; puff(s.x, s.y, 8, 50); break; }
    if (s.t > 2.4) { s.dead = true; puff(s.x, s.y, 6, 30); }
  }
  g.shots = g.shots.filter(s => !s.dead);
  // slush puddles
  for (const h of g.hazards) {
    h.t += dt;
    for (const r of g.racers) {
      if (r.z > 2 || (r === h.owner && h.t < 0.6)) continue;
      if (Math.abs(r.x - h.x) < 12 && Math.abs(r.y + 4 - h.y) < 6) {
        if (hitRacer(r, 'slush', h.owner)) { h.dead = true; if (seen(r)) { Snd.slurp(); puff(h.x, h.y, 10, 50, ['#a7bccf', '#7b93ab', '#ffffff']); } break; }
      }
    }
  }
  g.hazards = g.hazards.filter(h => !h.dead && h.t < 30);
  // racers jostle each other
  const R = g.racers;
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    const a = R[i], b = R[j];
    if (a.state !== 'ride' || b.state !== 'ride') continue;
    const dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) < 9 && Math.abs(dy) < 12) {
      const push = (9 - Math.abs(dx)) / 2 * (sign(dx) || 1);
      a.x -= push; b.x += push;
      a.speed *= 0.985; b.speed *= 0.985;
      if ((a.isPlayer || b.isPlayer) && Math.random() < 0.1) { Snd.thud(); spray((a.x + b.x) / 2, (a.y + b.y) / 2 + 4, 4, 0, 0, 60); }
    }
  }
}

// ---- course: gates, finish line, standings ------------------------------------------------------------
function updateCourse(prevYs) {
  const g = game, w = g.world;
  const p = g.p;
  if (!g.started && p.y >= START_Y && g.mode !== 'race') g.started = true;
  if (w.gates) {
    const prevY = prevYs[0];
    for (const gt of w.gates) {
      if (gt.state || !(prevY < gt.y && p.y >= gt.y)) continue;
      if (Math.abs(p.x - gt.x) < gt.w / 2) { gt.state = 'pass'; g.passed++; Snd.gate(); floatText(gt.x, gt.y - 24, 'GATE ' + (gt.idx + 1), '#2a7535'); }
      else { gt.state = 'miss'; g.missed++; g.penalty += 5; Snd.miss(); floatText(p.x, p.y - 26, 'MISSED +5', '#d8333a'); }
    }
  }
  if (!w.course) return;
  const len = w.course.len;
  g.racers.forEach((r, i) => {
    if (r.finishT !== null || !(prevYs[i] < len && r.y >= len)) return;
    r.finishT = g.time;
    if (r.state === 'air') land(r);
    if (r.state !== 'down' && r.state !== 'tumble') r.state = 'finished';
    if (!r.isPlayer) { if (seen(r)) floatText(r.x, r.y - 26, r.name + ' ' + ordinal(g.racers.filter(o => o.finishT !== null).length), SKINS[r.skin].coatD); return; }
    // the player crossed the line
    if (w.gates) for (const gt of w.gates) if (!gt.state) { gt.state = 'miss'; g.missed++; g.penalty += 5; }
    g.result = { mode: g.mode, time: g.time, total: g.time + g.penalty, score: g.score };
    Snd.finish();
    let rec = false;
    if (g.mode === 'gates') { if (!BEST.gates || g.result.total < BEST.gates) { BEST.gates = +g.result.total.toFixed(2); rec = true; } }
    else if (g.mode === 'bigair') { if (g.score > BEST.bigair) { BEST.bigair = g.score; rec = true; } }
    else if (g.mode === 'race') {
      const place = g.racers.filter(o => o.finishT !== null).length;
      g.result.place = place;
      if (place === 1) BEST.raceWins = (BEST.raceWins || 0) + 1;
      if (!BEST.racePlace || place < BEST.racePlace || (place === BEST.racePlace && g.time < BEST.raceTime)) { BEST.racePlace = place; BEST.raceTime = +g.time.toFixed(2); rec = true; }
    }
    g.result.record = rec;
    saveBest();
    if (g.mode === 'race') bigMsg(g.result.place === 1 ? 'YOU WIN!' : ordinal(g.result.place) + ' PLACE', null, 2.0, g.result.place === 1 ? '#2a7535' : g.result.place <= 3 ? '#2f5fd0' : '#d8333a');
    else bigMsg('FINISH!', null, 1.6, '#2a7535');
  });
  // standings: finishers by time, then everyone else by distance
  const order = g.racers.slice().sort((a, b) => {
    if (a.finishT !== null && b.finishT !== null) return a.finishT - b.finishT;
    if (a.finishT !== null) return -1;
    if (b.finishT !== null) return 1;
    return b.y - a.y;
  });
  order.forEach((r, i) => { r.place = i + 1; });
  g.order = order;
}

// ---- NPCs (free run / big air) -------------------------------------------------------------------------
function spawnNPC() {
  const p = game.p, cam = game.cam;
  const r = Math.random();
  const below = cam.y + H + 40;
  if (r < 0.4) game.npcs.push({ type: 'dog', x: p.x + (Math.random() - 0.5) * W * 0.9, y: below + Math.random() * 120, vx: 0, vy: 0, face: 1, state: 'wander', t: 0, cool: 0, wt: 0 });
  else if (r < 0.72) game.npcs.push({ type: 'saucer', x: p.x + (Math.random() - 0.5) * W * 0.8, y: below, vy: 95 + Math.random() * 40, vx: 0, rot: Math.random() * 360, rs: (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 120), t: 0, wob: Math.random() * 6, state: 'ride' });
  else {
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
  if (game.mode !== 'gates' && game.mode !== 'race' && p.state !== 'ready') {
    game.npcT -= dt;
    if (game.npcT <= 0) { game.npcT = 2.2 + Math.random() * 3.5; if (game.npcs.length < 6 && p.speed > 40) spawnNPC(); }
  }
  const pb = racerBox(p);
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
        n.vx = dx / (d || 1) * 215; n.vy = dy / (d || 1) * 215;
        if (n.t > 2.6 || p.state === 'down') { n.state = 'sit'; n.t = 0; n.vx = 0; n.vy = 0; n.cool = 4; }
        if (Math.random() < dt * 1.2) { Snd.bark(); floatText(n.x, n.y - 16, 'WOOF!', '#5e3517'); }
      } else if (n.state === 'sit') {
        n.vx = 0; n.vy = 0;
        if (n.t > 2.5) { n.state = 'wander'; n.t = 0; }
      }
      if (Math.abs(n.vx) > 2) n.face = sign(n.vx);
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (p.state === 'ride' && n.state === 'chase' && overlap(pb, npcBox(n))) {
        crash(p, null, 'trip', 'BAD DOG!');
        Snd.bark(); n.state = 'sit'; n.t = 0; n.cool = 5;
      }
    } else if (n.type === 'saucer') {
      if (n.state === 'ride') {
        n.rot += n.rs * dt;
        n.vx = Math.sin(n.t * 1.3 + n.wob) * 26;
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (Math.random() < 0.2) spray(n.x, n.y + 6, 1, 0, 0, 30);
        const hits = [];
        game.world.query(n.x - 10, n.y - 10, n.x + 10, n.y + 14, hits);
        for (const o of hits) if (o.kind === 'crash' && overlap(npcBox(n), objBox(o))) { n.state = 'spill'; n.t = 0; Snd.thud(); puff(n.x, n.y, 8, 40); break; }
        if ((p.state === 'ride' || (p.state === 'air' && p.z < 10)) && overlap(pb, npcBox(n))) { crash(p, null, 'crash', 'SORRY!'); n.state = 'spill'; n.t = 0; }
      } else { n.vy = Math.max(0, n.vy - 200 * dt); n.y += n.vy * dt; n.rot += n.rs * dt * Math.max(0, 1 - n.t); }
    } else if (n.type === 'xc') {
      n.x += n.vx * dt; n.y += n.vy * dt;
      if (p.state === 'ride' && overlap(pb, npcBox(n))) { crash(p, null, 'trip', 'FORE!'); n.vx *= -1; }
    }
  }
  const cy = game.cam.y;
  game.npcs = game.npcs.filter(n => n.y > cy - 260 && n.y < cy + H + 600 && Math.abs(n.x - p.x) < W * 1.5);
}

// ---- the plow (free run) -------------------------------------------------------------------------------
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
  if (pl.y < game.cam.y - 420) pl.y = game.cam.y - 420;
  const hits = [];
  game.world.query(pl.x - 30, pl.y - 20, pl.x + 30, pl.y + 10, hits);
  for (const o of hits) {
    if (o.kind === 'zone' || o.kind === 'gate' || o.type === 'banner' || o.type === 'lodge' || o.kind === 'deco') continue;
    if (Math.abs(o.x - pl.x) < 26 && Math.abs(o.y - pl.y) < 10) { o.dead = true; puff(o.x, o.y - 6, 12, 90, o.type.startsWith('pine') ? ['#ffffff', '#2f8a4e', '#1d5b36'] : undefined); }
  }
  for (const n of game.npcs) if (Math.abs(n.x - pl.x) < 26 && Math.abs(n.y - pl.y) < 10) { puff(n.x, n.y, 4); n.y = -1e9; }
  spray(pl.x + (Math.random() - 0.5) * 44, pl.y + 2, 2, (Math.random() - 0.5) * 120, Math.max(30, pl.vy * 0.6), 60);
  if (p.state !== 'plowed' && Math.abs(p.x - pl.x) < 22 && p.y + 4 > pl.y - 12 && p.y + 4 < pl.y + 8 && p.z < 24) {
    p.state = 'plowed'; pl.caughtT = 0; p.speed = 0;
    Snd.gulp(); Snd.horn();
    game.cam.shake = 0.4;
    floatText(p.x, p.y - 30, 'NOOOO!', '#d8333a');
  }
}

// ---- race countdown --------------------------------------------------------------------------------------
function updateCountdown(dt) {
  const g = game;
  const before = Math.ceil(g.countdown - 0.6);
  g.countdown -= dt;
  const after = Math.ceil(g.countdown - 0.6);
  // a well-timed push (tuck or down in the last half second) earns a rocket start; too early stalls
  if ((pressed.has('down') || pressed.has('tuck')) && g.startPress === null && g.countdown < 3.0) g.startPress = g.countdown - 0.6;
  if (after !== before && after >= 1) Snd.beep(false);
  if (g.countdown <= 0.6 && !g.started) {
    g.started = true;
    Snd.beep(true);
    for (const r of g.racers) {
      r.state = 'ride';
      if (r.ai && Math.random() < r.skill - 0.3) r.waxT = 0.5;
    }
    const sp = g.startPress;
    if (sp !== null && sp <= 0.5 && sp >= 0) { g.p.waxT = 1.1; floatText(g.p.x, g.p.y - 30, 'ROCKET START!', '#ff8a1f'); Snd.boost(); }
    else if (sp !== null && sp > 1.0) { g.p.state = 'down'; g.p.t = 1.9; floatText(g.p.x, g.p.y - 30, 'TOO EARLY!', '#d8333a'); }
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
  const prevYs = g.racers.map(r => r.y);
  if (g.mode === 'race' && !g.started) updateCountdown(dt);

  for (const r of g.racers) {
    if (!r.isPlayer && !seen(r) && Math.abs(r.y - p.y) > 2500) { /* far rivals still simulate, but cheaply */ }
    r.near.length = 0;
    g.world.query(r.x - 60, r.y - 60, r.x + 60, r.y + (r.ai ? 70 : 60), r.near);
  }
  g.vis = p.near;

  // player
  let pc = playerControl(p);
  if (p.state === 'ready' && g.mode !== 'race') {
    const go = pc.straight || pc.hop || pc.stepL || pc.stepR || pressed.has('tap') || (pointer.active && pointer.down);
    if (go) { p.state = 'ride'; if (pc.stepL) p.dir = -1; if (pc.stepR) p.dir = 1; g.started = true; pc = Object.assign(pc, { hop: false }); }
  }
  if (p.finishT !== null) pc = { holdL: false, holdR: false, spin: 0, wantDir: null };
  updateRacer(p, dt, pc);
  if (pc.item) useItem(p);
  // rivals
  for (const r of g.racers) {
    if (!r.ai) continue;
    const c = aiControl(r, dt);
    updateRacer(r, dt, c);
    if (c.item) useItem(r);
  }
  if (g.mode === 'race') updateItems(dt);
  updateCourse(prevYs);
  updateNPCs(dt);
  updatePlow(dt);
  if (g.result) g.resultT += dt;
  if (g.started && p.state !== 'plowed' && !g.over) {
    const raceRunning = g.mode === 'race' && g.racers.some(r => r.finishT === null) && g.resultT < 12;
    if (!g.result || raceRunning) g.time += dt;
  }

  for (const q of g.particles) { q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.vz -= 300 * dt; if (q.z < 0) { q.z = 0; q.vx *= 0.8; q.vy *= 0.8; q.vz = 0; } }
  g.particles = g.particles.filter(q => q.t < q.life);
  for (const t of g.texts) t.t += dt;
  g.texts = g.texts.filter(t => t.t < 1.4);
  if (g.msg) { g.msg.t += dt; if (g.msg.t > g.msg.dur) g.msg = null; }
  g.flash = Math.max(0, g.flash - dt);
  if (Math.random() < dt * 6) g.smoke.push({ x: -150 + 22 + (Math.random() - 0.5) * 2, y: 96 - 58, t: 0, s: 1 + Math.random() });
  for (const s of g.smoke) { s.t += dt; s.y -= 14 * dt; s.x += Math.sin(s.t * 2 + s.s) * 6 * dt + 4 * dt; }
  g.smoke = g.smoke.filter(s => s.t < 3);

  const cam = g.cam;
  const focus = (p.state === 'plowed' && g.plow) ? g.plow : p;
  cam.x += (focus.x - cam.x) * Math.min(1, dt * 3.2);
  const lookAhead = H * (0.3 + Math.min(0.06, p.speed / VMAX * 0.05));
  const fz = focus === p ? p.z * 0.55 : 0;
  cam.y += (focus.y - fz - lookAhead - cam.y) * Math.min(1, dt * 10);
  cam.shake = Math.max(0, cam.shake - dt);
  g.world.prune(Math.min(cam.y, ...g.racers.map(r => r.y)));

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
  const r = Math.floor((y - m.y + 3) / m.rowH);
  return r >= 0 && r <= MODE_KEYS.length ? r : -1;
}

// ---- rendering --------------------------------------------------------------------------------------------------------
const BG = '#f4f8fd';
function drawSpr(s, x, y) { ctx.drawImage(s.c, Math.round(x - s.ax), Math.round(y - s.ay)); }

function drawGround(camX, camY) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
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
    const ax = tr[i] - camX, ay = tr[i + 1] - camY, bx = tr[i + 2] - camX, by = tr[i + 3] - camY;
    if ((ay < y0 && by < y0) || (ay > y1 && by > y1) || (ax < -4 && bx < -4) || (ax > W + 4 && bx > W + 4)) continue;
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) | 0 || 1;
    for (let k = 0; k <= n; k++) ctx.fillRect(Math.round(ax + (bx - ax) * k / n), Math.round(ay + (by - ay) * k / n), 1, 1);
  }
}

function drawBanner(o, camX, camY) {
  const x = Math.round(o.x - camX), y = Math.round(o.y - camY);
  const hw = o.hw;
  ctx.fillStyle = 'rgba(93,122,166,0.25)';
  ctx.fillRect(x - hw + 1, y, 5, 2); ctx.fillRect(x + hw + 1, y, 5, 2);
  for (const px of [x - hw, x + hw]) {
    ctx.fillStyle = '#1b1b2b'; ctx.fillRect(px - 2, y - 44, 5, 45);
    ctx.fillStyle = '#c98a4b'; ctx.fillRect(px - 1, y - 43, 3, 43);
    ctx.fillStyle = '#8a5527'; ctx.fillRect(px + 1, y - 43, 1, 43);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(px - 2, y - 46, 5, 3);
  }
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
  // finish line painted on the snow
  if (o.banner === 'finish') for (let xx = -hw; xx < hw; xx += 4) { ctx.fillStyle = (xx / 4) % 2 ? '#1b1b2b' : '#d6e1ef'; ctx.fillRect(x + xx, y + 1, 4, 2); }
}

function drawSign(o, camX, camY) {
  drawSpr(SPR.sign, o.x - camX, o.y - camY);
  if (o.label) drawText(ctx, o.label, Math.round(o.x - camX), Math.round(o.y - camY) - 23, '#5e3517', 1, 'center');
}

function drawGate(g, camX, camY) {
  const y = Math.round(g.y - camY) + 1;
  const x0 = Math.round(g.x - g.w / 2 - camX) + 3, x1 = Math.round(g.x + g.w / 2 - camX) - 2;
  ctx.fillStyle = g.state === 'pass' ? '#9fd8a8' : g.state === 'miss' ? '#f0a2a5' : '#d6e1ef';
  for (let x = x0; x < x1; x += 3) ctx.fillRect(x, y, 2, 1);
  drawText(ctx, String(g.idx + 1), Math.round(g.x - camX), y - 12, g.state === 'miss' ? '#d8333a' : g.state === 'pass' ? '#2a7535' : '#9fb3cf', 1, 'center');
}

function drawGift(o, camX, camY) {
  if (o.hidden) return;
  const t = performance.now() / 1000;
  const bob = Math.round(Math.sin(t * 3 + o.x * 0.05) * 2) - 3;
  const x = o.x - camX, y = o.y - camY;
  ctx.fillStyle = 'rgba(93,122,166,0.28)'; ctx.fillRect(Math.round(x - 6), Math.round(y), 14, 2);
  drawSpr(SPR[o.spr], x, y + bob);
  if (Math.floor(t * 4 + o.x) % 6 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x + 4), Math.round(y + bob - 13), 1, 1); }
}

function racerSprite(r, base, deg, step) { return rotSprite(skinKey(base, r.skin), deg, step); }

function drawRacer(r, camX, camY) {
  const x = r.x - camX, y = r.y - camY;
  if (r.state === 'down' || r.state === 'plowed') {
    const z = r.state === 'plowed' ? r.z : 0;
    if (r.state === 'down') drawSpr(racerSprite(r, 'sled', r.crashSledAng, 6), x + r.crashSledOff[0], y + r.crashSledOff[1]);
    drawSpr(SPR[skinKey('crash', r.skin)], x, y - z);
    const t = performance.now() / 1000;
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + i * 2.094;
      const sx = Math.round(x + Math.cos(a) * 8), sy = Math.round(y - z - 10 + Math.sin(a) * 3);
      ctx.fillStyle = '#f6c431'; ctx.fillRect(sx - 1, sy, 3, 1); ctx.fillRect(sx, sy - 1, 1, 3);
    }
    return;
  }
  const sh = r.z > 0 ? Math.max(3, 9 - r.z * 0.04) : 9;
  ctx.fillStyle = 'rgba(93,122,166,0.28)';
  ctx.beginPath(); ctx.ellipse(Math.round(x + 2 + r.z * 0.15), Math.round(y + 3), sh, sh * 0.55, 0, 0, Math.PI * 2); ctx.fill();

  const yy = y - r.z - (r.scootT > 0 ? 1 : 0);
  const deg = r.heading * 180 / Math.PI;
  if (r.state === 'air' && r.flipT >= 0) {
    const ph = r.flipT * Math.PI * 2;
    const c = Math.cos(ph);
    const spr = c >= 0 ? racerSprite(r, 'player', deg + r.spin, 4) : racerSprite(r, 'sledBottom', deg + r.spin, 4);
    ctx.save();
    ctx.translate(Math.round(x), Math.round(yy - Math.sin(ph) * 6));
    ctx.scale(1, Math.max(0.15, Math.abs(c)));
    ctx.drawImage(spr.c, -Math.round(spr.ax), -Math.round(spr.ay));
    ctx.restore();
  } else if (r.state === 'air' && r.superHeld) {
    const d2 = deg + r.spin, a = rad(d2);
    drawSpr(racerSprite(r, 'sled', d2, 4), x, yy);
    const ext = Math.min(9, r.superT * 40);
    drawSpr(racerSprite(r, 'rider', d2, 4), x - Math.sin(a) * ext, yy - Math.cos(a) * ext - 2);
  } else {
    const s = r.state === 'tumble' ? racerSprite(r, 'player', deg + r.tumbleRot, 10) : r.state === 'air' ? racerSprite(r, 'player', deg + r.spin, 4) : racerSprite(r, 'player', deg, 3);
    drawSpr(s, x, yy);
  }
  const now = performance.now();
  if ((r.tucking || r.waxT > 0) && r.state === 'ride' && r.speed > 100) {
    ctx.fillStyle = r.waxT > 0 ? '#ffb347' : '#c9d8ec';
    for (let i = 0; i < 3; i++) { const ox = ((now / 20 + i * 37) % 24) - 12; ctx.fillRect(Math.round(x + ox), Math.round(yy - 16 - i * 3), 1, r.waxT > 0 ? 6 : 4); }
  }
  if (r.shieldT > 0 && (r.shieldT > 2 || Math.floor(now / 90) % 2)) drawSpr(SPR.bubble, x, yy);
  if (r.frozenT > 0) {
    drawSpr(SPR.cloud, x, yy - 24 + Math.sin(now / 150) * 1);
    ctx.fillStyle = '#9fd0ee';
    for (let i = 0; i < 5; i++) { const fy = ((now / 12 + i * 23) % 18); ctx.fillRect(Math.round(x - 8 + i * 4), Math.round(yy - 20 + fy), 1, 1); }
  }
}

function drawNameTag(r, camX, camY) {
  if (!r.ai || r.finishT !== null && r.state === 'finished' && r.speed < 5) return;
  const d = Math.hypot(r.x - game.p.x, r.y - game.p.y);
  if (d > 260) return;
  const x = Math.round(r.x - camX), y = Math.round(r.y - r.z - camY) - (r.state === 'down' ? 22 : 24);
  drawText(ctx, r.name, x, y, SKINS[r.skin].coatD, 1, 'center', '#ffffff');
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

function drawShot(s, camX, camY) {
  const x = s.x - camX, y = s.y - camY;
  ctx.fillStyle = 'rgba(93,122,166,0.3)'; ctx.fillRect(Math.round(x - 2), Math.round(y + 1), 5, 2);
  drawSpr(SPR.snowball, x, y - 6);
}

function drawWorld(world, camX, camY, withGame) {
  camX = Math.round(camX); camY = Math.round(camY);
  drawGround(camX, camY);
  const vis = [];
  world.query(camX - 80, camY - 40, camX + W + 80, camY + H + 80, vis);
  for (const o of vis) if (o.kind === 'zone') drawSpr(zoneSprite(o), o.x - camX, o.y - camY);
  if (withGame) {
    for (const h of game.hazards) drawSpr(SPR.slush, h.x - camX, h.y - camY);
    drawTracks(game.tracks, camX, camY);
  }
  for (const o of vis) if (o.type === 'gate') drawGate(o, camX, camY);
  for (const o of vis) if (o.type === 'mogul') drawSpr(SPR[o.spr], o.x - camX, o.y - camY);
  const list = [];
  for (const o of vis) if (o.kind !== 'zone' && o.type !== 'gate' && o.type !== 'mogul' && o.type !== 'bannerpost') list.push({ y: o.y, o });
  if (withGame) {
    for (const r of game.racers) if (r.y > camY - 80 && r.y < camY + H + 60 && Math.abs(r.x - camX - W / 2) < W / 2 + 40) list.push({ y: r.y + 5, racer: r });
    for (const n of game.npcs) list.push({ y: n.y, npc: n });
    for (const s of game.shots) list.push({ y: s.y, shot: s });
    if (game.plow) list.push({ y: game.plow.y + 2, plow: true });
  }
  list.sort((a, b) => a.y - b.y);
  for (const it of list) {
    if (it.racer) drawRacer(it.racer, camX, camY);
    else if (it.npc) drawNPC(it.npc, camX, camY);
    else if (it.shot) drawShot(it.shot, camX, camY);
    else if (it.plow) drawPlow(game.plow, camX, camY);
    else {
      const o = it.o;
      if (o.type === 'banner') drawBanner(o, camX, camY);
      else if (o.type === 'sign') drawSign(o, camX, camY);
      else if (o.type === 'gift') drawGift(o, camX, camY);
      else if (o.spr) drawSpr(SPR[o.spr], o.x - camX, o.y - camY);
      if (o.type === 'lodge' && withGame) for (const s of game.smoke) {
        const a = 1 - s.t / 3;
        ctx.fillStyle = `rgba(200,210,224,${(a * 0.8).toFixed(2)})`;
        const r = 1 + s.t * 1.3 * s.s;
        ctx.fillRect(Math.round(s.x - camX - r / 2), Math.round(s.y - camY - r / 2), Math.ceil(r), Math.ceil(r));
      }
    }
  }
  if (withGame) for (const r of game.racers) if (r.ai) drawNameTag(r, camX, camY);
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

function drawRaceHUD() {
  const g = game, p = g.p;
  // place
  const placeCol = p.place === 1 ? '#f6c431' : p.place === 2 ? '#c9d8ec' : p.place === 3 ? '#e0a530' : '#ffffff';
  drawText(ctx, ordinal(p.place), 8, 8, placeCol, 3, 'left', '#1b1b2b', '#1b1b2b');
  drawText(ctx, '/' + g.racers.length, 8 + textWidth(ordinal(p.place), 3) + 4, 22, '#1b1b2b', 1, 'left', '#ffffff');
  // item slot
  const sx = 8, sy = 36;
  panel(sx, sy, 24, 24, '#e7eff9');
  let icon = null;
  if (p.roulette > 0) icon = Object.keys(ITEMS)[p.rouletteIdx % 6];
  else if (p.item) icon = p.item;
  if (icon) {
    const k = icon === 'snowball3' && p.roulette <= 0 && p.itemCount < 3 ? (p.itemCount === 2 ? 'snowball3' : 'snowball') : icon;
    drawSpr(SPR['icon_' + k], sx + 12, sy + 12);
    if (p.roulette <= 0) {
      drawText(ctx, ITEMS[p.item].name + (p.item === 'snowball3' ? ' (' + p.itemCount + ')' : ''), sx + 30, sy + 4, '#1b1b2b', 1, 'left', '#ffffff');
      if (Math.floor(performance.now() / 500) % 2) drawText(ctx, pointer.touch ? 'TAP ITEM' : 'E / X TO USE', sx + 30, sy + 14, '#5b636d', 1, 'left', '#ffffff');
    }
  } else drawText(ctx, '-', sx + 12, sy + 9, '#9aa3ad', 1, 'center');
  // status effects
  let ey = sy + 30;
  if (p.shieldT > 0) { drawText(ctx, 'SHIELD ' + Math.ceil(p.shieldT), sx, ey, '#3c9bd6', 1, 'left', '#ffffff'); ey += 10; }
  if (p.waxT > 0.5) { drawText(ctx, 'TURBO!', sx, ey, '#ff8a1f', 1, 'left', '#ffffff'); ey += 10; }
  if (p.frozenT > 0) { drawText(ctx, 'SNOWED IN', sx, ey, '#7b93ab', 1, 'left', '#ffffff'); ey += 10; }
  // progress strip with every racer
  const left = 76, right = W - 118 - 6 - 44;            // between the place counter and the stats panel
  const bw = Math.min(200, right - left), bx = Math.round(clamp(W / 2 - bw / 2, left, right - bw)), by = 10;
  if (bw > 60) {
    panel(bx, by, bw, 4, '#e7eff9');
    ctx.fillStyle = '#1b1b2b';
    for (let i = 0; i <= 4; i++) ctx.fillRect(bx + Math.round(bw * i / 4), by + 4, 1, 2);
    drawText(ctx, 'FINISH', bx + bw + 4, by - 1, '#5b636d');
    const len = g.world.course.len;
    const list = g.racers.slice().sort((a, b) => (a.isPlayer ? 1 : 0) - (b.isPlayer ? 1 : 0));
    for (const r of list) {
      const f = clamp((r.y - START_Y) / (len - START_Y), 0, 1);
      const x = bx + Math.round(f * (bw - 1));
      ctx.fillStyle = '#1b1b2b'; ctx.fillRect(x - 2, by - 2, 5, 8);
      ctx.fillStyle = SKINS[r.skin].coat; ctx.fillRect(x - 1, by - 1, 3, 6);
      if (r.isPlayer) { ctx.fillStyle = '#1b1b2b'; ctx.fillRect(x - 1, by - 5, 3, 2); ctx.fillRect(x, by - 3, 1, 1); }
    }
  }
}

function drawHUD() {
  const g = game, p = g.p;
  const distM = Math.max(0, Math.floor((p.y - START_Y) / PX_PER_M));
  const lines = [];
  lines.push(['TIME', fmtTime(g.time)]);
  if (g.mode === 'gates') {
    lines.push(['GATES', g.passed + '/' + g.world.gates.length]);
    lines.push(['MISSED', g.missed + (g.penalty ? ' +' + g.penalty + 'S' : '')]);
    lines.push(['TO GO', Math.max(0, Math.ceil((g.world.course.len - p.y) / PX_PER_M)) + 'M']);
  } else if (g.mode === 'bigair') {
    lines.push(['SCORE', String(g.score)]);
    lines.push(['TO GO', Math.max(0, Math.ceil((g.world.course.len - p.y) / PX_PER_M)) + 'M']);
  } else if (g.mode === 'race') {
    lines.push(['TO GO', Math.max(0, Math.ceil((g.world.course.len - p.y) / PX_PER_M)) + 'M']);
    const ahead = g.order && g.order[p.place - 2];
    if (ahead && ahead.finishT === null) lines.push(['GAP', ahead.name + ' ' + Math.max(0, Math.round((ahead.y - p.y) / PX_PER_M)) + 'M']);
  } else {
    lines.push(['DIST', distM + 'M']);
    lines.push(['STYLE', String(g.score)]);
  }
  const spd = p.state === 'air' ? Math.hypot(p.vx, p.vy) : (p.state === 'ride' || p.state === 'tumble' || p.state === 'finished') ? p.speed : 0;
  lines.push(['SPEED', Math.round(spd / PX_PER_M * 3.6) + ' KM/H']);
  const pw = 118, ph = lines.length * 10 + 6;
  const px = W - pw - 6, py = 6;
  panel(px, py, pw, ph);
  lines.forEach(([k, v], i) => {
    drawText(ctx, k, px + 5, py + 4 + i * 10, '#5b636d');
    drawText(ctx, v, px + pw - 5, py + 4 + i * 10, '#1b1b2b', 1, 'right');
  });
  if (g.mode === 'race') drawRaceHUD();
  // tuck meter
  const bx = 8, by = H - 14;
  drawText(ctx, 'TUCK', bx, by - 1, '#5b636d');
  panel(bx + 28, by, 52, 5, '#e7eff9');
  ctx.fillStyle = p.stamina < 0.25 ? '#d8333a' : p.tucking ? '#ff8a1f' : '#2f5fd0';
  ctx.fillRect(bx + 28, by, Math.round(52 * p.stamina), 5);
  if (muted) drawText(ctx, 'MUTED', W - 6, H - 12, '#9aa3ad', 1, 'right');
  // touch item button
  itemBtn = null;
  if (g.mode === 'race' && pointer.touch) {
    itemBtn = { x: W - 30, y: H - 44, r: 20 };
    ctx.fillStyle = '#1b1b2b'; ctx.beginPath(); ctx.arc(itemBtn.x, itemBtn.y, itemBtn.r + 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.item && p.roulette <= 0 ? '#ffd76a' : '#e7eff9'; ctx.beginPath(); ctx.arc(itemBtn.x, itemBtn.y, itemBtn.r, 0, Math.PI * 2); ctx.fill();
    if (p.item && p.roulette <= 0) drawSpr(SPR['icon_' + p.item], itemBtn.x, itemBtn.y - 2);
    drawText(ctx, 'ITEM', itemBtn.x, itemBtn.y + 9, '#1b1b2b', 1, 'center');
  }
  if (g.plow && g.plow.caughtT < 0) {
    const d = Math.max(0, Math.round((p.y - g.plow.y) / PX_PER_M));
    const flash = Math.floor(performance.now() / 250) % 2;
    drawText(ctx, 'PLOW ' + d + 'M BEHIND', W / 2, 8, flash || d > 25 ? '#d8333a' : '#ff8a1f', 1, 'center', '#ffffff');
    if (g.plow.y < g.cam.y) {
      const ax = clamp(Math.round(g.plow.x - g.cam.rx), 10, W - 10);
      ctx.fillStyle = flash ? '#ff8a1f' : '#d8333a';
      for (let i = 0; i < 4; i++) ctx.fillRect(ax - i, 20 + i, i * 2 + 1, 1);
    }
  } else if (g.mode === 'free' && distM > PLOW_AT_M - 150 && distM < PLOW_AT_M) {
    drawText(ctx, 'YOU HEAR AN ENGINE...', W / 2, 8, '#9aa3ad', 1, 'center');
  }
}

function drawCountdown() {
  const g = game;
  if (g.mode !== 'race') return;
  const c = g.countdown - 0.6;
  let txt = null, col = '#d8333a';
  if (!g.started) { if (c < 3) txt = String(Math.ceil(c)); }
  else if (g.time < 0.9) { txt = 'GO!'; col = '#2a7535'; }
  if (!txt) return;
  const y = Math.round(H * 0.56);
  drawText(ctx, txt, W / 2, y, col, 5, 'center', '#ffffff', '#1b1b2b');
  if (!g.started) drawText(ctx, 'TIP: PRESS _ RIGHT AS IT SAYS GO', W / 2, y + 44, '#5b636d', 1, 'center', '#ffffff');
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
  if (game.mode === 'race') return;
  const blink = Math.floor(performance.now() / 500) % 2;
  const y = Math.round(H * 0.62);
  panel(W / 2 - 110, y - 6, 220, 40, '#ffffff');
  drawText(ctx, MODES[game.mode].name, W / 2, y, '#d8333a', 1, 'center');
  drawText(ctx, MODES[game.mode].desc, W / 2, y + 11, '#5b636d', 1, 'center');
  if (blink) drawText(ctx, 'PRESS _ OR TAP TO PUSH OFF', W / 2, y + 22, '#1b1b2b', 1, 'center');
}

function drawRaceResult() {
  const g = game, r = g.result;
  const rows = g.order || g.racers;
  const w = 220, h = 40 + rows.length * 11 + 22, x = Math.round(W / 2 - w / 2), y = Math.round(H / 2 - h / 2);
  panel(x, y, w, h);
  const title = r.place === 1 ? 'YOU WIN!' : 'YOU FINISHED ' + ordinal(r.place);
  drawText(ctx, title, W / 2, y + 7, r.place === 1 ? '#2a7535' : r.place <= 3 ? '#2f5fd0' : '#d8333a', 1, 'center');
  rows.forEach((o, i) => {
    const yy = y + 22 + i * 11;
    if (o.isPlayer) { ctx.fillStyle = '#dde8f7'; ctx.fillRect(x + 2, yy - 2, w - 4, 11); }
    drawText(ctx, ordinal(i + 1), x + 10, yy, '#5b636d');
    ctx.fillStyle = '#1b1b2b'; ctx.fillRect(x + 37, yy, 7, 7);
    ctx.fillStyle = SKINS[o.skin].coat; ctx.fillRect(x + 38, yy + 1, 5, 5);
    drawText(ctx, o.name, x + 50, yy, '#1b1b2b');
    const t = o.finishT !== null ? (o === rows[0] ? fmtTime(o.finishT) : '+' + (o.finishT - rows[0].finishT).toFixed(2)) : Math.max(0, Math.ceil((g.world.course.len - o.y) / PX_PER_M)) + 'M TO GO';
    drawText(ctx, t, x + w - 10, yy, o.finishT !== null ? '#1b1b2b' : '#9aa3ad', 1, 'right');
  });
  const by = y + 22 + rows.length * 11 + 4;
  if (r.record && Math.floor(performance.now() / 300) % 2) drawText(ctx, 'NEW PERSONAL BEST!', W / 2, by, '#d8333a', 1, 'center');
  drawText(ctx, 'ENTER: RACE AGAIN   ESC: MENU', W / 2, y + h - 11, '#1b1b2b', 1, 'center');
}

function drawResult() {
  const g = game, r = g.result;
  if (!r || g.resultT < 1.0) return;
  if (r.mode === 'race') { drawRaceResult(); return; }
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
  drawSpr(rotSprite('player', Math.sin(t * 2) * 28, 3), cx + 72, y + 46 + Math.sin(t * 4) * 1.5);
  drawSpr(rotSprite('player_zoe', Math.sin(t * 2 + 1) * 28, 3), cx - 74, y + 40 + Math.sin(t * 4 + 1) * 1.5);
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(cx - 2 - 58 + i * 24), y - 3, 14, 2);
}

function drawTitle() {
  drawWorld(titleWorld, titleCam.x - W / 2, titleCam.y, false);
  drawSnowfall(0, 0.7);
  ctx.fillStyle = 'rgba(244,248,253,0.35)'; ctx.fillRect(0, 0, W, H);
  if (overlay === 'help') { drawHelp(); return; }
  const cx = Math.round(W / 2);
  const ly = Math.max(14, Math.round(H * 0.08));
  drawLogo(cx, ly);
  const mw = 230, rowH = 14;
  const my = ly + 84;
  menuLayout = { x: cx - mw / 2, y: my, w: mw, rowH };
  panel(cx - mw / 2, my - 4, mw, rowH * (MODE_KEYS.length + 1) + 6);
  const bestStr = k => k === 'race' ? (BEST.racePlace ? 'BEST ' + ordinal(BEST.racePlace) + (BEST.raceWins ? '  ' + BEST.raceWins + 'W' : '') : '')
    : k === 'free' ? (BEST.free ? 'BEST ' + BEST.free + 'M' : '') : k === 'gates' ? (BEST.gates ? 'BEST ' + fmtTime(BEST.gates) : '') : (BEST.bigair ? 'BEST ' + BEST.bigair : '');
  MODE_KEYS.forEach((k, i) => {
    const y = my + i * rowH;
    if (menuSel === i) { ctx.fillStyle = '#dde8f7'; ctx.fillRect(cx - mw / 2, y - 3, mw, rowH); }
    drawText(ctx, (menuSel === i ? '} ' : '  ') + MODES[k].name, cx - mw / 2 + 8, y + 1, menuSel === i ? '#d8333a' : '#1b1b2b');
    if (k === 'race') drawText(ctx, 'NEW!', cx - mw / 2 + 60, y + 1, '#ff8a1f');
    const b = bestStr(k);
    if (b) drawText(ctx, b, cx + mw / 2 - 8, y + 1, '#5b636d', 1, 'right');
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
  const w = Math.min(W - 16, 420), h = Math.min(H - 16, 340);
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
    ['E  X  CTRL', 'USE ITEM (RACE MODE)'],
    ['MOUSE/TOUCH', 'POINT TO STEER, CLICK/TAP TO HOP'],
    ['P  R  M', 'PAUSE  RESTART  SOUND'],
  ];
  let yy = y + 26;
  const colX = x + 10, col2 = x + Math.min(96, w * 0.28);
  for (const [k, v] of ctl) { drawText(ctx, k, colX, yy, '#2f5fd0'); drawText(ctx, v, col2, yy, '#1b1b2b'); yy += 10; }
  yy += 4;
  // race items
  drawText(ctx, 'GIFTS GIVE RACE ITEMS. RACERS AT THE BACK GET BETTER ONES:', W / 2, yy, '#5b636d', 1, 'center');
  yy += 14;
  const items = [['snowball', 'HITS RIVAL'], ['slush', 'DROP BEHIND'], ['wax', 'SPEED'], ['shield', 'BLOCK 1 HIT'], ['blizzard', 'SLOWS LEADERS']];
  const iw = Math.floor((w - 20) / items.length);
  items.forEach(([k, label], i) => {
    const cx = x + 10 + i * iw + iw / 2;
    drawSpr(SPR['icon_' + k], cx, yy + 8);
    drawText(ctx, label, Math.round(cx), yy + 20, '#1b1b2b', 1, 'center');
  });
  yy += 34;
  const legend = [
    ['pine_big0', 'CRASH'], ['rock0', 'TRIP (HOP IT)'], ['ramp', 'LAUNCH'], ['gift0', 'ITEM'],
    ['snowman0', 'SPLAT'], ['flag_r', 'GATE'], ['dogA_r', 'GOOD BOY?'], ['plow0', 'RUN!'],
  ];
  const cols = w > 330 ? 4 : 2;
  const cw = Math.floor((w - 20) / cols);
  legend.forEach(([s, label], i) => {
    const cx = x + 10 + (i % cols) * cw + cw / 2;
    const cy = yy + 42 + Math.floor(i / cols) * 56;
    if (cy > y + h - 26) return;
    drawSpr(SPR[s], cx, cy);
    drawText(ctx, label, Math.round(cx), cy + 5, '#5b636d', 1, 'center');
  });
  drawText(ctx, 'LAND STRAIGHT OR WIPE OUT. ICE: NO STEERING. POWDER: SLOW.', W / 2, y + h - 22, '#1b1b2b', 1, 'center');
  drawText(ctx, 'PRESS ANY KEY', W / 2, y + h - 11, '#9aa3ad', 1, 'center');
}

const lastCam = { x: 0, y: 0 };
function render() {
  ctx.imageSmoothingEnabled = false;
  if (scene === 'title') { itemBtn = null; drawTitle(); return; }
  const g = game, cam = g.cam;
  let sx = 0, sy = 0;
  if (cam.shake > 0) { sx = Math.round((Math.random() - 0.5) * 4); sy = Math.round((Math.random() - 0.5) * 4); }
  cam.rx = Math.round(cam.x - W / 2) + sx; cam.ry = Math.round(cam.y) + sy;
  drawWorld(g.world, cam.rx, cam.ry, true);
  drawParticles(cam.rx, cam.ry);
  drawFloatTexts(cam.rx, cam.ry);
  drawSnowfall(cam.rx - lastCam.x, cam.ry - lastCam.y);
  lastCam.x = cam.rx; lastCam.y = cam.ry;
  if (g.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, g.flash * 1.6).toFixed(2)})`; ctx.fillRect(0, 0, W, H); }
  drawHUD();
  drawCountdown();
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
window.__freesled = { get game() { return game; }, newGame, get scene() { return scene; }, keys, pressed, tick, STEP };
})();
