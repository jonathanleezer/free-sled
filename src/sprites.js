'use strict';
// ---------------------------------------------------------------------------
// FREE SLED — pixel-art sprite factory.
// Every sprite is built at start-up from hand-drawn character grids or small
// procedural painters, then baked to canvases. Rotated rider poses use a
// RotSprite-style pipeline (Scale2x x3 -> nearest rotate) so pixel art stays
// crisp at any angle.
// ---------------------------------------------------------------------------

function rgba(hex, a = 255) {
  const n = parseInt(hex.slice(1), 16);
  return ((a << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0;
}

const COLORS = {
  k: '#1b1b2b', K: '#163322',
  r: '#d8333a', R: '#9c1f2a',
  b: '#2f5fd0', B: '#1f3d8a',
  w: '#ffffff', W: '#c9d8ec', l: '#e7eff9',
  s: '#f2c29b', S: '#d39a72',
  y: '#f6c431', Y: '#f2b705', Z: '#c48a00',
  o: '#c98a4b', O: '#8a5527',
  u: '#6b4426', U: '#45291a',
  g: '#9aa3ad', G: '#5b636d',
  n: '#2e2a5a', N: '#1c1940',
  v: '#3fa34d', V: '#2a7535',
  t: '#2f8a4e', T: '#1d5b36', q: '#48b068',
  c: '#868b98', C: '#5a5e6b', e: '#b4bac6',
  a: '#ff8a1f', A: '#c45b0a',
  h: '#2a2a33', H: '#44444f',
  d: '#a0612e', D: '#5e3517',
  P: '#7b4fc9', p: '#5a36a0',
  i: '#cfeaf8', I: '#9fd0ee', j: '#f4fbff',
  x: '#ffd76a', X: '#e0a530',
  m: '#e2552b', M: '#a8381a',
  f: '#4a5a78', F: '#8fb0dc',
};
const PAL = {};
for (const k in COLORS) PAL[k] = rgba(COLORS[k]);
const SHADOW = rgba('#5d7aa6', 70);

class PB {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); }
  static fromRows(rows, mirror = false) {
    if (mirror) rows = rows.map(r => r + r.split('').reverse().join(''));
    const w = Math.max(...rows.map(r => r.length));
    const b = new PB(w, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch !== '.' && ch !== ' ' && PAL[ch] !== undefined) b.d[y * w + x] = PAL[ch];
      }
    });
    return b;
  }
  clone() { const b = new PB(this.w, this.h); b.d.set(this.d); return b; }
  get(x, y) { return (x < 0 || y < 0 || x >= this.w || y >= this.h) ? 0 : this.d[y * this.w + x]; }
  set(x, y, c) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.d[y * this.w + x] = typeof c === 'string' ? PAL[c] : c;
  }
  setIfEmpty(x, y, c) { if (!this.get(Math.floor(x), Math.floor(y))) this.set(x, y, c); }
  rect(x, y, w, h, c) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c); }
  // painter(dx, dy, nx, ny) -> color char / int / null, nx,ny normalized -1..1
  ellipse(cx, cy, rx, ry, painter) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) {
          const c = typeof painter === 'function' ? painter(x - cx, y - cy, nx, ny) : painter;
          if (c) this.set(x, y, c);
        }
      }
    }
  }
  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  // add a 1px outline around opaque pixels (4-neighbour, optional diagonals)
  outline(c, diag = false) {
    const col = typeof c === 'string' ? PAL[c] : c;
    const src = this.d.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= this.w || y >= this.h) ? 0 : src[y * this.w + x];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (src[y * this.w + x]) continue;
      let n = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
      if (!n && diag) n = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
      if (n && (n >>> 24) === 255) this.d[y * this.w + x] = col;
    }
    return this;
  }
  pad(l, t, r, b) {
    const n = new PB(this.w + l + r, this.h + t + b);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) n.d[(y + t) * n.w + x + l] = this.d[y * this.w + x];
    return n;
  }
  flipX() {
    const n = new PB(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) n.d[y * n.w + (this.w - 1 - x)] = this.d[y * this.w + x];
    return n;
  }
  shadow(cx, cy, rx, ry) { this.ellipse(cx, cy, rx, ry, (dx, dy) => (this.get(Math.floor(cx + dx), Math.floor(cy + dy)) ? null : SHADOW)); return this; }
  toCanvas() {
    const c = document.createElement('canvas');
    c.width = this.w; c.height = this.h;
    const g = c.getContext('2d');
    const img = g.createImageData(this.w, this.h);
    img.data.set(new Uint8ClampedArray(this.d.buffer.slice(0)));
    g.putImageData(img, 0, 0);
    return c;
  }
  sprite(ax, ay) { return { c: this.toCanvas(), w: this.w, h: this.h, ax: ax ?? this.w / 2, ay: ay ?? this.h / 2, pb: this }; }
}

