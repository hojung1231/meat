import * as P from './physics.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const INK = '#22160e';
const TILT = 0.78; // 비스듬히 내려다보는 시점: 세로 방향 압축

// ---------- 안드로이드 연동 (앱 안에서만 동작, 브라우저에서는 조용히 무시) ----------
const plugins = window.Capacitor?.Plugins || {};
function haptic(style = 'LIGHT') {
  try { plugins.Haptics?.impact?.({style}); } catch {}
}
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
  else if (running && !paused) openMenu();
});
try { plugins.App?.addListener?.('backButton', onBack); } catch {}
function onBack() {
  if (!$('panel').hidden) return closePanel();
  if (!$('menu').hidden) return resume();
  if (!$('result').hidden) return toSetup();
  if (!$('setup').hidden) return plugins.App?.exitApp?.();
  openMenu();
}

// ---------- 색 ----------
const DONE_STOPS = [
  [0, [124, 20, 40]], [40, [140, 24, 44]], [48, [170, 32, 52]], [53, [192, 46, 60]],
  [57, [208, 76, 82]], [61, [218, 112, 108]], [65, [208, 146, 132]], [69, [182, 142, 126]],
  [75, [156, 122, 106]], [90, [136, 104, 88]],
];
const CRUST_STOPS = [[0.3, [182, 126, 86]], [1, [170, 96, 46]], [2.2, [128, 64, 26]], [3.6, [90, 41, 16]], [5, [50, 24, 11]], [7, [22, 13, 8]]];
const DRY = [162, 116, 80];
const HEAT_STOPS = [
  [0, [36, 54, 150]], [25, [40, 140, 200]], [45, [70, 196, 140]], [55, [190, 214, 70]], [62, [246, 196, 52]],
  [75, [240, 128, 40]], [100, [216, 48, 40]], [150, [140, 20, 70]], [210, [250, 236, 236]],
];
function lerpStops(stops, v) {
  if (v <= stops[0][0]) return stops[0][1].slice();
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const t = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return stops[stops.length - 1][1].slice();
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
function cellColor(tp, b, w) {
  let c = lerpStops(DONE_STOPS, tp);
  const d = clamp((0.7 * P.W0 - w) / (0.5 * P.W0), 0, 1);
  if (d > 0) c = mix(c, DRY, d);
  if (b > 0.01) c = b < 0.3 ? mix(c, CRUST_STOPS[0][1], b / 0.3) : lerpStops(CRUST_STOPS, b);
  return c;
}

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function offscreen(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---------- 난이도 ----------
const LEVELS = {
  home: {name: '일반인', note: '중심 온도, 그래프, 단면 투시, 안내까지 전부', orbs: ['probe', 'temps', 'side', 'cut', 'heat', 'graph', 'log'], clock: true, bubble: 'all'},
  junior: {name: '말단셰프', note: '팬 온도계, 시계, 고기 옆면만. 경고만 알려 줌', orbs: ['temps', 'side', 'log'], clock: true, bubble: 'warn'},
  sous: {name: '수셰프', note: '아무것도 없음. 색과 소리만 보고 굽기', orbs: [], clock: false, bubble: 'none'},
};
const ORBS = {
  probe: {title: '중심 온도 (탐침)', color: '#ff8a5c', icon: '<path d="M10 4.5a2 2 0 0 1 4 0V14a4 4 0 1 1-4 0z"/><path d="M12 10v6"/>'},
  temps: {title: '온도계', color: '#7cc6ff', icon: '<circle cx="10" cy="14" r="6"/><path d="M16 14h6M10 4v3M6 5l1.5 2.5M14 5l-1.5 2.5"/>'},
  side: {title: '고기 옆면', color: '#ffd54d', icon: '<rect x="3" y="7" width="18" height="10" rx="3"/><path d="M3 10.5h18M3 13.5h18"/>'},
  cut: {title: '단면 투시', color: '#ff9fb0', icon: '<path d="M3 21 16 8l3 3L8 21z"/><path d="M16 8l3-4 2 2-2 5"/>'},
  heat: {title: '열화상', color: '#ffb347', icon: '<path d="M12 3c3 4 6 6.5 6 10.5a6 6 0 0 1-12 0c0-3 2-4.5 3-7 1 2 2 3 3 3 0-2 0-4 0-6.5z"/>'},
  graph: {title: '두께별 온도', color: '#9be08a', icon: '<path d="M3 20h18"/><path d="M4 7c3 9 6 9 8 9s5 0 8-9"/>'},
  log: {title: '굽기 기록', color: '#d7b3ff', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>'},
};

// ---------- 상태 ----------
let cfg = {target: P.DONENESS[1], pan: 'castiron', start: 4, level: 'home'};
let sim = P.createSim({pan: cfg.pan, startTemp: cfg.start});
let running = false;
let paused = false;
let speed = 4;
const SPEEDS = [1, 4, 16, 32, 64];
let soundOn = true;
let steakPos = {x: 0, y: 0};
let tween = null;
let flipAnim = null;
let drag = null;
let particles = [];
let popups = [];
let hist = [];
let histNext = 0;
let panelId = null;
let lastUi = 0;
let lastPanel = 0;
let nextSizzleText = 0;
let lastBurnText = 0;
let resultShown = false;

// ---------- 화면 배치 ----------
const scene = $('scene');
const g = scene.getContext('2d');
let DPR = 1;
const L = {};
let bg = null;
let panSprite = null;

function layout() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const W = window.innerWidth, H = window.innerHeight;
  scene.width = Math.round(W * DPR);
  scene.height = Math.round(H * DPR);
  const ctrlH = $('controls').offsetHeight;
  document.documentElement.style.setProperty('--controls-h', `${ctrlH}px`);
  const safeTop = parseFloat(getComputedStyle($('hud').querySelector('.hud-top')).paddingTop) || 10;
  const top = safeTop + 56, bottom = H - ctrlH - 6;
  const uh = Math.max(200, bottom - top);
  const land = W > uh * 1.35;
  let R;
  Object.assign(L, {W, H, top, bottom, land});
  if (land) {
    R = Math.min((uh - 16) / (2 * TILT + 0.3), W * 0.27);
    L.panX = W * 0.62;
    L.panY = top + uh / 2 + R * 0.05;
  } else {
    R = Math.min((uh - 30) / 2.95, W * 0.4);
    L.panX = W / 2;
    L.panY = bottom - R * TILT - R * 0.12;
  }
  L.R = R;
  L.k = R / 170;
  L.sw = (R * 100) / 130;
  L.sh = ((R * 120) / 130) * TILT;
  L.thick = ((R * 30) / 130) * 0.62;
  const bw = L.sw * 1.55, bh = L.sh * 1.45 + L.thick * 1.6;
  if (land) {
    L.board = {cx: Math.max(bw / 2 + 14, (L.panX - R * 1.15) / 2 + 4), cy: L.panY, w: bw, h: bh};
  } else {
    const panTop = L.panY - R * TILT - R * 0.14;
    L.board = {cx: W / 2, cy: Math.min(top + bh / 2 + 6, panTop - bh / 2 - 8), w: bw, h: bh};
    L.board.cy = Math.max(L.board.cy, top + bh / 2 - 30);
  }
  L.pos = {
    board: {x: L.board.cx, y: L.board.cy - L.thick / 2},
    pan: {x: L.panX, y: L.panY - L.thick / 2},
  };
  bg = buildBackground();
  panSprite = buildPan();
  if (!drag && !tween) steakPos = {...L.pos[sim.place]};
}

function inkStroke(c, w) {
  c.strokeStyle = INK;
  c.lineWidth = w;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.stroke();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 바탕: 체크무늬 조리대, 가스레인지 상판, 도마 (배치가 바뀔 때만 다시 그림)
function buildBackground() {
  const {W, H, k, R} = L;
  const c = offscreen(Math.round(W * DPR), Math.round(H * DPR));
  const b = c.getContext('2d');
  b.scale(DPR, DPR);
  // 조리대 타일
  const tile = 46 * Math.max(0.8, k);
  for (let y = -tile; y < H + tile; y += tile) {
    for (let x = -tile; x < W + tile; x += tile) {
      const odd = (Math.round(x / tile) + Math.round(y / tile)) % 2 === 0;
      b.fillStyle = odd ? '#f3e0b5' : '#5fae9e';
      b.fillRect(x, y, tile, tile);
    }
  }
  b.strokeStyle = 'rgba(34,22,14,.35)';
  b.lineWidth = 2;
  for (let x = 0; x < W + tile; x += tile) { b.beginPath(); b.moveTo(x, 0); b.lineTo(x, H); b.stroke(); }
  for (let y = 0; y < H + tile; y += tile) { b.beginPath(); b.moveTo(0, y); b.lineTo(W, y); b.stroke(); }
  // 붓질 느낌의 얼룩과 가장자리 어둡게
  const r = rng(21);
  for (let i = 0; i < 60; i++) {
    b.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`;
    b.beginPath();
    b.ellipse(r() * W, r() * H, 20 + r() * 80, 6 + r() * 20, r() * 3, 0, Math.PI * 2);
    b.fill();
  }
  const vg = b.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.3, W / 2, H * 0.45, Math.max(W, H) * 0.8);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,10,5,.55)');
  b.fillStyle = vg;
  b.fillRect(0, 0, W, H);

  // 가스레인지 상판
  const sx = L.panX - R * 1.28, sy = L.panY - R * TILT * 1.42, sw = R * 2.56, sh = R * TILT * 2.84;
  b.fillStyle = 'rgba(0,0,0,.35)';
  roundRect(b, sx + 6 * k, sy + 10 * k, sw, sh, 30 * k);
  b.fill();
  roundRect(b, sx, sy, sw, sh, 30 * k);
  const sg = b.createLinearGradient(sx, sy, sx + sw, sy + sh);
  sg.addColorStop(0, '#3b3d44');
  sg.addColorStop(1, '#1b1c21');
  b.fillStyle = sg;
  b.fill();
  inkStroke(b, 4 * k);
  b.strokeStyle = 'rgba(255,255,255,.35)';
  b.lineWidth = 5 * k;
  b.beginPath();
  b.moveTo(sx + 30 * k, sy + 14 * k);
  b.lineTo(sx + sw * 0.35, sy + 14 * k);
  b.stroke();
  // 삼발이
  for (let a = 0; a < 4; a++) {
    const ang = (a / 4) * Math.PI * 2 + Math.PI / 4;
    const x0 = L.panX + Math.cos(ang) * R * 0.95, y0 = L.panY + Math.sin(ang) * R * TILT * 0.95;
    const x1 = L.panX + Math.cos(ang) * R * 1.22, y1 = L.panY + Math.sin(ang) * R * TILT * 1.22;
    b.beginPath();
    b.moveTo(x0, y0);
    b.lineTo(x1, y1);
    b.strokeStyle = INK;
    b.lineWidth = 12 * k;
    b.lineCap = 'round';
    b.stroke();
    b.strokeStyle = '#55585f';
    b.lineWidth = 6 * k;
    b.stroke();
  }
  // 버너 링
  b.beginPath();
  b.ellipse(L.panX, L.panY, R * 0.55, R * 0.55 * TILT, 0, 0, Math.PI * 2);
  b.fillStyle = '#2b2c31';
  b.fill();
  inkStroke(b, 3 * k);

  // 도마
  const {cx, cy, w, h} = L.board;
  const x = cx - w / 2, y = cy - h / 2;
  b.fillStyle = 'rgba(0,0,0,.35)';
  roundRect(b, x + 6 * k, y + 12 * k, w, h, 22 * k);
  b.fill();
  roundRect(b, x, y + 8 * k, w, h, 22 * k);
  b.fillStyle = '#9a6331';
  b.fill();
  inkStroke(b, 4 * k);
  roundRect(b, x, y, w, h, 22 * k);
  const wg = b.createLinearGradient(x, y, x + w, y + h);
  wg.addColorStop(0, '#e2a865');
  wg.addColorStop(1, '#c98b4c');
  b.fillStyle = wg;
  b.fill();
  b.save();
  b.clip();
  const wr = rng(4);
  b.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const yy = y + wr() * h;
    b.strokeStyle = `rgba(120,70,30,${0.25 + wr() * 0.3})`;
    b.lineWidth = (1 + wr() * 2.2) * k;
    b.beginPath();
    b.moveTo(x - 10, yy);
    b.bezierCurveTo(x + w * 0.3, yy + (wr() - 0.5) * 18 * k, x + w * 0.7, yy + (wr() - 0.5) * 18 * k, x + w + 10, yy + (wr() - 0.5) * 10 * k);
    b.stroke();
  }
  b.restore();
  roundRect(b, x, y, w, h, 22 * k);
  inkStroke(b, 4 * k);
  // 손잡이 구멍
  b.beginPath();
  b.ellipse(x + w - 26 * k, y + 24 * k, 10 * k, 7 * k, 0, 0, Math.PI * 2);
  b.fillStyle = '#7b4b22';
  b.fill();
  inkStroke(b, 3 * k);
  // 하이라이트
  b.strokeStyle = 'rgba(255,240,210,.7)';
  b.lineWidth = 5 * k;
  b.beginPath();
  b.moveTo(x + 18 * k, y + h - 16 * k);
  b.lineTo(x + 18 * k, y + h * 0.55);
  b.stroke();
  return c;
}

const PAN_LOOK = {
  castiron: {rim: '#3a3a3f', floor: ['#4a4a50', '#232327'], handle: '#2e2e33', shine: 'rgba(255,255,255,.45)'},
  stainless: {rim: '#cfd5da', floor: ['#e6eaed', '#a8b0b6'], handle: '#b9c0c6', shine: 'rgba(255,255,255,.9)'},
  nonstick: {rim: '#2a2a2e', floor: ['#3b3c42', '#1c1c20'], handle: '#d94a2a', shine: 'rgba(255,255,255,.4)'},
};

// 팬 그림 (배치나 팬 종류가 바뀔 때만 다시 그림). 화면 좌표 그대로 그린 전체 크기 캔버스
function buildPan() {
  const {W, H, R, k} = L;
  const c = offscreen(Math.round(W * DPR), Math.round(H * DPR));
  const p = c.getContext('2d');
  p.scale(DPR, DPR);
  const look = PAN_LOOK[sim.panType];
  const cx = L.panX, cy = L.panY;
  // 손잡이
  const ang = L.land ? 0 : 0.42;
  p.save();
  p.translate(cx, cy);
  p.rotate(ang);
  roundRect(p, R * 0.9, -R * 0.11, R * 0.95, R * 0.22, R * 0.1);
  p.fillStyle = look.handle;
  p.fill();
  inkStroke(p, 4 * k);
  p.beginPath();
  p.arc(R * 1.68, 0, R * 0.045, 0, Math.PI * 2);
  p.fillStyle = '#1d1410';
  p.fill();
  inkStroke(p, 2.5 * k);
  p.strokeStyle = 'rgba(255,255,255,.35)';
  p.lineWidth = 3 * k;
  p.beginPath();
  p.moveTo(R * 1.0, -R * 0.06);
  p.lineTo(R * 1.5, -R * 0.06);
  p.stroke();
  p.restore();
  // 팬 그림자와 테두리
  p.beginPath();
  p.ellipse(cx + 6 * k, cy + 12 * k, R * 1.02, R * TILT * 1.02, 0, 0, Math.PI * 2);
  p.fillStyle = 'rgba(0,0,0,.35)';
  p.fill();
  p.beginPath();
  p.ellipse(cx, cy + R * 0.06, R, R * TILT, 0, 0, Math.PI * 2);
  p.fillStyle = look.rim;
  p.fill();
  inkStroke(p, 4.5 * k);
  p.beginPath();
  p.ellipse(cx, cy, R, R * TILT, 0, 0, Math.PI * 2);
  p.fillStyle = look.rim;
  p.fill();
  inkStroke(p, 4.5 * k);
  // 바닥
  p.beginPath();
  p.ellipse(cx, cy + R * 0.02, R * 0.88, R * TILT * 0.86, 0, 0, Math.PI * 2);
  const fg = p.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 0.9);
  fg.addColorStop(0, look.floor[0]);
  fg.addColorStop(1, look.floor[1]);
  p.fillStyle = fg;
  p.fill();
  inkStroke(p, 3 * k);
  // 만화식 반짝임
  p.strokeStyle = look.shine;
  p.lineCap = 'round';
  p.lineWidth = 7 * k;
  p.beginPath();
  p.ellipse(cx, cy, R * 0.94, R * TILT * 0.94, 0, Math.PI * 1.08, Math.PI * 1.32);
  p.stroke();
  p.lineWidth = 4 * k;
  p.beginPath();
  p.ellipse(cx, cy, R * 0.94, R * TILT * 0.94, 0, Math.PI * 1.38, Math.PI * 1.44);
  p.stroke();
  p.lineWidth = 5 * k;
  p.beginPath();
  p.ellipse(cx, cy + R * 0.02, R * 0.78, R * TILT * 0.76, 0, Math.PI * 0.1, Math.PI * 0.32);
  p.stroke();
  return c;
}

// ---------- 고기 그림 재료 ----------
const steakShape = (() => {
  const pts = [], r = rng(5), ph = r() * 6, ph2 = r() * 6;
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const n = 3.0;
    const x = Math.sign(c) * Math.abs(c) ** (2 / n), y = Math.sign(s) * Math.abs(s) ** (2 / n);
    const kk = 1 + 0.045 * Math.sin(3 * a + ph) + 0.025 * Math.sin(7 * a + ph2);
    pts.push([x * kk * 0.5, y * kk * 0.5]);
  }
  return pts;
})();
function steakPath(c, x, y, w, h) {
  c.beginPath();
  steakShape.forEach(([px, py], i) => (i ? c.lineTo(x + px * w, y + py * h) : c.moveTo(x + px * w, y + py * h)));
  c.closePath();
}
const marbling = (() => {
  const c = offscreen(240, 240), m = c.getContext('2d'), r = rng(7);
  m.lineCap = 'round';
  for (let i = 0; i < 22; i++) {
    m.strokeStyle = `rgba(255,244,232,${0.35 + r() * 0.4})`;
    m.lineWidth = 1 + r() * 3;
    m.beginPath();
    let x = r() * 240, y = r() * 240;
    m.moveTo(x, y);
    for (let k = 0; k < 3; k++) {
      const nx = x + (r() - 0.5) * 90, ny = y + (r() - 0.3) * 60;
      m.quadraticCurveTo(x + (r() - 0.5) * 60, y + (r() - 0.5) * 60, nx, ny);
      x = nx; y = ny;
    }
    m.stroke();
  }
  return c;
})();
// 크러스트 얼룩 (갈변이 진할수록 진하게 덮음)
const crustTex = (() => {
  const c = offscreen(256, 256), m = c.getContext('2d'), r = rng(13);
  for (let i = 0; i < 140; i++) {
    const x = r() * 256, y = r() * 256, rad = 6 + r() * 26;
    const gr = m.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(40,16,6,${0.35 + r() * 0.4})`);
    gr.addColorStop(1, 'rgba(40,16,6,0)');
    m.fillStyle = gr;
    m.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 500; i++) {
    m.fillStyle = `rgba(30,12,4,${0.2 + r() * 0.5})`;
    m.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
  }
  return c;
})();
const glints = (() => {
  const r = rng(17);
  return Array.from({length: 9}, () => ({x: (r() - 0.5) * 0.7, y: (r() - 0.5) * 0.6, s: 0.6 + r(), ph: r() * 6}));
})();

// 고기 색 정보: 윗면은 폭 방향 10단계, 옆면은 두께 방향 전체
function steakLook() {
  const top = [], side = [];
  const zt = P.NZ - 1;
  let b = 0, w = 0;
  for (let s = 0; s < 10; s++) {
    let acc = [0, 0, 0];
    for (let x = s * 5; x < s * 5 + 5; x++) {
      const i = zt * P.NX + x;
      const c = cellColor(sim.Tpeak[i], sim.B[i], sim.W[i]);
      acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]];
      b += sim.B[i];
      w += sim.W[i];
    }
    top.push([acc[0] / 5, acc[1] / 5, acc[2] / 5]);
  }
  for (let z = 0; z < P.NZ; z++) {
    const i = z * P.NX;
    side.push(cellColor(sim.Tpeak[i], sim.B[i], sim.W[i]));
  }
  return {top, side, b: b / P.NX, wet: w / P.NX / P.W0, topT: P.surfaceTemp(sim, true)};
}