// --- Scale2x (EPX) and RotSprite-lite ------------------------------------------
function scale2x(pb) {
  const w = pb.w, h = pb.h, o = new PB(w * 2, h * 2), s = pb.d;
  const g = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : s[y * w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = s[y * w + x], A = g(x, y - 1), B = g(x + 1, y), Cc = g(x - 1, y), D = g(x, y + 1);
    let e0 = P, e1 = P, e2 = P, e3 = P;
    if (Cc === A && Cc !== D && A !== B) e0 = A;
    if (A === B && A !== Cc && B !== D) e1 = B;
    if (D === Cc && D !== B && Cc !== A) e2 = Cc;
    if (B === D && B !== A && D !== Cc) e3 = D;
    const ox = x * 2, oy = y * 2, ow = o.w;
    o.d[oy * ow + ox] = e0; o.d[oy * ow + ox + 1] = e1;
    o.d[(oy + 1) * ow + ox] = e2; o.d[(oy + 1) * ow + ox + 1] = e3;
  }
  return o;
}

const _up8 = new WeakMap();
function rotatePB(pb, deg) {
  let big = _up8.get(pb);
  if (!big) { big = scale2x(scale2x(scale2x(pb))); _up8.set(pb, big); }
  const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const w = pb.w, h = pb.h;
  const W2 = Math.ceil(Math.abs(w * cs) + Math.abs(h * sn)) + 2;
  const H2 = Math.ceil(Math.abs(w * sn) + Math.abs(h * cs)) + 2;
  const out = new PB(W2, H2);
  for (let j = 0; j < H2; j++) for (let i = 0; i < W2; i++) {
    const dx = i + 0.5 - W2 / 2, dy = j + 0.5 - H2 / 2;
    // inverse map: positive deg turns the sprite's "down" toward +x
    const sx = dx * cs - dy * sn + w / 2, sy = dx * sn + dy * cs + h / 2;
    const ix = Math.floor(sx * 8), iy = Math.floor(sy * 8);
    if (ix >= 0 && iy >= 0 && ix < big.w && iy < big.h) out.d[j * W2 + i] = big.d[iy * big.w + ix];
  }
  return out;
}

const SPR = {};       // name -> sprite
const BASE = {};      // name -> PB used for rotation
const _rotCache = new Map();
function rotSprite(name, deg, step = 3) {
  deg = ((Math.round(deg / step) * step) % 360 + 360) % 360;
  const key = name + '|' + deg;
  let s = _rotCache.get(key);
  if (!s) { s = rotatePB(BASE[name], deg).sprite(); _rotCache.set(key, s); }
  return s;
}

// --- Rider (top-down, facing downhill). Left halves, mirrored. ------------------
const SLED_HALF = [
  '...kkk',
  '..kooo',
  '.koOOO',
  '.koooo',
  '.koooo',
  '.kOOOO',
  '.koooo',
  '.koooo',
  '.kOOOO',
  '.koooo',
  '.koooo',
  '.kOOOO',
  '.koooo',
  '.koooo',
  '.kaOOO',
  '.kaooo',
  '.kaooo',
  '.kaOOO',
  '.kaooo',
  '.kaooo',
  '.kaooo',
  '.kOOOO',
  '..kOOO',
  '...kkk',
];
const SLED_BOTTOM_HALF = [
  '...kkk',
  '..kOOO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '.kOGgO',
  '..kOOO',
  '...kkk',
];
const RIDER_HALF = [
  '......',
  '......',
  '......',
  '.kRRRR',
  'kRrrrr',
  'kRrrkk',
  'kRrkbb',
  'kRrkbb',
  'kRrkbw',
  'kRrkbB',
  'kRrrkk',
  'kRrryy',
  'kRrrry',
  'kRrnnn',
  'kvvnnN',
  'kvvnnN',
  'kVvnnN',
  '..knnN',
  '..khhk',
  '..khHk',
  '...kk.',
  '......',
  '......',
  '......',
];
// rider sprawled on their back after a wipe-out (top-down)
const CRASH_HALF = [
  '.....kkk',
  '....kbbb',
  '....kbbw',
  '....kbbb',
  '....ksss',
  '....kskS',
  '..k.ksss',
  '.kvkkyyy',
  'kvvRRrrr',
  '.kkRRrrr',
  '...kkrrr',
  '.....knn',
  '....knnN',
  '...knnkk',
  '..knnk..',
  '.khhk...',
  '.khHk...',
  '..kk....',
];

// --- Hand-drawn side/front sprites (fill only; outline added in code) -----------
const DOG_A = [
  '...........DD...',
  '..........DdDd..',
  '..........ddddd.',
  '..........ddkdd.',
  'd.........ddddhD',
  'dd.......rdddD..',
  '.ddddddddrdd....',
  '.dDdddddddd.....',
  '.dd.dd...dd.d...',
  'dd...dd.dd...dd.',
  'h.....h.h.....h.',
];
const DOG_B = [
  '...........DD...',
  '..........DdDd..',
  '..........ddddd.',
  '..........ddkdd.',
  '..........ddddhD',
  '.d.......rdddD..',
  'dddddddddrdd....',
  '.dDdddddddd.....',
  '..dd.dd.dd.d....',
  '..dd..ddd..dd...',
  '..h....hh...h...',
];
const DOG_SIT = [
  '......DD.',
  '.....DdDd',
  '.....dddd',
  '.....dkdd',
  '.....dddh',
  '....rddd.',
  '...ddrdd.',
  '..dddddd.',
  'd.ddddddd',
  'dddddd.dd',
  '.hhhh.hh.',
];
const XC_A = [
  '......rr........',
  '.....rrrr.......',
  '.....rwrr.......',
  '.....ssss.......',
  '.....sssk.......',
  '.....ssss.......',
  '....PPPPP.......',
  '...PPPPPPP......',
  '..gPpPPPPPs.....',
  '..g.PpPPP..g....',
  '..g.PpPPP...g...',
  '.g..nnnnn....g..',
  '.g..nn.nn.....g.',
  '.g.nn...nn....g.',
  'g..nn....nn....g',
  'g.hh......hh...g',
  'bbbbbbbbbbbbbbbb',
];
const XC_B = [
  '......rr........',
  '.....rrrr.......',
  '.....rwrr.......',
  '.....ssss.......',
  '.....sssk.......',
  '.....ssss.......',
  '....PPPPP.......',
  '...PPPPPPP......',
  '...PPpPPPs......',
  '...gPpPPPg......',
  '...gPpPPP.g.....',
  '..g.nnnnn..g....',
  '..g.nnnn...g....',
  '..g.nnnn....g...',
  '.g..nn.nn...g...',
  '.g..hh.hh...g...',
  'bbbbbbbbbbbbbbbb',
];

// --- Procedural painters ----------------------------------------------------------
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function makePine(w, h, tiers, seed, snowy = false) {
  const r = rng32(seed);
  const b = new PB(w, h);
  const cx = (w - 1) / 2;
  const trunkH = Math.max(3, Math.round(h * 0.13));
  const crownBot = h - trunkH;
  const th = w >= 18 ? 1.6 : 1.0;
  for (let y = crownBot - 3; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - cx;
    if (Math.abs(dx) <= th) b.set(x, y, dx < 0 ? 'u' : 'U');
  }
  const span = crownBot - 1;
  const tierH = span / (tiers * 0.68);
  for (let i = tiers - 1; i >= 0; i--) {
    const yt = tiers > 1 ? 1 + i * (span - tierH) / (tiers - 1) : 1;
    const yb = yt + tierH;
    const maxHW = (w / 2 - 0.6) * (0.42 + 0.58 * (i + 1) / tiers);
    const jagOff = Math.floor(r() * 3);
    for (let y = Math.floor(yt); y <= Math.ceil(yb); y++) {
      const f = Math.max(0, (y - yt) / (yb - yt));
      if (f > 1) continue;
      const hw = 0.55 + f * maxHW;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        if (Math.abs(dx) > hw) continue;
        if (y >= Math.ceil(yb) - 1 && (x + jagOff) % 3 === 0 && Math.abs(dx) > 1) continue;
        let c = 't';
        if (dx < -hw * 0.38) c = 'q';
        else if (dx > hw * 0.42) c = 'T';
        if (y >= Math.ceil(yb) - 1 && c !== 'q') c = 'T';
        b.set(x, y, c);
      }
    }
  }
  // snow resting on upward-facing surfaces (left/lit side heavier)
  const src = b.d.slice();
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src[y * w + x];
  const greens = [PAL.t, PAL.T, PAL.q];
  for (let y = 0; y < crownBot; y++) for (let x = 0; x < w; x++) {
    const p = at(x, y);
    if (!greens.includes(p)) continue;
    const dx = x - cx;
    const openAbove = !at(x, y - 1);
    const open2 = !at(x, y - 2);
    if (openAbove && (dx <= 0.5 || r() < (snowy ? 0.9 : 0.35))) b.set(x, y, dx > 1 ? 'W' : 'w');
    else if (snowy && open2 && dx < 1) b.set(x, y, 'l');
    else if (snowy && r() < 0.06) b.set(x, y, 'w');
  }
  b.outline('K');
  const out = b.pad(1, 1, 3, 3);
  out.shadow(cx + 3, h + 0.5, w * 0.42, 2.6);
  return out.sprite(cx + 1 + 0.5, h + 1);
}