// ---------- 그리기 ----------
function drawFlames(now) {
  if (sim.level <= 0) return;
  const {R, k} = L;
  const n = 30;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const fl = Math.sin(now / 90 + i * 2.1) * 0.5 + Math.sin(now / 47 + i * 1.3) * 0.5;
    const len = R * (0.07 + sim.level * 0.016) * (1 + fl * 0.18);
    const r0 = 0.9;
    const bx = L.panX + Math.cos(a) * R * r0, by = L.panY + Math.sin(a) * R * TILT * r0;
    const tx = L.panX + Math.cos(a) * (R * r0 + len + R * 0.1), ty = L.panY + Math.sin(a) * (R * TILT * r0 + (len + R * 0.1) * TILT) - len * 0.25;
    const nx = -Math.sin(a), ny = Math.cos(a) * TILT;
    const wdt = R * 0.055;
    g.beginPath();
    g.moveTo(bx + nx * wdt, by + ny * wdt);
    g.quadraticCurveTo(tx + nx * wdt * 0.6, ty + ny * wdt * 0.6, tx, ty);
    g.quadraticCurveTo(tx - nx * wdt * 0.6, ty - ny * wdt * 0.6, bx - nx * wdt, by - ny * wdt);
    g.closePath();
    g.fillStyle = '#3b74ff';
    g.fill();
    g.strokeStyle = '#13265e';
    g.lineWidth = 2 * k;
    g.stroke();
    g.beginPath();
    const mx = bx + (tx - bx) * 0.55, my = by + (ty - by) * 0.55;
    g.ellipse(mx, my, wdt * 0.45, wdt * 0.8, a + Math.PI / 2, 0, Math.PI * 2);
    g.fillStyle = '#bfe0ff';
    g.fill();
  }
}