function makeDeadTree(seed) {
  const r = rng32(seed);
  const w = 22, h = 34;
  const b = new PB(w, h);
  const cx = 10;
  for (let y = 6; y < h; y++) {
    const thick = y > 26 ? 2 : y > 14 ? 1.5 : 1;
    for (let x = cx - 2; x <= cx + 2; x++) if (Math.abs(x - cx) <= thick - 0.5 || (x === cx)) b.set(x, y, x < cx ? 'u' : 'U');
  }
  b.set(cx, 4, 'U'); b.set(cx, 5, 'U'); b.set(cx + 1, 3, 'U');
  const branch = (x0, y0, len, dir, up) => {
    let x = x0, y = y0;
    for (let i = 0; i < len; i++) {
      x += dir; if (i % up === 0) y -= 1;
      b.set(x, y, 'U');
      if (!b.get(x, y - 1)) b.set(x, y - 1, i % 2 ? 'w' : 'l');
      if (i === len - 2 && r() < 0.8) { b.set(x + dir, y - 2, 'U'); b.set(x + dir, y - 3, 'U'); }
    }
  };
  branch(cx, 22, 7 + Math.floor(r() * 3), -1, 2);
  branch(cx + 1, 18, 6 + Math.floor(r() * 3), 1, 2);
  branch(cx, 13, 5, -1, 1);
  branch(cx + 1, 10, 4, 1, 1);
  b.set(cx, 3, 'w');
  b.outline(rgba('#3a2414', 160));
  const out = b.pad(0, 1, 3, 3);
  out.shadow(cx + 3, h + 1, 7, 2.2);
  return out.sprite(cx + 0.5, h + 1);
}

function makeRock(w, h, seed, capped = true) {
  const r = rng32(seed);
  const b = new PB(w, h);
  const cx = (w - 1) / 2, cy = h * 0.55;
  const bumps = [r() * 0.15, r() * 0.15, r() * 0.15];
  b.ellipse(cx, cy, w / 2 - 0.5, h * 0.55, (dx, dy, nx, ny) => {
    if (ny > 0.75) return null;
    const ang = Math.atan2(ny, nx);
    const rad = Math.hypot(nx, ny);
    if (rad > 0.92 - bumps[Math.floor(((ang + Math.PI) / (2 * Math.PI)) * 3) % 3]) return null;
    const lit = -nx * 0.6 - ny * 0.8;
    if (capped && ny < -0.35 + Math.sin(nx * 7 + seed) * 0.08) return nx > 0.35 ? 'W' : 'w';
    if (lit > 0.45) return 'e';
    if (lit < -0.25) return 'C';
    return (Math.floor(dx * 3 + dy * 7 + seed) % 7 === 0) ? 'C' : 'c';
  });
  b.outline('k');
  const out = b.pad(1, 1, 3, 2);
  out.shadow(cx + 2.5, h * 0.55 + h * 0.4 + 1, w * 0.5, 2.2);
  return out.sprite(cx + 1.5, Math.round(h * 0.55 + h * 0.42) + 1);
}

function makeStump() {
  const b = new PB(12, 11);
  for (let y = 3; y < 10; y++) for (let x = 1; x < 11; x++) {
    if ((y === 9) && (x === 1 || x === 10)) continue;
    b.set(x, y, x < 4 ? 'O' : x > 8 ? 'U' : 'u');
  }
  b.set(3, 6, 'U'); b.set(6, 7, 'U'); b.set(8, 5, 'U');
  b.ellipse(5.5, 3.5, 5, 2.6, (dx, dy, nx, ny) => {
    const rr = Math.hypot(nx, ny);
    if (ny < -0.2 && nx < 0.3) return 'w';
    if (rr > 0.8) return 'O';
    if (Math.abs(rr - 0.45) < 0.12) return 'O';
    return 'o';
  });
  b.set(0, 10, 'u'); b.set(11, 10, 'U');
  b.outline('k');
  const out = b.pad(1, 1, 3, 2);
  out.shadow(8, 12, 6, 2);
  return out.sprite(7, 12);
}

function makeMogul(w, seed) {
  const h = 10;
  const b = new PB(w + 2, h);
  const cx = w / 2;
  for (let x = 2; x < w + 1; x++) b.set(x, h - 1, SHADOW);
  b.ellipse(cx, h - 2.5, w / 2 - 0.5, 6.2, (dx, dy, nx, ny) => {
    if (ny > 0.4) return null;
    const lit = -nx * 0.75 - ny * 0.65;
    if (lit > 0.5) return 'w';
    if (ny > 0.22) return 'F';
    if (lit < -0.3) return 'W';
    return 'l';
  });
  return b.sprite(cx, h - 2);
}

function makeRamp() {
  const w = 32, h = 24;
  const b = new PB(w, h);
  const cx = (w - 1) / 2;
  const LIP = 13;              // row of the lip edge
  const hwAt = y => 7 + y * 0.5;
  // braces / side walls: triangles that get taller toward the lip
  for (let y = 1; y <= LIP; y++) {
    const hw = hwAt(y), drop = Math.round(y * 0.62);
    for (let k = 1; k <= drop; k++) {
      b.set(Math.round(cx - hw), y + k, k === drop ? 'U' : 'u');
      b.set(Math.round(cx + hw), y + k, 'U');
    }
  }
  // front face under the lip, with cross bracing
  const fh = Math.round(LIP * 0.62);
  for (let y = LIP + 1; y <= LIP + fh; y++) for (let x = Math.round(cx - hwAt(LIP)); x <= Math.round(cx + hwAt(LIP)); x++) b.set(x, y, 'U');
  const fx0 = Math.round(cx - hwAt(LIP)) + 1, fx1 = Math.round(cx + hwAt(LIP)) - 1;
  b.line(fx0, LIP + 1, cx, LIP + fh, 'O'); b.line(fx1, LIP + 1, cx + 1, LIP + fh, 'O');
  b.line(fx0, LIP + fh, cx, LIP + 1, 'O'); b.line(fx1, LIP + fh, cx + 1, LIP + 1, 'O');
  // deck planks, narrow uphill, widening to the lip
  for (let y = 0; y <= LIP; y++) {
    const hw = hwAt(y);
    for (let x = 0; x < w; x++) {
      const dx = x - cx;
      if (Math.abs(dx) > hw - 0.5) continue;
      let c = (y % 3 === 2) ? 'O' : 'o';
      if (y < 3) c = (x + y) % 5 ? 'w' : 'l';                       // snow on the run-in
      else if (Math.abs(dx) > hw - 1.6) c = dx < 0 ? 'w' : 'W';     // snow along the rails
      b.set(x, y, c);
    }
  }
  for (let x = Math.round(cx - hwAt(LIP)); x <= Math.round(cx + hwAt(LIP)); x++) b.set(x, LIP, 'y'); // painted lip
  // orange marker wands at the lip corners
  for (const mx of [Math.round(cx - hwAt(LIP)) - 1, Math.round(cx + hwAt(LIP)) + 1]) for (let y = 4; y < LIP + fh + 1; y++) b.set(mx, y, (Math.floor(y / 2) % 2) ? 'a' : 'w');
  const out = b.pad(1, 1, 3, 3).outline('k');
  const base = LIP + fh + 2;
  for (let x = 4; x < w + 3; x++) out.setIfEmpty(x, base + 1, SHADOW);
  for (let x = 7; x < w + 2; x++) out.setIfEmpty(x, base + 2, SHADOW);
  return out.sprite(w / 2 + 1, base);
}