function drawPanContents(now) {
  const {R, k} = L;
  const cx = L.panX, cy = L.panY;
  g.save();
  g.beginPath();
  g.ellipse(cx, cy + R * 0.02, R * 0.88, R * TILT * 0.86, 0, 0, Math.PI * 2);
  g.clip();
  // 달궈진 팬의 열기
  if (sim.panT > 120) {
    g.fillStyle = `rgba(255,120,40,${clamp((sim.panT - 120) / 600, 0, 0.22)})`;
    g.fillRect(cx - R, cy - R, R * 2, R * 2);
  }
  if (sim.oil) {
    g.beginPath();
    g.ellipse(cx, cy + R * 0.04, R * 0.72, R * TILT * 0.68, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(232,184,60,.28)';
    g.fill();
    g.strokeStyle = 'rgba(255,236,170,.7)';
    g.lineWidth = 3 * k;
    g.beginPath();
    g.ellipse(cx, cy + R * 0.04, R * 0.62, R * TILT * 0.58, 0, Math.PI * 1.1 + Math.sin(now / 700) * 0.1, Math.PI * 1.35);
    g.stroke();
    if (sim.panT > 150) {
      g.strokeStyle = `rgba(255,240,200,${clamp((sim.panT - 150) / 300, 0.1, 0.4)})`;
      g.lineWidth = 1.6 * k;
      for (let i = 0; i < 4; i++) {
        const rr = R * (0.25 + i * 0.12) + Math.sin(now / 300 + i) * 3;
        g.beginPath();
        g.ellipse(cx, cy, rr, rr * TILT, 0, now / 1400 + i, now / 1400 + i + 0.8);
        g.stroke();
      }
    }
  }
  // 육즙이 눌어붙은 자국
  if (sim.dripped > 0.0005) {
    const a = clamp(sim.dripped * 16, 0, 0.7);
    const r = rng(9);
    for (let i = 0; i < 16; i++) {
      const ang = r() * Math.PI * 2;
      const rad = L.sw * 0.58 + r() * R * 0.18;
      g.fillStyle = `rgba(96,46,18,${a * (0.4 + r() * 0.6)})`;
      g.beginPath();
      g.ellipse(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * TILT, (6 + r() * 14) * k, (4 + r() * 8) * k, ang, 0, Math.PI * 2);
      g.fill();
    }
  }
  // 버터 거품
  if (sim.basting) {
    for (let i = 0; i < 26; i++) {
      const ang = (i / 26) * Math.PI * 2 + now / 800;
      const rad = L.sw * 0.6 + Math.sin(now / 160 + i) * 6 * k;
      g.beginPath();
      g.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * TILT, (7 + (i % 3) * 3) * k, 0, Math.PI * 2);
      g.fillStyle = '#ffe28a';
      g.fill();
      g.strokeStyle = 'rgba(34,22,14,.5)';
      g.lineWidth = 1.5 * k;
      g.stroke();
    }
  }
  g.restore();
}