function makeSnowman(seed) {
  const r = rng32(seed);
  const w = 18, h = 29, O = 3; // O: headroom for the hat
  const b = new PB(w, h);
  const snow = (dx, dy, nx, ny) => (-nx * 0.6 - ny * 0.8 < -0.35 ? 'W' : 'w');
  const X = 1; // left margin for the stick arm
  b.ellipse(X + 7.5, O + 19.5, 6.2, 5.6, snow);
  b.ellipse(X + 7.5, O + 11.5, 4.6, 4.2, snow);
  b.ellipse(X + 7.5, O + 5.0, 3.5, 3.4, snow);
  const S = (x, y, c) => b.set(X + x, O + y, c);
  const R = (x, y, ww, hh, c) => b.rect(X + x, O + y, ww, hh, c);
  if (r() < 0.6) { const hc = r() < 0.5 ? 'h' : 'n'; R(4, 1, 8, 1, hc); R(5, -3, 6, 4, hc); R(5, 0, 6, 1, 'r'); }
  else { R(5, 1, 6, 1, 'b'); R(6, 0, 4, 1, 'b'); R(7, -1, 2, 1, 'w'); }
  S(6, 4, 'h'); S(9, 4, 'h');
  S(8, 6, 'a'); S(9, 6, 'a'); S(10, 6, 'A');
  S(6, 7, 'h'); S(7, 8, 'h'); S(8, 8, 'h');
  R(4, 8, 8, 2, 'r'); R(9, 10, 2, 3, 'R');
  S(7, 12, 'h'); S(7, 14, 'h'); S(7, 18, 'h');
  b.line(X + 3, O + 11, X + 0, O + 7, 'u'); S(0, 6, 'u'); S(-1, 6, 'u');
  b.line(X + 12, O + 11, X + 15, O + 8, 'u'); S(15, 7, 'u'); S(16, 7, 'u');
  const out = b.pad(1, 1, 3, 2).outline('k');
  out.shadow(X + 11, O + 26 + 1.5, 7, 2);
  return out.sprite(X + 8.5, O + 26);
}

function makeSnowPile() {
  const b = new PB(18, 9);
  const snow = (dx, dy, nx, ny) => (-nx * 0.6 - ny * 0.8 < -0.35 ? 'W' : 'w');
  b.ellipse(5, 5.5, 4.5, 3, snow);
  b.ellipse(12, 6, 4, 2.6, snow);
  b.ellipse(9, 3.5, 3, 2.4, snow);
  b.set(9, 3, 'a'); b.set(10, 3, 'A');
  b.set(13, 5, 'h'); b.set(4, 4, 'h');
  b.rect(1, 7, 3, 1, 'r');
  b.outline('k');
  const out = b.pad(1, 1, 2, 2);
  out.shadow(11, 10, 8, 1.8);
  return out.sprite(10, 10);
}

function makeFlag(color) {
  const b = new PB(8, 22);
  for (let y = 1; y < 21; y++) b.set(1, y, y % 4 === 0 ? 'G' : 'g');
  for (let y = 1; y < 8; y++) for (let x = 2; x < 2 + Math.round((8 - y) * 0.85) + 1; x++) b.set(x, y, color);
  b.set(1, 0, 'y');
  b.outline('k');
  const out = b.pad(1, 1, 3, 2);
  out.shadow(4, 23, 3.5, 1.4);
  return out.sprite(2.5, 22);
}
function makePole() {
  const b = new PB(3, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 3; x++) b.set(x, y, Math.floor(y / 3) % 2 ? (x === 2 ? 'W' : 'w') : (x === 2 ? 'A' : 'a'));
  const out = b.pad(1, 1, 3, 2).outline('k');
  out.shadow(4, 18, 3, 1.3);
  return out.sprite(2.5, 17);
}
function makeSignPost() {
  const b = new PB(30, 26);
  b.rect(13, 10, 3, 16, 'u'); b.rect(15, 10, 1, 16, 'U');
  b.rect(0, 1, 30, 10, 'o');
  for (let x = 0; x < 30; x++) { b.set(x, 1, 'w'); b.set(x, 10, 'O'); }
  for (let x = 0; x < 30; x += 7) b.set(x, 0, 'w');
  b.outline('k');
  const out = b.pad(1, 2, 3, 2);
  out.shadow(17, 28, 6, 1.5);
  return out.sprite(15.5, 27);
}

function makeLodge() {
  const w = 72, h = 56;
  const b = new PB(w, h);
  // log walls
  for (let y = 26; y < 54; y++) for (let x = 6; x < 66; x++) {
    const row = Math.floor((y - 26) / 3);
    let c = (y - 26) % 3 === 2 ? 'U' : (row % 2 ? 'u' : 'O');
    if (x > 58) c = (y - 26) % 3 === 2 ? 'U' : 'u';
    b.set(x, y, c);
  }
  // log ends at the corners
  for (let y = 26; y < 54; y += 3) { b.set(5, y, 'o'); b.set(5, y + 1, 'O'); b.set(66, y, 'o'); b.set(66, y + 1, 'O'); }
  // gable roof with heavy snow
  for (let y = 4; y < 28; y++) {
    const f = (y - 4) / 24;
    const hw = 4 + f * 33;
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - 35.5);
      if (dx > hw) continue;
      if (dx > hw - 4) b.set(x, y, dx > hw - 1.5 ? 'W' : 'w');
      else b.set(x, y, (y % 3 === 0) ? 'O' : 'o');
    }
  }
  for (let x = 0; x < w; x++) for (let y = 26; y < 29; y++) if (Math.abs(x - 35.5) < 37) b.set(x, y, y === 28 ? 'W' : 'w');
  // icicles
  for (let x = 3; x < 69; x += 5) { b.set(x, 29, 'I'); b.set(x, 30, 'i'); if (x % 2) b.set(x, 31, 'i'); }
  // round gable window
  b.ellipse(35.5, 16, 3.6, 3.6, (dx, dy) => (Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6) ? 'U' : 'x');
  // chimney
  b.rect(52, 0, 7, 14, 'c'); for (let y = 1; y < 14; y += 3) b.rect(52, y, 7, 1, 'C');
  b.rect(51, 0, 9, 2, 'w');
  // door
  b.rect(30, 35, 12, 19, 'U'); b.rect(31, 36, 10, 18, 'O');
  for (let y = 37; y < 54; y += 4) b.rect(31, y, 10, 1, 'U');
  b.set(39, 45, 'y'); b.rect(29, 34, 14, 1, 'w');
  // windows with warm glow
  for (const wx of [12, 49]) {
    b.rect(wx, 34, 12, 10, 'U');
    b.rect(wx + 1, 35, 10, 8, 'x');
    b.rect(wx + 6, 35, 1, 8, 'U'); b.rect(wx + 1, 38, 10, 1, 'U');
    b.rect(wx + 1, 35, 3, 1, 'j');
    b.rect(wx - 1, 33, 14, 1, 'w');
    b.rect(wx - 1, 44, 14, 1, 'O');
  }
  // snow bank against the wall
  for (let x = 4; x < 68; x++) { if (x < 29 || x > 42) { b.set(x, 53, 'w'); if (x % 7 < 4) b.set(x, 52, 'w'); } }
  b.outline('k');
  const out = b.pad(2, 2, 6, 4);
  out.shadow(42, h + 2, 34, 4);
  return out.sprite(38, h + 2);
}

function makePlow(lit) {
  const w = 50, h = 42;
  const b = new PB(w, h);
  // tires
  for (const tx of [4, 40]) { b.rect(tx, 24, 7, 11, 'h'); for (let y = 25; y < 35; y += 2) b.rect(tx, y, 7, 1, 'H'); }
  // cab
  b.rect(12, 4, 26, 18, 'Y'); b.rect(34, 4, 4, 18, 'Z'); b.rect(12, 4, 26, 2, 'y');
  // windshield
  b.rect(14, 7, 22, 9, 'f');
  for (let i = 0; i < 6; i++) { b.set(16 + i, 14 - i, 'F'); b.set(17 + i, 14 - i, 'F'); }
  b.rect(24, 7, 1, 9, 'Z');
  // beacon
  b.rect(21, 0, 8, 4, lit ? 'a' : 'A'); b.rect(22, 0, 3, 1, lit ? 'y' : 'a'); b.rect(20, 3, 10, 1, 'G');
  // hood + grille
  b.rect(8, 20, 34, 9, 'Y'); b.rect(38, 20, 4, 9, 'Z'); b.rect(8, 20, 34, 1, 'y');
  b.rect(18, 22, 14, 6, 'h'); for (let x = 19; x < 32; x += 2) b.rect(x, 22, 1, 6, 'H');
  b.rect(10, 22, 5, 4, 'j'); b.rect(35, 22, 5, 4, 'j');
  b.rect(11, 23, 2, 2, lit ? 'x' : 'j'); b.rect(36, 23, 2, 2, lit ? 'x' : 'j');
  // blade (wide, curved) with hazard stripes
  for (let y = 29; y < 39; y++) {
    const bow = Math.round(Math.abs(y - 33) * 0.4);
    for (let x = bow; x < w - bow; x++) {
      let c = y < 31 ? ((Math.floor((x + y) / 3) % 2) ? 'h' : 'y') : (y > 36 ? 'M' : 'm');
      if (y === 38) c = 'g';
      b.set(x, y, c);
    }
  }
  // snow churned in front of the blade
  for (let x = 2; x < w - 2; x++) { if ((x * 7) % 5 < 3) b.set(x, 39, 'w'); if ((x * 3) % 7 < 2) b.set(x, 40, 'l'); }
  b.outline('k');
  const out = b.pad(2, 2, 4, 3);
  out.shadow(28, h + 2, 26, 2.5);
  return out.sprite(w / 2 + 2, 40);
}