function drawSteak(now) {
  const {k, R} = L;
  let look = steakLook();
  let {x, y} = steakPos;
  let lift = 0, sy = 1, sx = 1;
  if (flipAnim) {
    flipAnim.t = Math.min(1, flipAnim.t + 1 / 30);
    const t = flipAnim.t;
    lift = Math.sin(Math.PI * Math.min(1, t / 0.85)) * R * 0.5;
    sy = Math.abs(Math.cos(Math.PI * Math.min(1, t / 0.85)));
    if (t < 0.425) look = flipAnim.before;
    if (t > 0.85) {
      const q = (t - 0.85) / 0.15;
      sy = 1 - 0.18 * Math.sin(Math.PI * q);
      sx = 1 + 0.12 * Math.sin(Math.PI * q);
    }
    if (t >= 1) flipAnim = null;
  }
  if (tween) {
    tween.t = Math.min(1, tween.t + 1 / 26);
    const e = 1 - (1 - tween.t) ** 3;
    x = tween.from.x + (tween.to.x - tween.from.x) * e;
    y = tween.from.y + (tween.to.y - tween.from.y) * e;
    lift = Math.max(lift, Math.sin(Math.PI * tween.t) * R * 0.35);
    steakPos = {x, y};
    if (tween.t >= 1) {
      tween = null;
      if (sim.place === 'pan' && sim.panT > 150) popup('치이익!', x, y - L.sh, 1.3, '#ffe14d');
      thump();
    }
  }
  if (drag) lift = Math.max(lift, R * 0.16);
  // 익으면서 수축: 폭은 줄고 두께는 살짝 부푼다
  const loss = clamp((sim.dripped + sim.evaporated) / sim.water0, 0, 0.35);
  const sw = L.sw * (1 - 0.3 * loss) * sx;
  const sh = L.sh * (1 - 0.3 * loss);
  const thick = L.thick * (1 + 0.5 * loss);

  // 그림자
  g.beginPath();
  g.ellipse(x + lift * 0.12, y + thick + 4 * k, sw * 0.52 * (1 - lift / (R * 3)), sh * 0.5 * (1 - lift / (R * 3)), 0, 0, Math.PI * 2);
  g.fillStyle = `rgba(20,10,5,${0.32 - lift / (R * 3)})`;
  g.fill();

  g.save();
  g.translate(x, y - lift + (thick * (1 - sy)) / 2);
  g.scale(1, Math.max(0.04, sy));
  // 옆면: 아래(팬 쪽)부터 위로 얇은 층을 쌓아 익은 띠를 그대로 보여 준다
  const steps = Math.max(8, Math.round(thick / 1.5));
  for (let s = steps; s >= 0; s--) {
    const d = (s / steps) * thick;
    const z = Math.round((1 - s / steps) * (P.NZ - 1));
    steakPath(g, 0, d, sw, sh);
    g.fillStyle = rgb(mix(look.side[z], [40, 20, 12], 0.12));
    g.fill();
  }
  steakPath(g, 0, thick, sw, sh);
  inkStroke(g, 3.5 * k);
  g.beginPath();
  g.moveTo(-sw / 2, 0);
  g.lineTo(-sw / 2, thick);
  g.moveTo(sw / 2, 0);
  g.lineTo(sw / 2, thick);
  inkStroke(g, 3 * k);
  // 윗면
  steakPath(g, 0, 0, sw, sh);
  const tg = g.createLinearGradient(-sw / 2, 0, sw / 2, 0);
  look.top.forEach((c, i) => tg.addColorStop(i / 9, rgb(c)));
  g.fillStyle = tg;
  g.fill();
  g.save();
  g.clip();
  // 지방 테두리 (먼 쪽 가장자리)
  g.beginPath();
  for (let i = 38; i <= 58; i++) {
    const [px, py] = steakShape[i % 64];
    i === 38 ? g.moveTo(px * sw, py * sh) : g.lineTo(px * sw, py * sh);
  }
  g.strokeStyle = rgb(mix([246, 232, 205], [196, 128, 58], clamp(look.b / 2.5, 0, 1)));
  g.lineWidth = 16 * k;
  g.lineCap = 'round';
  g.stroke();
  // 마블링: 익고 갈변할수록 흐려진다
  g.globalAlpha = clamp(0.8 - look.b * 0.3, 0.08, 0.8);
  g.drawImage(marbling, -sw / 2, -sh / 2, sw, sh);
  // 크러스트 얼룩
  g.globalAlpha = clamp(look.b / 3.2, 0, 0.75);
  g.globalCompositeOperation = 'multiply';
  g.drawImage(crustTex, -sw / 2, -sh / 2, sw, sh);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  // 셀 셰이딩: 왼쪽 위 밝게, 오른쪽 아래 어둡게
  const hl = g.createRadialGradient(-sw * 0.22, -sh * 0.25, 0, -sw * 0.22, -sh * 0.25, sw * 0.45);
  hl.addColorStop(0, 'rgba(255,255,255,.22)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.fillRect(-sw, -sh, sw * 2, sh * 2);
  g.beginPath();
  g.ellipse(sw * 0.12, sh * 0.2, sw * 0.62, sh * 0.6, 0, 0, Math.PI * 2);
  g.ellipse(sw * 0.02, sh * 0.06, sw * 0.62, sh * 0.6, 0, 0, Math.PI * 2, true);
  g.fillStyle = 'rgba(30,10,4,.16)';
  g.fill('evenodd');
  // 촉촉한 반짝임: 겉이 젖어 있고 뜨거울수록 반짝인다
  const sheen = clamp(look.wet * 1.3 - 0.35, 0, 1) * (0.5 + clamp((look.topT - 20) / 60, 0, 0.5));
  if (sheen > 0.05) {
    for (const p of glints) {
      const a = sheen * (0.5 + 0.5 * Math.sin(now / 260 + p.ph));
      g.fillStyle = `rgba(255,255,255,${a})`;
      g.beginPath();
      g.ellipse(p.x * sw, p.y * sh, 3.2 * k * p.s, 1.8 * k * p.s, -0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.restore();
  steakPath(g, 0, 0, sw, sh);
  inkStroke(g, 3.5 * k);
  g.restore();

  // 뒤집을 때 휙 선
  if (flipAnim && flipAnim.t < 0.8) {
    g.strokeStyle = 'rgba(255,255,255,.85)';
    g.lineWidth = 3 * k;
    g.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      g.beginPath();
      g.moveTo(x + sw * 0.62, y - lift + i * 14 * k);
      g.quadraticCurveTo(x + sw * 0.8, y - lift + i * 18 * k - 10 * k, x + sw * 0.9, y - lift + i * 22 * k);
      g.stroke();
    }
  }
}

// ---------- 입자와 의성어 ----------
function popup(text, x, y, size = 1, color = '#fff3c4', rot = (Math.random() - 0.5) * 0.4) {
  popups.push({text, x, y, size, color, rot, life: 1});
  if (popups.length > 12) popups.shift();
}
function spawnParticles(now) {
  const {k} = L;
  const onPan = sim.place === 'pan' && !tween && !drag;
  const steamRate = Math.min(12, sim.steam * 3e4);
  if (Math.random() < steamRate / 60) {
    const a = Math.random() * Math.PI * 2;
    particles.push({kind: 'steam', x: steakPos.x + Math.cos(a) * L.sw * 0.35 * Math.random(), y: steakPos.y + Math.sin(a) * L.sh * 0.3 * Math.random(), vx: (Math.random() - 0.5) * 0.3, vy: -0.7 - Math.random() * 0.7, r: (7 + Math.random() * 7) * k, life: 1, ph: Math.random() * 6});
  }
  const w = P.warnings(sim);
  const smoky = w.includes('oil-smoke') || (onPan && w.includes('burning'));
  // 연기는 팬 가장자리 쪽에서 피어올라 고기를 가리지 않게 한다
  if (smoky && Math.random() < (onPan ? 0.1 : clamp((sim.panT - P.OIL_SMOKE) / 400, 0.02, 0.1))) {
    const a = Math.PI * (1.05 + Math.random() * 0.9);
    particles.push({kind: 'smoke', x: L.panX + Math.cos(a) * L.R * 0.75, y: L.panY + Math.sin(a) * L.R * TILT * 0.75, vx: Math.cos(a) * 0.3, vy: -0.7 - Math.random() * 0.5, r: (9 + Math.random() * 7) * k, life: 1, ph: Math.random() * 6});
  }
  if (onPan && sim.sizzle > 1e-4 && Math.random() < Math.min(0.8, sim.sizzle * 2600)) {
    const a = Math.random() * Math.PI * 2;
    particles.push({kind: 'spat', x: steakPos.x + Math.cos(a) * L.sw * 0.55, y: steakPos.y + L.thick + Math.sin(a) * L.sh * 0.55, vx: Math.cos(a) * 2.6, vy: -2 - Math.random() * 2, r: (2 + Math.random() * 2) * k, life: 1});
  }
  if (onPan && sim.sizzle > 1.5e-4 && now > nextSizzleText) {
    nextSizzleText = now + 1400 + Math.random() * 1200;
    const big = sim.sizzle > 4e-4;
    popup(big ? '지글지글!' : '지글', steakPos.x + (Math.random() - 0.5) * L.sw, steakPos.y - L.sh * 0.6, big ? 1 : 0.75);
  }
  if (onPan && w.includes('burning') && now - lastBurnText > 4000) {
    lastBurnText = now;
    popup('탄다!', steakPos.x, steakPos.y - L.sh * 0.8, 1.2, '#ff7a5c');
  }
  if (particles.length > 260) particles.splice(0, particles.length - 260);
}
function drawParticles(now) {
  const {k} = L;
  particles = particles.filter((p) => p.life > 0);
  for (const p of particles) {
    p.x += p.vx + (p.kind !== 'spat' ? Math.sin(now / 400 + p.ph) * 0.3 : 0);
    p.y += p.vy;
    if (p.kind === 'spat') {
      p.vy += 0.25;
      p.life -= 0.06;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fillStyle = `rgba(255,214,90,${p.life})`;
      g.fill();
      g.strokeStyle = `rgba(34,22,14,${p.life})`;
      g.lineWidth = 1.2 * k;
      g.stroke();
      continue;
    }
    p.life -= p.kind === 'steam' ? 0.014 : 0.012;
    p.r += 0.22 * k;
    const a = p.life * (p.kind === 'steam' ? 0.4 : 0.45);
    const fill = p.kind === 'steam' ? `rgba(255,255,255,${a})` : `rgba(120,118,122,${a})`;
    g.fillStyle = fill;
    g.strokeStyle = `rgba(34,22,14,${a * 0.45})`;
    g.lineWidth = 1.6 * k;
    g.beginPath();
    g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    g.arc(p.x + p.r * 0.8, p.y + p.r * 0.2, p.r * 0.7, 0, Math.PI * 2);
    g.arc(p.x - p.r * 0.75, p.y + p.r * 0.25, p.r * 0.65, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  popups = popups.filter((p) => p.life > 0);
  for (const p of popups) {
    p.life -= 0.014;
    p.y -= 0.5;
    const t = 1 - p.life;
    const s = (t < 0.15 ? 0.6 + (t / 0.15) * 0.55 : 1.15 - Math.min(0.15, (t - 0.15) * 0.4)) * p.size;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.scale(s, s);
    g.globalAlpha = Math.min(1, p.life * 2.5);
    g.font = `${Math.round(30 * k)}px "Black Han Sans", "Jua", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.strokeStyle = INK;
    g.lineWidth = 7 * k;
    g.strokeText(p.text, 0, 0);
    g.fillStyle = p.color;
    g.fillText(p.text, 0, 0);
    g.restore();
  }
}

function drawDropHints() {
  if (!drag || !drag.moved) return;
  const {k, R} = L;
  const over = dropTarget(steakPos.x, steakPos.y);
  g.setLineDash([10 * k, 8 * k]);
  g.lineWidth = 4 * k;
  g.strokeStyle = over === 'pan' ? '#ffe14d' : 'rgba(255,255,255,.6)';
  g.beginPath();
  g.ellipse(L.panX, L.panY, R * 1.06, R * TILT * 1.06, 0, 0, Math.PI * 2);
  g.stroke();
  const b = L.board;
  g.strokeStyle = over === 'board' ? '#ffe14d' : 'rgba(255,255,255,.6)';
  roundRect(g, b.cx - b.w / 2 - 8 * k, b.cy - b.h / 2 - 8 * k, b.w + 16 * k, b.h + 24 * k, 26 * k);
  g.stroke();
  g.setLineDash([]);
}

function render(now) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(bg, 0, 0);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawFlames(now);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(panSprite, 0, 0);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawPanContents(now);
  drawDropHints();
  drawSteak(now);
  spawnParticles(now);
  drawParticles(now);
}

// ---------- 터치: 톡 = 뒤집기, 끌기 = 옮기기 ----------
function hitSteak(px, py) {
  const dx = (px - steakPos.x) / (L.sw * 0.6), dy = (py - (steakPos.y + L.thick / 2)) / (L.sh * 0.6 + L.thick);
  return dx * dx + dy * dy < 1;
}
function dropTarget(px, py) {
  const dx = (px - L.panX) / L.R, dy = (py - L.panY) / (L.R * TILT);
  if (dx * dx + dy * dy < 1.15) return 'pan';
  const b = L.board;
  if (Math.abs(px - b.cx) < b.w / 2 + 30 && Math.abs(py - b.cy) < b.h / 2 + 30) return 'board';
  return null;
}
scene.addEventListener('pointerdown', (e) => {
  if (!running || paused || sim.phase === 'done' || flipAnim || tween) return;
  if (!hitSteak(e.clientX, e.clientY)) {
    if (panelId) closePanel();
    return;
  }
  scene.setPointerCapture(e.pointerId);
  drag = {id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: steakPos.x - e.clientX, oy: steakPos.y - e.clientY, t0: performance.now(), moved: false, from: {...steakPos}};
});
scene.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 12) drag.moved = true;
  if (drag.moved) steakPos = {x: e.clientX + drag.ox, y: e.clientY + drag.oy};
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    if (performance.now() - d.t0 < 500) flipSteak();
    return;
  }
  const target = dropTarget(steakPos.x, steakPos.y);
  if (target && target !== sim.place) moveSteak(target);
  else tween = {from: {...steakPos}, to: {...L.pos[sim.place]}, t: 0};
}
scene.addEventListener('pointerup', endDrag);
scene.addEventListener('pointercancel', endDrag);

// ---------- 조작 ----------
function moveSteak(place) {
  if (!running || paused || sim.phase === 'done') return;
  if (sim.place === place) return;
  if (!P.moveTo(sim, place)) return;
  if (sim.log.length === 1) { hist = []; histNext = 0; }
  tween = {from: {...steakPos}, to: {...L.pos[place]}, t: 0};
  setBaste(false);
  haptic('MEDIUM');
  updateButtons();
}
function flipSteak() {
  if (!running || paused || sim.phase === 'done' || flipAnim) return;
  flipAnim = {t: 0, before: steakLook()};
  P.flip(sim);
  popup('휙!', steakPos.x + L.sw * 0.6, steakPos.y - L.sh * 0.5, 0.9, '#ffffff');
  whoosh();
  haptic('LIGHT');
  updateButtons();
}
function cutSteak() {
  if (!running || paused || !P.cut(sim)) return;
  resultShown = true;
  popup('슥!', steakPos.x, steakPos.y - L.sh * 0.4, 1.4, '#ffffff');
  haptic('HEAVY');
  updateButtons();
  setTimeout(showResult, 650);
}
function setBaste(on) {
  sim.basting = on && running && !paused && sim.phase !== 'done' && sim.place === 'pan';
  $('btnBaste').classList.toggle('on', sim.basting);
}
function setBurner(v) {
  const r = $('burner');
  r.value = clamp(v, 0, 10);
  sim.level = Number(r.value);
  $('burnerVal').textContent = r.value;
}

$('btnFlip').addEventListener('click', flipSteak);
$('btnMove').addEventListener('click', () => moveSteak(sim.place === 'pan' ? 'board' : 'pan'));
$('btnCut').addEventListener('click', cutSteak);
$('btnOil').addEventListener('click', () => {
  if (!running || sim.oil) return;
  sim.oil = true;
  popup('주르륵', L.panX, L.panY - L.R * 0.4, 0.8, '#ffe28a');
  haptic('LIGHT');
  updateButtons();
});
const baste = $('btnBaste');
baste.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  baste.setPointerCapture?.(e.pointerId);
  setBaste(true);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) baste.addEventListener(ev, () => setBaste(false));
baste.addEventListener('contextmenu', (e) => e.preventDefault());
$('burner').addEventListener('input', (e) => setBurner(Number(e.target.value)));
$('burnerDown').addEventListener('click', () => { setBurner(sim.level - 1); haptic('LIGHT'); });
$('burnerUp').addEventListener('click', () => { setBurner(sim.level + 1); haptic('LIGHT'); });
$('btnSpeed').addEventListener('click', () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]));
function setSpeed(s) {
  speed = s;
  $('btnSpeed').textContent = `${s}×`;
}
$('btnMenu').addEventListener('click', openMenu);
$('menuResume').addEventListener('click', resume);
$('menuSound').addEventListener('click', () => {
  soundOn = !soundOn;
  $('menuSound').textContent = soundOn ? '소리 끄기' : '소리 켜기';
});
$('menuRestart').addEventListener('click', toSetup);
$('btnAgain').addEventListener('click', toSetup);
function openMenu() {
  if (!running) return;
  paused = true;
  setBaste(false);
  $('menu').hidden = false;
}
function resume() {
  paused = false;
  $('menu').hidden = true;
}
function toSetup() {
  running = false;
  paused = false;
  $('menu').hidden = true;
  $('result').hidden = true;
  $('setup').hidden = false;
  closePanel();
}

document.addEventListener('keydown', (e) => {
  if (!$('setup').hidden || !$('result').hidden || !$('menu').hidden) return;
  if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) flipSteak(); }
  else if (e.code === 'KeyP' && !e.repeat) moveSteak('pan');
  else if (e.code === 'KeyR' && !e.repeat) moveSteak('board');
  else if (e.code === 'KeyC' && !e.repeat) cutSteak();
  else if (e.code === 'KeyB' && !e.repeat) setBaste(true);
  else if (e.code === 'ArrowUp' || e.code === 'ArrowRight') setBurner(sim.level + 1);
  else if (e.code === 'ArrowDown' || e.code === 'ArrowLeft') setBurner(sim.level - 1);
  else if (/^Digit[1-5]$/.test(e.code)) setSpeed(SPEEDS[Number(e.code.slice(5)) - 1]);
  else if (e.code === 'Escape') openMenu();
});
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyB') setBaste(false);
});

function updateButtons() {
  const live = running && sim.phase !== 'done';
  $('btnFlip').disabled = !live;
  $('btnMove').disabled = !live;
  $('moveLabel').textContent = sim.place === 'pan' ? '도마로' : '팬에 올리기';
  $('btnOil').disabled = !live || sim.oil;
  $('oilLabel').textContent = sim.oil ? '기름 둘렀음' : '기름';
  $('btnBaste').disabled = !live || sim.place !== 'pan';
  $('btnCut').disabled = !live || sim.phase !== 'cooking' || sim.place === 'pan';
}

// ---------- 설정 화면 ----------
function buildSetup() {
  $('pickLevel').innerHTML = Object.entries(LEVELS).map(([id, l], i) =>
    `<label><input type="radio" name="level" id="level-${id}" value="${id}" ${i === 0 ? 'checked' : ''}><span>${l.name}<em>${l.note}</em></span></label>`).join('');
  $('pickDone').innerHTML = P.DONENESS.map((d, i) =>
    `<label><input type="radio" name="done" id="done-${d.id}" value="${i}" ${i === 1 ? 'checked' : ''}><span><i class="dot" style="background:${rgb(cellColor(d.target + 1, 0, P.W0))}"></i>${d.name}<small>${d.target}°C</small></span></label>`).join('');
  $('pickPan').innerHTML = Object.entries(P.PANS).map(([id, p], i) =>
    `<label><input type="radio" name="pan" id="pan-${id}" value="${id}" ${i === 0 ? 'checked' : ''}><span>${p.name}</span></label>`).join('');
  try {
    const last = JSON.parse(localStorage.getItem('even-steak-cfg') || 'null');
    if (last) {
      for (const id of [`done-${P.DONENESS[last.target]?.id}`, `pan-${last.pan}`, `start${last.start}`, `level-${last.level}`]) {
        const el = $(id);
        if (el) el.checked = true;
      }
    }
  } catch {}
}
$('setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const ti = Number(f.get('done'));
  const level = LEVELS[f.get('level')] ? f.get('level') : 'home';
  cfg = {target: P.DONENESS[ti], pan: f.get('pan'), start: Number(f.get('start')), level};
  try { localStorage.setItem('even-steak-cfg', JSON.stringify({target: ti, pan: cfg.pan, start: cfg.start, level})); } catch {}
  initAudio();
  keepAwake();
  newGame();
});

function newGame() {
  sim = P.createSim({pan: cfg.pan, startTemp: cfg.start});
  setBurner(10);
  flipAnim = null; tween = null; drag = null; particles = []; popups = []; hist = []; histNext = 0; resultShown = false;
  running = true;
  paused = false;
  $('setup').hidden = true;
  $('result').hidden = true;
  $('menu').hidden = true;
  const lv = LEVELS[cfg.level];
  $('clock').hidden = !lv.clock;
  buildOrbs(lv.orbs);
  closePanel();
  panSprite = buildPan();
  steakPos = {...L.pos.board};
  updateButtons();
}

// ---------- 힌트 구슬 ----------
function buildOrbs(ids) {
  $('orbs').innerHTML = ids.map((id) =>
    `<button type="button" class="orb" data-orb="${id}" style="--c:${ORBS[id].color}" aria-label="${ORBS[id].title}" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true">${ORBS[id].icon}</svg><span class="tag">${ORBS[id].title}</span></button>`).join('');
  const box = $('orbs');
  box.classList.add('show-tags');
  setTimeout(() => box.classList.remove('show-tags'), 3500);
}
$('orbs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-orb]');
  if (!b) return;
  haptic('LIGHT');
  if (panelId === b.dataset.orb) closePanel();
  else openPanel(b.dataset.orb);
});
$('panelClose').addEventListener('click', closePanel);
function openPanel(id) {
  panelId = id;
  $('panelTitle').textContent = ORBS[id].title;
  for (const b of document.querySelectorAll('[data-orb]')) b.setAttribute('aria-expanded', String(b.dataset.orb === id));
  const body = $('panelBody');
  if (id === 'probe') {
    body.innerHTML = `<div class="big-num" id="pv"></div><div class="sub" id="pvSub"></div><canvas id="pc" width="320" height="120"></canvas>`;
  } else if (id === 'temps') {
    body.innerHTML = `<dl class="rows" id="tv"></dl><p class="sub" id="tvNote"></p>`;
  } else if (id === 'side') {
    body.innerHTML = `<canvas id="pc" width="320" height="130"></canvas><p class="sub">실제 요리사도 보는 정보입니다. 익은 띠가 팬 쪽에서 올라옵니다.</p>`;
  } else if (id === 'cut') {
    body.innerHTML = `<canvas id="pc" width="320" height="130"></canvas><div class="legend" id="lg"></div>`;
  } else if (id === 'heat') {
    body.innerHTML = `<canvas id="pc" width="320" height="130"></canvas><div class="legend" id="lg"></div>`;
  } else if (id === 'graph') {
    body.innerHTML = `<canvas id="pc" width="320" height="190"></canvas><p class="sub">실선은 지금 온도, 점선은 지금까지 최고 온도. 점선이 회색 띠 선을 넘은 층은 분홍기가 사라집니다.</p>`;
  } else if (id === 'log') {
    body.innerHTML = `<dl class="rows" id="lv"></dl><div class="timeline" id="ltl"></div>`;
  }
  if (id === 'cut') $('lg').innerHTML = [['레어', 52], ['미디엄 레어', 56], ['미디엄', 61], ['미디엄 웰', 66], ['웰던', 72]].map(([n, t]) => `<span><i style="background:${rgb(cellColor(t, 0, P.W0))}"></i>${n}</span>`).join('') + `<span><i style="background:${rgb(cellColor(110, 2, 0))}"></i>크러스트</span>`;
  if (id === 'heat') $('lg').innerHTML = [0, 25, 45, 55, 62, 75, 100, 150, 210].map((t) => `<span><i style="background:${rgb(lerpStops(HEAT_STOPS, t))}"></i>${t}°</span>`).join('');
  $('panel').hidden = false;
  updatePanel();
}
function closePanel() {
  panelId = null;
  $('panel').hidden = true;
  for (const b of document.querySelectorAll('[data-orb]')) b.setAttribute('aria-expanded', 'false');
}

function canvas2d(c) {
  if (!c.dataset.w) {
    c.dataset.w = c.width;
    c.dataset.h = c.height;
    c.width *= 2;
    c.height *= 2;
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  return {ctx, w: Number(c.dataset.w), h: Number(c.dataset.h)};
}

const cellCanvas = offscreen(P.NX, P.NZ);
const cellCtx = cellCanvas.getContext('2d');
const cellImg = cellCtx.createImageData(P.NX, P.NZ);
function paintCells(mode) {
  const d = cellImg.data;
  for (let z = 0; z < P.NZ; z++) {
    for (let x = 0; x < P.NX; x++) {
      const i = z * P.NX + x;
      const src = mode === 'side' ? z * P.NX : i;
      const c = mode === 'heat' ? lerpStops(HEAT_STOPS, sim.T[i]) : cellColor(sim.Tpeak[src], sim.B[src], sim.W[src]);
      const o = ((P.NZ - 1 - z) * P.NX + x) * 4;
      const j = mode === 'side' ? Math.sin(x * 1.7 + z * 0.3) * 5 : 0;
      d[o] = c[0] + j; d[o + 1] = c[1] + j; d[o + 2] = c[2] + j; d[o + 3] = 255;
    }
  }
  cellCtx.putImageData(cellImg, 0, 0);
}
function drawSlab(c, mode) {
  const {ctx, w, h} = canvas2d(c);
  ctx.clearRect(0, 0, w, h);
  const x0 = 34, x1 = w - 8, y0 = 16, y1 = h - 22;
  ctx.fillStyle = sim.place === 'pan' ? '#3a3a3f' : '#c98b4c';
  ctx.fillRect(x0 - 6, y1, x1 - x0 + 12, 8);
  paintCells(mode);
  ctx.save();
  roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 10);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cellCanvas, x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
  roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 10);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#6d5a48';
  ctx.font = '11px "Jua", sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const mm of [0, 15, 30]) ctx.fillText(`${mm}`, x0 - 6, y1 - ((y1 - y0) * mm) / 30);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const up = sim.face === 0 ? 'B' : 'A', down = sim.face === 0 ? 'A' : 'B';
  ctx.fillText(`윗면 · 면 ${up}`, x0, y0 - 4);
  ctx.fillText(`${sim.place === 'pan' ? '팬 쪽' : '도마 쪽'} · 면 ${down}`, x0, h - 4);
}
function drawProfileChart(c, peak, temp, target, yMax = 180) {
  const {ctx, w, h} = canvas2d(c);
  ctx.clearRect(0, 0, w, h);
  const pad = {l: 34, r: 8, t: 10, b: 22};
  const X = (z) => pad.l + ((w - pad.l - pad.r) * (z + 0.5)) / P.NZ;
  const Y = (t) => pad.t + (h - pad.t - pad.b) * (1 - clamp(t, 0, yMax) / yMax);
  ctx.font = '11px "Jua", sans-serif';
  ctx.fillStyle = '#6d5a48';
  ctx.strokeStyle = 'rgba(34,22,14,.12)';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = yMax > 120 ? [0, 50, 100, 150] : [0, 30, 60, 90, 120];
  for (const t of ticks) {
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(t));
    ctx.lineTo(w - pad.r, Y(t));
    ctx.stroke();
    ctx.fillText(`${t}°`, pad.l - 5, Y(t));
  }
  const hline = (t, color, dash, label, right) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(pad.l, Y(t));
    ctx.lineTo(w - pad.r, Y(t));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.textAlign = right ? 'right' : 'left';
    ctx.textBaseline = right ? 'top' : 'bottom';
    ctx.fillText(label, right ? w - pad.r - 2 : pad.l + 4, right ? Y(t) + 3 : Y(t) - 2);
  };
  hline(target, '#3aa45a', [], `목표 ${target}°`, true);
  const grayT = P.grayThreshold(target);
  hline(grayT, '#8a7a6a', [3, 4], `회색 띠 ${grayT}°`);
  const line = (arr, color, dash, wdt) => {
    ctx.strokeStyle = color;
    ctx.setLineDash(dash);
    ctx.lineWidth = wdt;
    ctx.beginPath();
    arr.forEach((t, z) => (z ? ctx.lineTo(X(z), Y(t)) : ctx.moveTo(X(z), Y(t))));
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (peak) line(peak, '#6d5a48', [4, 3], 1.6);
  if (temp) line(temp, '#e2482c', [], 3);
  ctx.fillStyle = '#6d5a48';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText('아랫면', pad.l, h - 5);
  ctx.textAlign = 'right';
  ctx.fillText('윗면', w - pad.r, h - 5);
}
function drawSpark(c) {
  const {ctx, w, h} = canvas2d(c);
  ctx.clearRect(0, 0, w, h);
  const pad = {l: 30, r: 8, t: 8, b: 18};
  const tMax = Math.max(300, ...hist.map((p) => p.t));
  const X = (t) => pad.l + ((w - pad.l - pad.r) * t) / tMax;
  const Y = (v) => pad.t + (h - pad.t - pad.b) * (1 - clamp(v, 0, 80) / 80);
  ctx.font = '11px "Jua", sans-serif';
  ctx.fillStyle = '#6d5a48';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of [0, 40, 80]) ctx.fillText(`${t}°`, pad.l - 4, Y(t));
  for (const seg of P.segments(sim)) {
    if (seg.place !== 'pan') continue;
    ctx.fillStyle = 'rgba(226,72,44,.15)';
    ctx.fillRect(X(seg.from), pad.t, Math.max(1, X(seg.to) - X(seg.from)), h - pad.t - pad.b);
  }
  ctx.strokeStyle = '#3aa45a';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(pad.l, Y(cfg.target.target));
  ctx.lineTo(w - pad.r, Y(cfg.target.target));
  ctx.stroke();
  if (hist.length > 1) {
    ctx.strokeStyle = '#e2482c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    hist.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.core)) : ctx.moveTo(X(p.t), Y(p.core))));
    ctx.stroke();
  }
  ctx.fillStyle = '#6d5a48';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${Math.round(tMax / 60)}분`, w - pad.r - 10, h - 3);
  ctx.fillText('0', pad.l, h - 3);
}

const fmtTime = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtShort = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function panLabel(t) {
  if (t < 60) return '차가움';
  if (t < 150) return '데워지는 중';
  if (t < 200) return '중불 정도';
  if (t < 260) return '시어링 온도';
  if (t < 320) return '아주 뜨거움';
  return '과열';
}
function timelineHtml() {
  const total = Math.max(1, sim.cookTime);
  return P.segments(sim).map((s) => {
    const pct = ((s.to - s.from) / total) * 100;
    return `<span class="tl-${s.place}" style="flex:${pct} 0 0">${pct > 14 ? `${s.place === 'pan' ? '팬' : '도마'} ${fmtShort(s.to - s.from)}` : ''}</span>`;
  }).join('');
}

function updatePanel() {
  if (!panelId) return;
  const core = P.coreTemp(sim);
  const target = cfg.target.target;
  if (panelId === 'probe') {
    $('pv').innerHTML = `${core.toFixed(1)}<small>°C</small>`;
    const left = target - core;
    $('pvSub').textContent = `목표 ${target}°C · ${left > 0 ? `${left.toFixed(1)}° 남음` : `${(-left).toFixed(1)}° 넘음`}`;
    drawSpark($('pc'));
  } else if (panelId === 'temps') {
    const rows = [['팬', `${Math.round(sim.panT)}°`], ['고기 윗면', `${Math.round(P.surfaceTemp(sim, true))}°`]];
    if (cfg.level === 'home') rows.push(['고기 아랫면', `${Math.round(P.surfaceTemp(sim, false))}°`]);
    $('tv').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    $('tvNote').textContent = `팬: ${panLabel(sim.panT)}${sim.oil && sim.panT > P.OIL_SMOKE ? ' · 기름 발연점(230°C) 넘음' : ''}`;
  } else if (panelId === 'side') {
    drawSlab($('pc'), 'side');
  } else if (panelId === 'cut') {
    drawSlab($('pc'), 'cut');
  } else if (panelId === 'heat') {
    drawSlab($('pc'), 'heat');
  } else if (panelId === 'graph') {
    drawProfileChart($('pc'), P.columnProfile(sim, 'Tpeak'), P.columnProfile(sim, 'T'), target);
  } else if (panelId === 'log') {
    const [fa, fb] = sim.faceTime;
    $('lv').innerHTML = [['면 A 팬 접촉', fmtShort(fa)], ['면 B 팬 접촉', fmtShort(fb)], ['뒤집기', `${sim.flips}회`], ['팬에 올린 횟수', `${sim.panVisits}회`], ['도마에서 쉰 시간', fmtShort(sim.placeTime.board)]]
      .map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    $('ltl').innerHTML = timelineHtml();
  }
}

// ---------- 말풍선 안내 ----------
function coreRate() {
  if (hist.length < 3) return 0;
  const last = hist[hist.length - 1];
  let j = hist.length - 2;
  while (j > 0 && hist[j].t > last.t - 60) j--;
  const dt = last.t - hist[j].t;
  return dt > 10 ? ((last.core - hist[j].core) / dt) * 60 : 0;
}
function advice(core) {
  if (!running || sim.phase === 'done') return null;
  const w = P.warnings(sim);
  const target = cfg.target.target;
  if (sim.place === 'pan') {
    if (w.includes('burning')) return {text: '겉이 타고 있어요! 불을 줄이고 뒤집거나 도마로 옮기세요.', tone: 'bad'};
    if (w.includes('coating')) return {text: '코팅 팬이 망가지는 온도예요.', tone: 'bad'};
    if (w.includes('oil-smoke')) return {text: '기름에서 연기가 나요 (230°C 넘음).', tone: 'bad'};
    if (sim.B && (() => { let s = 0; for (let x = 10; x < P.NX - 10; x++) s += sim.B[x]; return s / (P.NX - 20); })() > 3.4) return {text: '아랫면 크러스트가 진해요. 뒤집거나 옮길 때예요.'};
    const visit = sim.cookTime - (sim.log[sim.log.length - 1]?.t ?? 0);
    if (sim.panT < 150) return {text: '팬이 식었어요. 지글거림이 약하면 크러스트가 안 생겨요.'};
    if (core >= target) return {text: '벌써 목표 온도예요. 내려도 잔열로 더 올라가요.', tone: 'bad'};
    if (visit > 150) return {text: '한 번에 오래 구우면 겉 아래가 회색으로 익어요. 도마로 옮겨 쉬게 하세요.'};
    if (core >= target - 7) return {text: '잔열을 생각하면 곧 내릴 때예요.'};
    return null;
  }
  if (sim.panT > P.OIL_SMOKE + 40 && sim.oil) return {text: '빈 팬이 과열돼 기름이 타요. 쉬는 동안엔 불을 줄이세요.', tone: 'bad'};
  if (sim.phase === 'prep') {
    if (sim.panT < 150) return {text: '팬을 달구는 중이에요. 오른쪽 위 온도계로 확인하세요. 배속을 올려도 돼요.'};
    if (!sim.oil) return {text: '기름을 두르면 크러스트가 고르게 생겨요.'};
    return {text: sim.panT < 200 ? '거의 다 달궈졌어요.' : '고기를 끌어서 팬에 올리세요!'};
  }
  const rate = coreRate();
  if (rate > 0.15) return {text: `쉬는 중. 겉은 식고 잔열이 들어가 중심이 분당 ${rate.toFixed(1)}° 올라요.`};
  if (core < target - 2) return {text: '잔열이 다 들어갔어요. 불을 조금 줄이고 다시 팬에 올리세요.'};
  return {text: '목표 근처예요. 자르기로 확인해 보세요.'};
}
function updateUi() {
  const lv = LEVELS[cfg.level];
  $('clock').textContent = fmtTime(sim.phase === 'prep' ? sim.time : sim.cookTime);
  let msg = null;
  if (running && !paused && lv.bubble !== 'none') {
    msg = advice(P.coreTemp(sim));
    if (msg && lv.bubble === 'warn' && msg.tone !== 'bad') msg = null;
  }
  const b = $('bubble');
  b.hidden = !msg || !!panelId;
  if (msg) {
    b.textContent = msg.text;
    b.dataset.tone = msg.tone || '';
  }
  updateButtons();
}

// ---------- 소리 ----------
let audio = null;
function initAudio() {
  if (audio) { audio.ac.resume?.(); return; }
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * 0.3 + (Math.random() < 0.0025 ? (Math.random() * 2 - 1) * 2.5 : 0);
    const src = ac.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const gain = ac.createGain();
    gain.gain.value = 0;
    src.connect(hp).connect(gain).connect(ac.destination);
    src.start();
    audio = {ac, gain, buf};
  } catch {}
}
function updateAudio() {
  if (!audio) return;
  const v = soundOn && running && !paused ? Math.min(0.4, Math.sqrt(Math.max(0, sim.sizzle)) * 15) : 0;
  audio.gain.gain.setTargetAtTime(v * (0.75 + Math.random() * 0.5), audio.ac.currentTime, 0.06);
}
function whoosh() {
  if (!audio || !soundOn) return;
  const {ac, buf} = audio;
  const s = ac.createBufferSource();
  s.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 2;
  f.frequency.setValueAtTime(400, ac.currentTime);
  f.frequency.exponentialRampToValueAtTime(3000, ac.currentTime + 0.25);
  const gn = ac.createGain();
  gn.gain.setValueAtTime(0.0001, ac.currentTime);
  gn.gain.exponentialRampToValueAtTime(0.5, ac.currentTime + 0.05);
  gn.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.3);
  s.connect(f).connect(gn).connect(ac.destination);
  s.start();
  s.stop(ac.currentTime + 0.32);
}
function thump() {
  if (!audio || !soundOn) return;
  const {ac} = audio;
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(160, ac.currentTime);
  o.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.15);
  const gn = ac.createGain();
  gn.gain.setValueAtTime(0.5, ac.currentTime);
  gn.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.18);
  o.connect(gn).connect(ac.destination);
  o.start();
  o.stop(ac.currentTime + 0.2);
}

// ---------- 결과 ----------
function showResult() {
  const r = P.evaluate(sim, cfg.target.target);
  closePanel();
  $('resTarget').textContent = `${cfg.target.name} ${cfg.target.target}°C · ${P.PANS[cfg.pan].name} · ${LEVELS[cfg.level].name}`;
  $('resVerdict').textContent = r.verdict;
  $('resScore').textContent = r.score;
  const bar = (name, got, max, detail) => {
    const p = got / max;
    return `<li><span>${name}</span><b>${got} / ${max}</b><div class="track"><div class="fill ${p < 0.4 ? 'low' : p < 0.8 ? 'mid' : ''}" style="width:${p * 100}%"></div></div><small>${detail}</small></li>`;
  };
  const crustWord = (b) => (b < 0.6 ? '창백함' : b < 1.2 ? '연한 갈색' : b <= 3.8 ? '진한 갈색' : b <= 6 ? '거의 탐' : '탐');
  $('resBars').innerHTML = [
    bar('목표 굽기', r.parts.core, 35, `중심 ${r.core.toFixed(1)}°C · 목표 ${r.target}°C`),
    bar('회색 띠', r.parts.band, 20, `${r.grayT}°C 넘게 익은 층 ${r.bandMm.toFixed(0)}mm`),
    bar('위아래 대칭', r.parts.symmetry, 10, `위아래 온도 차 평균 ${r.symmetry.toFixed(1)}°C`),
    bar('크러스트 면 A', r.parts.crustA, 10, `갈변 ${r.browning[0].toFixed(1)} · ${crustWord(r.browning[0])}`),
    bar('크러스트 면 B', r.parts.crustB, 10, `갈변 ${r.browning[1].toFixed(1)} · ${crustWord(r.browning[1])}`),
    bar('육즙', r.parts.juicy, 15, `중량 손실 ${r.lossPct.toFixed(1)}%`),
  ].join('');
  let best = null;
  try {
    const key = `even-steak-best-${cfg.level}-${cfg.target.id}`;
    best = Number(localStorage.getItem(key)) || null;
    if (!best || r.score > best) localStorage.setItem(key, String(r.score));
  } catch {}
  $('resStats').innerHTML = [
    ['굽기 시간', fmtShort(r.cookTime)],
    ['팬 / 도마', `${fmtShort(r.placeTime.pan)} / ${fmtShort(r.placeTime.board)}`],
    ['굽기-휴지 반복', `${r.panVisits}회`],
    ['뒤집기', `${r.flips}회`],
    ['크러스트 두께', `${r.crustMm[0]}mm / ${r.crustMm[1]}mm`],
    ['최고 기록', best && best > r.score ? `${best}점` : `${r.score}점 (새 기록)`],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  $('resTimeline').innerHTML = timelineHtml();
  $('result').hidden = false;
  drawCut();
  drawProfileChart($('resProfile'), r.profile, null, cfg.target.target, 120);
}
function drawCut() {
  const {ctx, w, h} = canvas2d($('resCut'));
  const bgr = ctx.createLinearGradient(0, 0, w, h);
  bgr.addColorStop(0, '#e2a865');
  bgr.addColorStop(1, '#c98b4c');
  ctx.fillStyle = bgr;
  ctx.fillRect(0, 0, w, h);
  const r = rng(4);
  for (let i = 0; i < 16; i++) {
    const yy = r() * h;
    ctx.strokeStyle = `rgba(120,70,30,${0.2 + r() * 0.3})`;
    ctx.lineWidth = 1 + r() * 2;
    ctx.beginPath();
    ctx.moveTo(0, yy);
    ctx.bezierCurveTo(w * 0.3, yy + (r() - 0.5) * 20, w * 0.7, yy + (r() - 0.5) * 20, w, yy);
    ctx.stroke();
  }
  paintCells('cut');
  const x0 = 50, x1 = w - 50, y0 = 70, y1 = h - 60;
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  roundRect(ctx, x0 + 6, y0 + 10, x1 - x0, y1 - y0, 26);
  ctx.fill();
  ctx.save();
  roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 26);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(cellCanvas, x0, y0, x1 - x0, y1 - y0);
  ctx.strokeStyle = 'rgba(255,240,230,.08)';
  ctx.lineWidth = 1.5;
  const rr = rng(11);
  for (let i = 0; i < 24; i++) {
    const yy = y0 + rr() * (y1 - y0);
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.bezierCurveTo(x0 + 200, yy + (rr() - 0.5) * 6, x1 - 200, yy + (rr() - 0.5) * 6, x1, yy);
    ctx.stroke();
  }
  const gl = ctx.createLinearGradient(0, y0, 0, y1);
  gl.addColorStop(0, 'rgba(255,255,255,.18)');
  gl.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = gl;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
  roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 26);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.font = '26px "Black Han Sans", "Jua", sans-serif';
  ctx.lineJoin = 'round';
  const label = (t, x, y, align) => {
    ctx.textAlign = align;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.strokeText(t, x, y);
    ctx.fillStyle = '#fff6df';
    ctx.fillText(t, x, y);
  };
  label(`면 ${sim.face === 0 ? 'B' : 'A'}`, x0 + 6, y0 - 18, 'left');
  label(`면 ${sim.face === 0 ? 'A' : 'B'}`, x0 + 6, y1 + 42, 'left');
  label('두께 30mm', x1 - 6, y1 + 42, 'right');
}

// ---------- 루프 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (running && !paused && sim.phase !== 'done') {
    P.advance(sim, dt * speed);
    if (sim.phase === 'cooking' && sim.cookTime >= histNext) {
      hist.push({t: sim.cookTime, core: P.coreTemp(sim)});
      histNext = sim.cookTime + (speed >= 32 ? 10 : 4);
    }
  }
  render(now);
  if (now - lastUi > 120) {
    lastUi = now;
    updateUi();
    updateAudio();
  }
  if (panelId && now - lastPanel > 200) {
    lastPanel = now;
    updatePanel();
  }
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => layout());
buildSetup();
setSpeed(4);
// 설정 화면 뒤 장면: 도마 위 생고기와 달궈지는 팬
sim.panT = 180;
sim.level = 8;
layout();
updateButtons();
document.fonts?.ready?.then(() => layout());
requestAnimationFrame(frame);

// 자동 테스트용: 주소 끝에 #debug 를 붙이면 상태를 들여다볼 수 있다
if (location.hash === '#debug') window.__game = {get sim() { return sim; }, get look() { return steakLook(); }};