function makeSaucerKid() {
  const b = new PB(18, 18);
  b.ellipse(8.5, 8.5, 8.4, 8.4, (dx, dy, nx, ny) => {
    const rr = Math.hypot(nx, ny);
    if (rr > 0.86) return (-nx - ny > 0.6) ? 'w' : 'R';
    if (rr > 0.72) return 'r';
    return (-nx - ny > 0.5) ? 'r' : 'R';
  });
  b.ellipse(8.5, 8.0, 4.2, 4.2, (dx, dy, nx, ny) => (nx < -0.3 ? 'P' : 'p'));     // shoulders
  b.ellipse(8.5, 7.5, 2.6, 2.6, (dx, dy, nx, ny) => (Math.hypot(nx, ny) < 0.45 ? 'w' : 'v')); // hat w/ pom
  b.rect(4, 11, 2, 2, 'y'); b.rect(12, 11, 2, 2, 'y'); // mittens on the rim
  b.rect(7, 12, 1, 3, 'n'); b.rect(10, 12, 1, 3, 'n');
  b.outline('k');
  return b;
}

// --- Build everything ---------------------------------------------------------------
function buildSprites() {
  BASE.sled = PB.fromRows(SLED_HALF, true);
  BASE.sledBottom = PB.fromRows(SLED_BOTTOM_HALF, true);
  const rider = PB.fromRows(RIDER_HALF, true);
  BASE.rider = rider;
  const both = BASE.sled.clone();
  for (let i = 0; i < both.d.length; i++) if (rider.d[i]) both.d[i] = rider.d[i];
  BASE.player = both;
  BASE.crash = PB.fromRows(CRASH_HALF, true);
  BASE.saucer = makeSaucerKid();

  SPR.pine_big0 = makePine(24, 42, 4, 11);
  SPR.pine_big1 = makePine(22, 38, 4, 23);
  SPR.pine_med0 = makePine(18, 30, 3, 37);
  SPR.pine_med1 = makePine(16, 28, 3, 41);
  SPR.pine_small0 = makePine(12, 18, 2, 53);
  SPR.pine_small1 = makePine(11, 16, 2, 67);
  SPR.pine_snowy0 = makePine(24, 40, 4, 71, true);
  SPR.pine_snowy1 = makePine(20, 34, 3, 83, true);
  SPR.dead0 = makeDeadTree(5);
  SPR.dead1 = makeDeadTree(9);
  SPR.rock0 = makeRock(12, 8, 3);
  SPR.rock1 = makeRock(10, 7, 8);
  SPR.rockbig0 = makeRock(22, 13, 5);
  SPR.rockbig1 = makeRock(20, 14, 12);
  SPR.stump0 = makeStump();
  SPR.mogul0 = makeMogul(22, 1);
  SPR.mogul1 = makeMogul(18, 2);
  SPR.ramp = makeRamp();
  SPR.snowman0 = makeSnowman(3);
  SPR.snowman1 = makeSnowman(8);
  SPR.snowpile = makeSnowPile();
  SPR.flag_r = makeFlag('r');
  SPR.flag_b = makeFlag('b');
  SPR.pole = makePole();
  SPR.sign = makeSignPost();
  SPR.lodge = makeLodge();
  SPR.plow0 = makePlow(true);
  SPR.plow1 = makePlow(false);

  const dog = rows => { const p = PB.fromRows(rows).outline('k'); return [p.sprite(p.w / 2, p.h - 1), p.flipX().sprite(p.w / 2, p.h - 1)]; };
  [SPR.dogA_r, SPR.dogA_l] = dog(DOG_A);
  [SPR.dogB_r, SPR.dogB_l] = dog(DOG_B);
  [SPR.dogSit_r, SPR.dogSit_l] = dog(DOG_SIT);
  [SPR.xcA_r, SPR.xcA_l] = dog(XC_A);
  [SPR.xcB_r, SPR.xcB_l] = dog(XC_B);
  SPR.crash = BASE.crash.sprite();
}
