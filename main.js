/* main.js — 『あなふさぎのよる』UI 層
 * ルールは engine.js のみが持つ。ここは描画・入力・音・セーブだけ。
 */
(() => {
'use strict';

/* ============ セーブ ============ */
const STORAGE_KEY = 'anafusagi_v1';
const SAVE = (() => {
  try { return Object.assign({ cleared: {}, best: {}, muted: false }, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
  catch (e) { return { cleared: {}, best: {}, muted: false }; }
})();
SAVE.best = SAVE.best || {};
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVE)); } catch (e) {} }

/* ============ サウンド（WebAudio ミニSE） ============ */
const Sfx = {
  ctx: null, muted: !!SAVE.muted, bgmTimer: null, bgmStep: 0, duckLvl: 1, duckTimer: null,
  duckFor(ms) {
    this.duckLvl = 0.22;
    if (this.duckTimer) clearTimeout(this.duckTimer);
    this.duckTimer = setTimeout(() => { this.duckLvl = 1; }, ms);
  },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) this.ctx = new AC();
    this.startBgm();
  },
  // 夜の倉庫のゆったりループ（プレイ中のみ鳴る）
  startBgm() {
    if (this.bgmTimer || !this.ctx) return;
    const chords = [
      [220.00, 261.63, 329.63],   // Am
      [174.61, 220.00, 261.63],   // F
      [196.00, 246.94, 293.66],   // G
      [164.81, 196.00, 246.94],   // Em
    ];
    const bass = [110.00, 87.31, 98.00, 82.41];
    // A メロ×2 → B メロ(盛り上げ) → C メロ(しみじみ余韻) → A に戻る（16 ステップ = 4 小節 ×4 パート）
    const melodyA = [523.25, 0, 440.00, 493.88, 0, 659.25, 587.33, 0, 523.25, 0, 440.00, 0, 392.00, 440.00, 0, 0];
    const melodyB = [659.25, 0, 783.99, 659.25, 0, 587.33, 523.25, 0, 587.33, 659.25, 0, 523.25, 0, 493.88, 440.00, 0];
    const melodyC = [440.00, 0, 523.25, 0, 587.33, 659.25, 0, 587.33, 0, 523.25, 0, 466.16, 440.00, 0, 392.00, 0];
    const parts = [melodyA, melodyA, melodyB, melodyC];
    const partVol = [0.016, 0.016, 0.02, 0.019];
    this.bgmTimer = setInterval(() => {
      if (!this.ctx || this.muted || document.hidden) return;
      if (!window.__bgmOk || !window.__bgmOk()) return;
      const d = this.duckLvl; // クリアジングル中は音量を下げる（止めない）
      const bar = Math.floor(this.bgmStep / 4) % chords.length;
      if (this.bgmStep % 4 === 0) {
        chords[bar].forEach((f, i) => this.tone(f, 1.7, 'sine', 0.012 * d, i * 0.04));
        this.tone(bass[bar], 1.2, 'triangle', 0.02 * d);
      }
      const part = Math.floor(this.bgmStep / 16) % parts.length; // A A B C
      const m = parts[part][this.bgmStep % 16];
      if (m) this.tone(m, 0.34, 'triangle', partVol[part] * d, 0.05);
      this.bgmStep++;
    }, 500);
  },
  tone(freq, dur = 0.08, type = 'sine', vol = 0.07, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  slide(f0, f1, dur = 0.2, type = 'sine', vol = 0.06, delay = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
  },
  walk() { this.tone(420 + Math.random() * 60, 0.04, 'triangle', 0.028); },
  wobble() { this.tone(520, 0.045, 'triangle', 0.035); this.tone(440, 0.045, 'triangle', 0.035, 0.06); },
  push() { this.tone(170, 0.07, 'square', 0.045); },
  bonk() { this.tone(110, 0.08, 'square', 0.05); },
  gon(i = 0) { this.tone(170 * Math.pow(0.93, i), 0.08, 'square', 0.09); this.tone(62, 0.1, 'sine', 0.07); },
  scared() { this.tone(620, 0.06, 'triangle', 0.05); this.tone(500, 0.07, 'triangle', 0.05, 0.07); },
  plug() { this.slide(300, 90, 0.16, 'sine', 0.09); this.tone(880, 0.1, 'triangle', 0.05, 0.14); this.tone(1320, 0.12, 'sine', 0.04, 0.2); },
  spawn() { this.slide(140, 520, 0.3, 'sine', 0.05); },
  dodge() { this.slide(700, 1100, 0.09, 'sine', 0.035); },
  holeSlide() { this.slide(180, 120, 0.14, 'sine', 0.06); },
  poof() { this.slide(520, 1080, 0.5, 'sine', 0.028); this.tone(1600, 0.14, 'sine', 0.018, 0.35); },
  clear() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.17, 'triangle', 0.07, i * 0.1)); },
  starTick(i) { this.tone(660 + i * 200, 0.12, 'triangle', 0.08); this.tone(1320 + i * 400, 0.1, 'sine', 0.04, 0.04); },
  perfect() { [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.075, i * 0.075)); this.tone(2093, 0.3, 'sine', 0.05, 0.3); },
  menu() { this.tone(520, 0.05, 'sine', 0.04); },
  ending() { [392, 523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.05, i * 0.35)); },
  toggle() { this.muted = !this.muted; SAVE.muted = this.muted; persist(); },
};

/* ============ DOM ============ */
const $ = id => document.getElementById(id);
const screens = { title: $('screen-title'), select: $('screen-select'), game: $('screen-game'), ending: $('screen-ending') };
const boardEl = $('board'), tilesEl = $('tiles'), objsEl = $('objs'), fxEl = $('fx');
const ovClear = $('ov-clear');
const SOLUTIONS = window.SOLUTIONS || {};

function showScreen(name) {
  for (const k in screens) screens[k].classList.toggle('active', k === name);
  if (name !== 'game') {
    // ゲーム画面を離れるときはクリアオーバーレイも必ず閉じる（表示待ちタイマーも破棄し、あとから浮き出るのを防ぐ）
    if (clearOvTimer) { clearTimeout(clearOvTimer); clearOvTimer = null; }
    ovClear.classList.remove('active');
  }
  if (name === 'title') {
    const hasProgress = LEVELS.some(lv => SAVE.cleared[lv.id]);
    $('btn-continue').style.display = hasProgress ? '' : 'none';
    $('btn-newgame').classList.toggle('primary', !hasProgress);
    titleIndex = 0;
    updateTitleFocus();
  }
}

/* ============ タイトル/レベル選択のキーボード操作 ============ */
let titleIndex = 0;
function titleButtons() {
  return ['btn-continue', 'btn-newgame', 'btn-select'].map(id => $(id))
    .filter(b => b.style.display !== 'none');
}
function updateTitleFocus() {
  const btns = titleButtons();
  titleIndex = Math.max(0, Math.min(btns.length - 1, titleIndex));
  btns.forEach((b, i) => b.classList.toggle('kfocus', i === titleIndex));
}
let selIndex = 0;
let selCards = [];
function updateSelectFocus() {
  selIndex = Math.max(0, Math.min(selCards.length - 1, selIndex));
  selCards.forEach((c, i) => c.classList.toggle('kfocus', i === selIndex));
  const el = selCards[selIndex];
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}

/* ============ ゲーム状態 ============ */
let levelIndex = 0;
let cur = null;             // engine state
let undoStack = [];
let playGen = 0;            // レベル開始/やりなおしのたびに+1。古い試行の遅延コールバック（アニメ・タイマー）が
                             // リセット後の新しい試行の状態を書き換えないよう、各コールバックの先頭で照合する
let cell = 48;
let holeEls = [];           // 穴タイル要素（holes 配列と同順）
let pendingHoleFills = new Set(); // 落下演出が終わるまで「埋まった」見た目を保留する穴のindex
let awaitingConfirm = new Set(); // land済み（ばたばた確定待ち）のスプライト要素。CSSクラスに頼らず明示管理
let playerEl = null;
let boxEls = [];            // {el,x,y,kind}
let ghostEls = [];          // {el,x,y}
let levelEffort = 0;        // whisper 用（リトライしても継続）
let whisperShown = false;
let lastInputAt = 0;
let ended = false;          // エンディング再生中フラグ
let autoplay = null;        // 模範解答再生タイマー
let clearOvTimer = null;    // クリア演出の遅延表示タイマー（レベル移動時に必ず破棄する）
let autoWaitTimer = null;   // 「ばたばた」演出用の自動待ちタイマー（UI側のみ。エンジンには実時間要素を持ち込まない）
let pendingStagger = 0;     // ぎょうれつ演出の残り時間（クリア演出を待たせる）

// BGM を鳴らしてよい状況か（Sfx から参照）。クリア後も止めない（ジングル中はダッキング）
window.__bgmOk = () => screens.game.classList.contains('active') && cur && !ended;

function isUnlocked(i) { return SAVE.unlockAll || i === 0 || !!SAVE.cleared[LEVELS[i - 1].id]; }
function allCleared() { return LEVELS.every(l => SAVE.cleared[l.id]); }

/* ============ レベルせんたく ============ */
function buildSelect() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  selCards = [];
  LEVELS.forEach((lv, i) => {
    const card = document.createElement('button');
    const unlocked = isUnlocked(i);
    const cleared = !!SAVE.cleared[lv.id];
    const perfect = cleared && isPerfectCleared(lv.id);
    card.className = 'level-card' + (unlocked ? '' : ' locked') + (cleared ? ' cleared' : '') + (perfect ? ' perfect' : '');
    if (perfect) card.title = 'Perfect! さいたん手数でクリアずみ';
    card.innerHTML =
      `<div class="t">${lv.time}</div>` +
      `<div class="n">${unlocked ? lv.name : '？？？'}</div>` +
      `<div class="s">${cleared ? '<span class="stars' + (perfect ? ' perfect' : '') + '">' + starStr(starsFor(lv.id)) + '</span>' : unlocked ? '🌙' : '🔒'}</div>` +
      (perfect ? '<div class="pmini">Perfect!</div>' : '');
    if (unlocked) card.addEventListener('click', () => { Sfx.init(); Sfx.menu(); startLevel(i); });
    grid.appendChild(card);
    selCards.push(card);
  });
  // カーソル初期位置: 最初の未クリア（なければ先頭）
  let first = LEVELS.findIndex(lv => !SAVE.cleared[lv.id]);
  if (first === -1) first = 0;
  selIndex = first;
  updateSelectFocus();
}

/* ============ 盤面レイアウト（セルサイズは全面統一。大きい面はカメラが追従） ============ */
const boardWrapEl = $('board-wrap');
let viewW = 0, viewH = 0;
function layout() {
  if (!cur) return;
  const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;
  cell = isTouch ? 44 : 52; // 縮小しない
  document.documentElement.style.setProperty('--cell', cell + 'px');
  const availW = Math.min(window.innerWidth - 16, 940);
  const availH = Math.max(200, window.innerHeight - (isTouch ? 330 : 215));
  const boardW = cur.w * cell, boardH = cur.h * cell;
  viewW = Math.min(boardW, availW);
  viewH = Math.min(boardH, availH);
  boardEl.style.width = boardW + 'px';
  boardEl.style.height = boardH + 'px';
  boardWrapEl.style.width = viewW + 'px';
  boardWrapEl.style.height = viewH + 'px';
  // 全スプライト再配置（アニメなし）
  placeSprite(playerEl, cur.player.x, cur.player.y, true);
  boxEls.forEach(b => placeSprite(b.el, b.x, b.y, true));
  ghostEls.forEach(g => placeSprite(g.el, g.x, g.y, true));
  updateCamera(true);
}
window.addEventListener('resize', layout);

// プレイヤーが常に見えるように盤面をパンする
function updateCamera(instant = false) {
  if (!cur) return;
  const boardW = cur.w * cell, boardH = cur.h * cell;
  let tx = Math.round(viewW / 2 - (cur.player.x + 0.5) * cell);
  let ty = Math.round(viewH / 2 - (cur.player.y + 0.5) * cell);
  tx = Math.min(0, Math.max(viewW - boardW, tx));
  ty = Math.min(0, Math.max(viewH - boardH, ty));
  if (instant) boardEl.classList.add('camsnap');
  boardEl.style.transform = `translate(${tx}px, ${ty}px)`;
  if (instant) { void boardEl.offsetWidth; boardEl.classList.remove('camsnap'); }
}

function placeSprite(el, x, y, instant = false) {
  if (!el) return;
  if (instant) { el.classList.add('notrans'); }
  el.style.transform = `translate(${x * cell}px, ${y * cell}px)`;
  if (instant) { void el.offsetWidth; el.classList.remove('notrans'); }
}

function makeSprite(cls, inner) {
  const el = document.createElement('div');
  el.className = 'sprite ' + cls;
  el.innerHTML = inner;
  // 常時アニメの位相・速度を個体ごとにずらして「生きてる感」を出す（描画のみ。ロジックには乱数を使わない）
  const body = el.querySelector('.body');
  if (body) {
    body.style.animationDelay = (-(Math.random() * 2.4)).toFixed(2) + 's';
    body.style.animationDuration = (2 + Math.random() * 1.2).toFixed(2) + 's';
  }
  objsEl.appendChild(el);
  return el;
}

// 押されたときのつぶれ演出（クラスを付けて自動で剥がす）
function squash(el) {
  if (!el) return;
  el.classList.remove('hop'); void el.offsetWidth; el.classList.add('hop');
  setTimeout(() => el.classList.remove('hop'), 220);
}

/* ============ レベル読み込み・描画 ============ */
function startLevel(i, keepEffort = false) {
  playGen++;
  levelIndex = i;
  const lv = LEVELS[i];
  cur = Engine.parseLevel(lv);
  undoStack = [];
  if (!keepEffort) { levelEffort = 0; whisperShown = false; }
  if (clearOvTimer) { clearTimeout(clearOvTimer); clearOvTimer = null; }
  if (autoWaitTimer) { clearTimeout(autoWaitTimer); autoWaitTimer = null; }
  ovClear.classList.remove('active');
  $('clear-perfect').innerHTML = '';
  $('hud-time').textContent = lv.time;
  $('hud-name').textContent = lv.name;
  hideDeadlockOverlay();
  lastCheckedKey = '';
  pendingStagger = 0;
  if (deadlockTimer) { clearTimeout(deadlockTimer); deadlockTimer = null; }

  // 静的タイル
  tilesEl.innerHTML = '';
  objsEl.innerHTML = '';
  fxEl.innerHTML = '';
  holeEls = []; boxEls = []; ghostEls = []; pendingHoleFills = new Set(); awaitingConfirm = new Set();
  boardEl.classList.toggle('wrapmode', !!cur.wrap);
  boardEl.classList.toggle('walled', !cur.wrap);
  for (let y = 0; y < cur.h; y++) {
    for (let x = 0; x < cur.w; x++) {
      const d = document.createElement('div');
      d.style.left = (x * cell) + 'px';
      d.style.top = (y * cell) + 'px';
      // left/top は layout() 後に再計算されるため相対指定にする
      d.dataset.x = x; d.dataset.y = y;
      if (Engine.isWall(cur, x, y)) d.className = 'cell wall' + (cur.hard[y * cur.w + x] ? ' hard' : '');
      else d.className = 'cell floor' + (((x + y) % 2) ? ' alt' : '');
      tilesEl.appendChild(d);
    }
  }
  // 穴タイル（床の上に重ねる）
  for (const o of cur.holes) {
    const d = document.createElement('div');
    d.className = 'cell hole-tile';
    d.dataset.x = o.x; d.dataset.y = o.y;
    d.innerHTML = '<span class="pit"></span><span class="peek">👀</span>';
    tilesEl.appendChild(d);
    holeEls.push(d);
  }

  // スプライト
  playerEl = makeSprite('player', '<span class="body">😼</span>');
  for (const b of cur.boxes) {
    const el = makeSprite(b.kind === 'wall' ? 'wallobj' + (SAVE.wallSeen ? ' known' : '') : 'box',
      b.kind === 'wall' ? '<span class="body"></span>' : '<span class="body">📦</span>');
    boxEls.push({ el, x: b.x, y: b.y, kind: b.kind });
  }
  for (const g of cur.ghosts) {
    const el = makeSprite('ghost', '<span class="body">👻</span>');
    ghostEls.push({ el, x: g.x, y: g.y });
  }

  layout();
  positionTiles();
  updateHud();
  updateHoles();
  showScreen('game');
}

function positionTiles() {
  for (const d of tilesEl.children) {
    d.style.left = (d.dataset.x * cell) + 'px';
    d.style.top = (d.dataset.y * cell) + 'px';
  }
}
// resize 時にタイルも再配置
window.addEventListener('resize', positionTiles);

function updateHud() {
  $('hud-turn').textContent = cur.turn + ' て';
}

function updateHoles() {
  cur.holes.forEach((o, i) => {
    const el = holeEls[i];
    // 穴は動かせるので位置も状態から反映する
    el.dataset.x = o.x; el.dataset.y = o.y;
    el.style.left = (o.x * cell) + 'px';
    el.style.top = (o.y * cell) + 'px';
    // 落下演出が終わるまでは、データ上は plugged でも見た目はまだ開いたまま扱う
    // （回転演出と「埋まった」表示が重なって見えるのを防ぐ）
    const showPlugged = o.plugged && !pendingHoleFills.has(i);
    el.classList.toggle('plugged', showPlugged);
    el.classList.toggle('eyes', !o.plugged && cur.spawnInterval > 0 && o.counter === 1 && cur.ghosts.length < cur.ghostCap);
    let plug = el.querySelector('.plug-emoji, .plug-wall');
    if (showPlugged && !plug) {
      if (o.pluggedBy === 'wall') {
        plug = document.createElement('span');
        plug.className = 'plug-wall';
      } else {
        plug = document.createElement('span');
        plug.className = 'plug-emoji' + (o.pluggedBy === 'ghost' ? ' ghosty' : '');
        plug.textContent = o.pluggedBy === 'box' ? '📦' : '👻';
      }
      el.appendChild(plug);
    } else if (!showPlugged && plug) plug.remove();
  });
}

// おばけの残像（動き元にふわっと残る）
function ghostEcho(x, y) {
  const d = document.createElement('div');
  d.className = 'ghost-echo';
  d.textContent = '👻';
  d.style.left = (x * cell) + 'px';
  d.style.top = (y * cell) + 'px';
  fxEl.appendChild(d);
  setTimeout(() => d.remove(), 420);
}

function addFx(x, y, text, cls = '') {
  const d = document.createElement('div');
  d.className = 'fx ' + cls;
  d.style.left = (x * cell) + 'px';
  d.style.top = (y * cell) + 'px';
  d.textContent = text;
  fxEl.appendChild(d);
  setTimeout(() => d.remove(), 800);
}

function findBoxEl(x, y) { return boxEls.find(b => b.x === x && b.y === y); }
function findGhostEl(x, y) { return ghostEls.find(g => g.x === x && g.y === y); }

// クリア時、穴に落ちず残ったおばけを「しゅん」と消す（見た目だけの演出。
// エンジンの cur.ghosts はそのまま＝Undo/Retryは常にstartLevelで作り直すため無関係）
function poofRemainingGhosts() {
  ghostEls.forEach((g, i) => {
    setTimeout(() => {
      g.el.classList.add('poofing');
      addFx(g.x, g.y, '✨', 'tiny pop');
      Sfx.poof();
      setTimeout(() => g.el.remove(), 1000);
    }, i * 90);
  });
  ghostEls = [];
}
function isWrapJump(fx, fy, tx, ty) { return Math.abs(fx - tx) > 1 || Math.abs(fy - ty) > 1; }

/* ============ 1手すすめる ============ */
function input(dir, fromAuto = false) {
  if (!cur || cur.status !== 'playing' || ended) return;
  if (autoplay && !fromAuto) return; // 模範解答の再生中は手入力を無視
  if (!fromAuto && ovClear.classList.contains('active')) return;
  const now = performance.now();
  // 移動速度の上限（連打でもキー長押しでも同じ速さになるよう固定間隔で間引く）。
  // 1手のスライド(.11s)と、おばけ/箱が穴に落ちる演出(最大で ばたつき.2s+落下.3s=.5s)
  // が、次の一手が来るまでにひと呼吸ぶん進んでいるくらいの間隔を狙う。
  if (!fromAuto && now - lastInputAt < 150) return;
  lastInputAt = now;
  const myGen = playGen; // このターンの遅延コールバックが、後のやりなおし/undoをまたいで発火しないようにする
  // 新しい入力が来た＝「ばたばた」自動待ちタイマーは役目を終えたので必ず破棄する
  // （このターンの処理の中で必要ならすぐ下で新しく張り直す）
  if (autoWaitTimer) { clearTimeout(autoWaitTimer); autoWaitTimer = null; }

  const prevPlayer = { x: cur.player.x, y: cur.player.y };
  const { state, events, turnConsumed } = Engine.step(cur, dir);

  if (!turnConsumed) return;

  undoStack.push(cur);
  if (undoStack.length > 600) undoStack.shift();
  cur = state;
  levelEffort++;

  // ぎょうれつ押し: 手前から順に「ゴン！ゴン！」と時間差で押されていく
  const chainEvs = events.filter(e => e.what === 'ghost' && (e.type === 'push' || e.type === 'plug' || e.type === 'land'));
  const chainN = chainEvs.length;
  const ghostMoveEvs = events.filter(e => e.type === 'ghostMove');
  pendingStagger = chainN >= 2 ? (chainN - 1) * 85 + 260 : 0;
  const chainDelay = (ev) => (chainN >= 2 ? (chainN - 1 - chainEvs.indexOf(ev)) * 85 : 0);

  // --- イベント反映 ---
  for (const ev of events) {
    switch (ev.type) {
      case 'bonk': {
        Sfx.bonk();
        boardEl.classList.remove('shakeit'); void boardEl.offsetWidth; boardEl.classList.add('shakeit');
        if (ev.what === 'wall' || ev.what === 'box') {
          // 押せなかった対象がプルッと動く（「生きてる」手応え）
          const sp = findBoxEl(ev.ox, ev.oy);
          if (sp) { sp.el.classList.remove('nudge'); void sp.el.offsetWidth; sp.el.classList.add('nudge'); setTimeout(() => sp.el.classList.remove('nudge'), 250); }
        }
        break;
      }
      case 'scared':
        Sfx.scared();
        addFx(ev.x, ev.y, '💦');
        break;
      case 'dodge': {
        // 単体のおばけ: 半マスだけ押し出されて、斜めに傾きながら、するりと元の位置へ戻る
        // （起き上がりこぼし感）。押しのけた先に箱/壁があっても隠れないよう
        // z-indexはおばけの方が高い（CSS側で常時ghost>box>wallobjの順）。
        Sfx.dodge();
        const sp = findGhostEl(ev.x, ev.y);
        if (sp) {
          squash(sp.el);
          if (!isWrapJump(ev.x, ev.y, ev.tx, ev.ty)) {
            const hx = ev.x + ev.dx * 0.5, hy = ev.y + ev.dy * 0.5;
            placeSprite(sp.el, hx, hy);
            const lean = (ev.dx !== 0 ? ev.dx : ev.dy) * 14;
            sp.el.style.setProperty('--leanDeg', lean + 'deg');
            sp.el.classList.remove('dodging'); void sp.el.offsetWidth; sp.el.classList.add('dodging');
            setTimeout(() => {
              sp.el.classList.remove('dodging');
              // その後 押される/落ちる などで座標が変わっていたら戻さない
              if (sp.x === ev.x && sp.y === ev.y && ghostEls.includes(sp)) placeSprite(sp.el, ev.x, ev.y);
            }, 260);
          }
        }
        addFx(ev.tx, ev.ty, 'ヒョイ');
        break;
      }
      case 'walk':
        Sfx.walk();
        movePlayerTo(ev.x, ev.y, prevPlayer);
        break;
      case 'land': {
        // 穴に乗ったがまだ確定していない（ばたばた中）。次のターン、動かされなければ落ちる
        const sp = findGhostEl(ev.fx, ev.fy);
        const delay = chainDelay(ev);
        const apply = () => {
          if (chainN >= 2) Sfx.gon(chainN - 1 - chainEvs.indexOf(ev));
          else Sfx.push();
          Sfx.wobble();
          if (sp && sp.x === ev.tx && sp.y === ev.ty) {
            placeSprite(sp.el, ev.tx, ev.ty, isWrapJump(ev.fx, ev.fy, ev.tx, ev.ty));
            squash(sp.el);
            // 0.5秒でぐるぐる回ってほぼ落ちきった姿勢まで進む（再着地でも毎回やり直す）
            sp.el.classList.remove('wobbling'); void sp.el.offsetWidth; sp.el.classList.add('wobbling');
            awaitingConfirm.add(sp.el);
            addFx(ev.tx, ev.ty, 'ウワッ', 'rise');
          }
        };
        if (sp) { sp.x = ev.tx; sp.y = ev.ty; }
        if (delay > 0) setTimeout(apply, delay); else apply();
        movePlayerTo(ev.fx, ev.fy, prevPlayer);
        break;
      }
      case 'push': {
        if (ev.what === 'wall' && !SAVE.wallSeen) {
          // 「壁が押せる」を発見！ 以後、押せる壁にはうっすら目印が出る
          SAVE.wallSeen = true; persist();
          boxEls.forEach(b => { if (b.kind === 'wall') b.el.classList.add('known'); });
        }
        const sp = ev.what === 'ghost' ? findGhostEl(ev.fx, ev.fy) : findBoxEl(ev.fx, ev.fy);
        const delay = ev.what === 'ghost' ? chainDelay(ev) : 0;
        const apply = () => {
          if (ev.what === 'ghost' && chainN >= 2) Sfx.gon(chainN - 1 - chainEvs.indexOf(ev));
          else Sfx.push();
          if (sp && sp.x === ev.tx && sp.y === ev.ty) { // 連打で先へ進んでいたら触らない
            placeSprite(sp.el, ev.tx, ev.ty, isWrapJump(ev.fx, ev.fy, ev.tx, ev.ty));
            squash(sp.el);
            if (ev.what === 'ghost') {
              sp.el.classList.remove('wobbling');
              awaitingConfirm.delete(sp.el);
              sp.el.classList.remove('dizzy'); void sp.el.offsetWidth; sp.el.classList.add('dizzy');
              setTimeout(() => sp.el.classList.remove('dizzy'), 600);
              addFx(ev.tx, ev.ty, chainN >= 2 ? 'ゴン!' : '💫');
            }
          }
        };
        if (sp) { sp.x = ev.tx; sp.y = ev.ty; } // 論理座標は即時更新（後続イベントの検索用）
        if (delay > 0) setTimeout(apply, delay); else apply();
        movePlayerTo(ev.fx, ev.fy, prevPlayer);
        break;
      }
      case 'holePush': {
        Sfx.holeSlide();
        movePlayerTo(ev.fx, ev.fy, prevPlayer);
        addFx(ev.tx, ev.ty, '𝅂', 'pop');
        break; // 穴タイル自体は updateHoles() が新しい位置へ動かす
      }
      case 'plug': {
        const px = ev.x, py = ev.y;
        // 押し元スプライト（落ちる直前の位置 = ev.fx/fy）
        const sp = ev.what === 'ghost' ? findGhostEl(ev.fx, ev.fy) : findBoxEl(ev.fx, ev.fy);
        if (sp) {
          if (ev.what === 'ghost') ghostEls.splice(ghostEls.indexOf(sp), 1);
          else boxEls.splice(boxEls.indexOf(sp), 1);
        }
        // 落下演出が終わるまで、この穴の「埋まった」見た目を保留する
        // （そうしないと、この直後 input() 末尾の毎ターンupdateHoles()が
        // 演出を待たずに即座に埋まった表示を出してしまう）
        const holeIdx = sp ? cur.holes.findIndex(o => o.x === px && o.y === py) : -1;
        if (holeIdx >= 0) pendingHoleFills.add(holeIdx);
        const delay = ev.what === 'ghost' ? chainDelay(ev) : 0;
        const apply = () => {
          if (ev.what === 'ghost' && chainN >= 2) Sfx.gon(chainN - 1 - chainEvs.indexOf(ev));
          else Sfx.push();
          Sfx.plug();
          // 落下演出が完全に終わってから穴を「埋まった」見た目に切り替える
          // （演出中に埋まった穴と重なって見えるのを防ぐ）。演出自体（classList操作・
          // 要素削除）は、やりなおし等で要素が既にDOMから外れていても無害なので
          // ここでは進めて良い。危険なのは共有状態 pendingHoleFills の書き換えだけ
          // なので、そこだけ世代を照合してガードする。
          if (sp) {
            placeSprite(sp.el, px, py, isWrapJump(sp.x, sp.y, px, py));
            const el = sp.el;
            const goFall = () => {
              el.classList.remove('wobbling');
              el.classList.add('falling');
              setTimeout(() => {
                el.remove();
                if (holeIdx >= 0 && myGen === playGen) { pendingHoleFills.delete(holeIdx); updateHoles(); }
              }, 150);
            };
            if (awaitingConfirm.has(el)) {
              // 既にland済みでぐるぐる回ってほぼ落ちきった姿勢まで進んでいるので、
              // そこから続けて完全に消える（もう一度回さない）
              awaitingConfirm.delete(el);
              goFall();
            } else {
              // 即プラグ: 箱・壁・おばけ共通で、落ちる前に0.5秒ぐるぐる回ってから続けて落ちる
              Sfx.wobble();
              el.classList.add('wobbling');
              if (ev.what === 'ghost') addFx(px, py, 'ウワッ', 'rise');
              setTimeout(goFall, 500);
            }
          } else {
            updateHoles();
          }
          if (ev.what !== 'ghost') addFx(px, py, '✨', 'pop tiny');
        };
        if (delay > 0) setTimeout(apply, delay); else apply();
        // プレイヤーは押し込んだ位置へ
        const me = cur.player;
        movePlayerTo(me.x, me.y, prevPlayer);
        break;
      }
      case 'ghostMove': {
        const sp = findGhostEl(ev.fx, ev.fy);
        if (!sp) break;
        sp.x = ev.tx; sp.y = ev.ty; // 論理座標は即時更新
        const gi = ghostMoveEvs.indexOf(ev);
        const delay = ghostMoveEvs.length >= 2 ? gi * 50 : 0; // 複数いるときは時間差で順に
        const apply = () => {
          if (!ghostEls.includes(sp) || sp.x !== ev.tx || sp.y !== ev.ty) return;
          ghostEcho(ev.fx, ev.fy); // 残像で「どこから動いたか」を見せる
          placeSprite(sp.el, ev.tx, ev.ty, isWrapJump(ev.fx, ev.fy, ev.tx, ev.ty));
        };
        if (delay > 0) setTimeout(apply, delay); else apply();
        break;
      }
      case 'spawn': {
        Sfx.spawn();
        const el = makeSprite('ghost', '<span class="body">👻</span>');
        el.style.opacity = '0';
        placeSprite(el, ev.x, ev.y, true);
        requestAnimationFrame(() => { el.style.transition = 'opacity .5s'; el.style.opacity = '1'; });
        ghostEls.push({ el, x: ev.x, y: ev.y });
        addFx(ev.x, ev.y, '･ﾟ✧', 'pop');
        break;
      }
      case 'clear':
        onClear();
        break;
      case 'wait':
        addFx(cur.player.x, cur.player.y, '…');
        break;
    }
  }
  updateHud();
  if (pendingStagger > 0) setTimeout(updateHoles, pendingStagger + 120); else updateHoles();
  updateCamera();
  maybeWhisper();
  scheduleDeadlockCheck();

  // 「ばたばた」（land）が発生したターンだけ、0.5秒操作が無ければ自動で
  // 「待つ」を1回送って確定させる（UI側だけの仕組み。エンジンは常に
  // 明示的な1入力からしか状態を進めないので決定論は崩れない。プレイヤーが
  // その前に何か操作すれば、このターンの冒頭で必ずキャンセルされ、新しい
  // landが起きればまた0.5秒張り直される）。
  if (cur.status === 'playing' && events.some(e => e.type === 'land')) {
    autoWaitTimer = setTimeout(() => {
      autoWaitTimer = null;
      if (cur && cur.status === 'playing' && !autoplay && !ovClear.classList.contains('active')) {
        input('wait', true);
      }
    }, 500);
  }
}

function movePlayerTo(x, y, prev) {
  placeSprite(playerEl, x, y, isWrapJump(prev.x, prev.y, x, y));
  squash(playerEl);
}

/* ============ 行き詰まり検出 ============
 * アイドル時に現在の状態から予算つき BFS を回す。
 * 予算内で全状態を探索し尽くして解が無ければ「詰み」が証明できる。
 * 予算切れ（大きい面）のときは何も言わない（誤報を出さない）。
 */
let deadlockTimer = null;
let deadlockShown = false;
let lastCheckedKey = '';
let dlJob = null; // 毎ターン走る分割BFSジョブ（フレームを止めない）
function scheduleDeadlockCheck() {
  if (deadlockTimer) clearTimeout(deadlockTimer);
  dlJob = null; // 古いジョブは破棄
  deadlockTimer = setTimeout(startDeadlockJob, 250);
}
function startDeadlockJob() {
  deadlockTimer = null;
  if (!cur || cur.status !== 'playing' || ended || autoplay || cur.turn === 0) return;
  const key = Engine.serialize(cur);
  if (key === lastCheckedKey) return;
  lastCheckedKey = key;
  dlJob = { seen: new Set([key]), frontier: [cur], next: [], baseKey: key };
  pumpDeadlockJob();
}
function pumpDeadlockJob() {
  if (!dlJob) return;
  if (!cur || cur.status !== 'playing' || ended || Engine.serialize(cur) !== dlJob.baseKey) { dlJob = null; return; }
  const dirs = ['up', 'down', 'left', 'right', 'wait'];
  const t0 = performance.now();
  while (performance.now() - t0 < 11) { // 1スライス約11ms
    if (!dlJob.frontier.length) {
      if (!dlJob.next.length) { dlJob = null; showDeadlockWhisper(); return; } // 全探索し尽くし=詰み証明
      dlJob.frontier = dlJob.next; dlJob.next = [];
    }
    const s0 = dlJob.frontier.pop();
    for (const d of dirs) {
      const { state, turnConsumed } = Engine.step(s0, d);
      if (!turnConsumed) continue;
      if (state.status === 'clear') {
        dlJob = null;
        if (deadlockShown) hideDeadlockOverlay();
        return;
      }
      const k = Engine.serialize(state);
      if (dlJob.seen.has(k)) continue;
      dlJob.seen.add(k);
      if (dlJob.seen.size > 220000) { dlJob = null; return; } // 予算切れ=沈黙（誤報しない）
      dlJob.next.push(state);
    }
  }
  setTimeout(pumpDeadlockJob, 40);
}
function showDeadlockWhisper() {
  deadlockShown = true;
  const w = $('whisper');
  w.textContent = '⚠️ もう ふさげないかも……？ Z で もどるか、R で やりなおそう。';
  w.classList.add('show', 'danger');
}
function hideDeadlockOverlay() {
  deadlockShown = false;
  const w = $('whisper');
  w.classList.remove('show', 'danger');
  w.textContent = ''; // danger は base の .8s フェードを使うため、文字も即座に消して残像を防ぐ
}
function solvableWithin(start, maxStates) {
  const dirs = ['up', 'down', 'left', 'right', 'wait'];
  const seen = new Set([Engine.serialize(start)]);
  let frontier = [start];
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      for (const d of dirs) {
        const { state, turnConsumed } = Engine.step(s, d);
        if (!turnConsumed) continue;
        if (state.status === 'clear') return 'solvable';
        const k = Engine.serialize(state);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > maxStates) return 'unknown';
        next.push(state);
      }
    }
    frontier = next;
  }
  return 'unsolvable';
}

function maybeWhisper() {
  const lv = LEVELS[levelIndex];
  if (!lv.whisper || whisperShown) return;
  if (levelEffort >= (lv.whisperAfter || 40)) {
    whisperShown = true;
    $('whisper').textContent = '💭 ' + lv.whisper;
    $('whisper').classList.add('show');
  }
}

function undo() {
  if (!undoStack.length || ended) return;
  stopAutoplay();
  cur = undoStack.pop();
  refreshFromState();
  if (deadlockShown) hideDeadlockOverlay();
  lastCheckedKey = '';
  scheduleDeadlockCheck();
  Sfx.menu();
}

function retry() {
  if (ended) return;
  stopAutoplay();
  Sfx.menu();
  startLevel(levelIndex, true);
}

/* ============ 模範解答の自動再生（ギブアップ） ============
 * まず「いまの状態から」解こうとする（予算つきBFS→ダメならグリーディ段階探索）。
 * ここから解けないことが証明されたら赤警告。探索が間に合わない巨大局面だけ最初から再生。
 */
function stopAutoplay() {
  if (autoplay) { clearInterval(autoplay); autoplay = null; }
}
function playSolution() {
  if (ended || !cur) return;
  if (autoplay) { stopAutoplay(); $('whisper').classList.remove('show'); return; } // もう一度押すと中断
  const w = $('whisper');
  w.classList.remove('danger');
  w.textContent = '💭 かんがえちゅう……';
  w.classList.add('show');
  setTimeout(() => {
    const lv = LEVELS[levelIndex];
    let path = null, fromHere = false;
    if (cur.status === 'playing' && cur.turn > 0) {
      const found = findPathFrom(cur);
      if (found === 'unsolvable') { showDeadlockWhisper(); return; }
      if (found && found.path) { path = found.path; fromHere = true; }
    }
    if (!path) {
      const sol = SOLUTIONS[lv.id];
      if (!sol || !sol.path || !sol.path.length) { w.classList.remove('show'); return; }
      path = sol.path;
      startLevel(levelIndex, true); // ここからは探索しきれない → 最初から再生
    }
    w.textContent = fromHere
      ? '💡 ここから こたえを さいせい…（もういちど💡 か R で ちゅうだん）'
      : '💡 さいしょから こたえを さいせい…（もういちど💡 か R で ちゅうだん）';
    w.classList.add('show');
    let i = 0;
    autoplay = setInterval(() => {
      if (i >= path.length || !cur || cur.status !== 'playing') { stopAutoplay(); return; }
      input(path[i++], true);
    }, 280);
  }, 60);
}

// 現在の状態から解く: 予算つき BFS（最短）→ 爆発したらグリーディ段階探索（witness）
function findPathFrom(start) {
  const dirs = ['up', 'down', 'left', 'right', 'wait'];
  let seen = new Set([Engine.serialize(start)]);
  let frontier = [{ s: start, path: [] }];
  let exploded = false;
  while (frontier.length && !exploded) {
    const next = [];
    for (const node of frontier) {
      for (const d of dirs) {
        const { state, turnConsumed } = Engine.step(node.s, d);
        if (!turnConsumed) continue;
        if (state.status === 'clear') return { path: [...node.path, d] };
        const k = Engine.serialize(state);
        if (seen.has(k)) continue;
        seen.add(k);
        if (seen.size > 120000) { exploded = true; break; }
        next.push({ s: state, path: [...node.path, d] });
      }
      if (exploded) break;
    }
    frontier = next;
  }
  if (!exploded) return 'unsolvable'; // 全探索し尽くした＝ここからは詰み
  // グリーディ: 「穴がもう1つ塞がる」までを繰り返す
  let s = start; const full = []; const t0 = performance.now();
  for (let stage = 0; stage < 40; stage++) {
    if (performance.now() - t0 > 5000) return null;
    const plugged0 = s.holes.filter(o => o.plugged).length;
    let seen2 = new Set([Engine.serialize(s)]);
    let fr = [{ s, path: [] }];
    let found = null, bail = false;
    while (fr.length && !found && !bail) {
      const nx = [];
      for (const node of fr) {
        for (const d of dirs) {
          const { state, turnConsumed } = Engine.step(node.s, d);
          if (!turnConsumed) continue;
          const k = Engine.serialize(state);
          if (seen2.has(k)) continue;
          seen2.add(k);
          const p = [...node.path, d];
          const plugged = state.holes.filter(o => o.plugged).length;
          if (state.status === 'clear' || plugged > plugged0) { found = { state, p }; break; }
          if (seen2.size > 150000) { bail = true; break; }
          nx.push({ s: state, path: p });
        }
        if (found || bail) break;
      }
      if (!found) fr = nx;
      if (!fr.length && !found && !bail) return 'unsolvable'; // 栓を増やせる未来が存在しない
    }
    if (bail || !found) return null;
    full.push(...found.p);
    s = found.state;
    if (s.status === 'clear') return { path: full };
  }
  return null;
}

/* ============ ★ランク ============ */
function parOf(id) { const s = SOLUTIONS[id]; return s && s.par ? s.par : null; }
function starsForTurns(par, turns) {
  if (!par || turns == null) return 1;
  if (turns <= par + 2) return 3;
  if (turns <= par + 10) return 2;
  return 1;
}
// レベル選択画面などで使う「歴代ベスト」基準の★
function starsFor(id) {
  if (!SAVE.cleared[id]) return 0;
  const best = SAVE.best[id];
  if (!best) return 1;
  return starsForTurns(parOf(id), best);
}
function starStr(n) { return n > 0 ? '★'.repeat(n) + '☆'.repeat(3 - n) : ''; }
function isPerfectCleared(id) {
  const par = parOf(id);
  const best = SAVE.best[id];
  return !!(SAVE.cleared[id] && par && best != null && best <= par);
}

// Undo 用: 状態からスプライトを作り直す（アニメなし）
function refreshFromState() {
  playGen++;
  if (autoWaitTimer) { clearTimeout(autoWaitTimer); autoWaitTimer = null; }
  objsEl.innerHTML = '';
  boxEls = []; ghostEls = []; pendingHoleFills = new Set(); awaitingConfirm = new Set();
  playerEl = makeSprite('player', '<span class="body">😼</span>');
  placeSprite(playerEl, cur.player.x, cur.player.y, true);
  for (const b of cur.boxes) {
    const el = makeSprite(b.kind === 'wall' ? 'wallobj' + (SAVE.wallSeen ? ' known' : '') : 'box',
      b.kind === 'wall' ? '<span class="body"></span>' : '<span class="body">📦</span>');
    placeSprite(el, b.x, b.y, true);
    boxEls.push({ el, x: b.x, y: b.y, kind: b.kind });
  }
  for (const g of cur.ghosts) {
    const el = makeSprite('ghost', '<span class="body">👻</span>');
    placeSprite(el, g.x, g.y, true);
    ghostEls.push({ el, x: g.x, y: g.y });
  }
  updateHud();
  updateHoles();
  updateCamera(true);
}

/* ============ クリア・エンディング ============ */
function onClear() {
  stopAutoplay();
  const lv = LEVELS[levelIndex];
  SAVE.cleared[lv.id] = true;
  if (!SAVE.best[lv.id] || cur.turn < SAVE.best[lv.id]) SAVE.best[lv.id] = cur.turn;
  persist();
  Sfx.clear();
  Sfx.duckFor(2800); // BGM は止めずに音量だけ下げる
  poofRemainingGhosts(); // 穴に落ちず残ったおばけがいたら、しゅんと消しておく
  // 最後に埋まった穴の落下演出(最長でスピン.5s+落下.15s=.65s)が終わってから、
  // 埋まった穴を0.5秒ほど見せてからクリア表示を出す
  const wait = 650 + 500 + pendingStagger;
  if (lv.finale) {
    setTimeout(playEnding, 900 + pendingStagger);
    return;
  }
  const par = parOf(lv.id);
  const stars = starsForTurns(par, cur.turn); // 今回のクリア手数基準（歴代ベストは別途レベル選択で表示）
  const isPerfect = par && cur.turn <= par; // ソルバーの最短(以下)で塞いだ
  // ★は1つずつ ぽん、ぽん、と出てくる
  const box = $('clear-stars');
  box.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const sp = document.createElement('span');
    sp.className = 'star-pop ' + (i < stars ? 'lit' : 'dim');
    sp.textContent = i < stars ? '★' : '☆';
    sp.style.animationDelay = (0.15 + i * 0.3) + 's';
    box.appendChild(sp);
  }
  for (let i = 0; i < stars; i++) setTimeout(() => Sfx.starTick(i), wait + 150 + i * 300);
  const perfectEl = $('clear-perfect');
  perfectEl.innerHTML = isPerfect ? '<span class="psp">✦</span><span class="ptxt">Perfect!</span><span class="psp">✦</span>' : '';
  if (isPerfect) setTimeout(() => Sfx.perfect(), wait + 100);
  $('clear-desc').textContent =
    `${lv.time} 「${lv.name}」 — ${cur.turn} てで ふさいだ` + (par ? `（さいたん ${par} て）` : '');
  $('btn-next').style.display = levelIndex + 1 < LEVELS.length ? '' : 'none';
  clearOvTimer = setTimeout(() => { clearOvTimer = null; ovClear.classList.add('active'); }, wait);
}

const ENDING_LINES = [
  { t: 'すべての あなを ふさいだ！', em: false },
  { t: '🎉🎊✨🎊🎉', em: true },
  { t: 'そうこは、しずかに なった。', em: false },
  { t: '😼', em: true },
  { t: '『 また こんど、あそぼうね 』', em: false, ghost: true },
  { t: '……べつに、さみしくないし。', em: false },
  { t: 'あさひが のぼる。バイト、かんりょう。', em: false },
  { t: '🌅🎆🌅', em: true },
  { t: '― ワルぶるネコのよる ・ おしまい ―', em: false },
];
let endingStep = 0;
let endingTimer = null;
function playEnding() {
  ended = true;
  showScreen('ending');
  Sfx.ending();
  const wrap = $('ending-lines');
  wrap.innerHTML = '';
  $('btn-ending-done').style.display = 'none';
  $('ending-skip').style.display = '';
  endingStep = 0;
  const total = LEVELS.reduce((a, lv) => a + starsFor(lv.id), 0);
  const lines = [...ENDING_LINES, { t: `よるの せいか: ★×${total}（さいだい ${LEVELS.length * 3}）`, em: false }];
  lines.forEach(line => {
    const d = document.createElement('div');
    d.className = 'line' + (line.em ? ' em' : '');
    d.textContent = line.t;
    if (line.ghost) d.style.color = '#c9a6ff';
    wrap.appendChild(d);
  });
  // 花火
  const old = screens.ending.querySelectorAll('.fw');
  old.forEach(o => o.remove());
  const FW = ['🎆', '✨', '🎉', '⭐', '💛', '🎊'];
  for (let i = 0; i < 26; i++) {
    const f = document.createElement('span');
    f.className = 'fw';
    f.textContent = FW[i % FW.length];
    f.style.left = (5 + Math.random() * 90) + '%';
    f.style.top = (5 + Math.random() * 80) + '%';
    f.style.animationDelay = (Math.random() * 2.4).toFixed(2) + 's';
    f.style.fontSize = (16 + Math.random() * 22) + 'px';
    screens.ending.appendChild(f);
  }
  screens.ending.classList.add('dawn');
  advanceEnding();
  endingTimer = setInterval(advanceEnding, 1700); // タップでも進められる
}
function advanceEnding() {
  if (!ended) return;
  const lines = $('ending-lines').children;
  if (endingStep < lines.length) {
    lines[endingStep].classList.add('show');
    endingStep++;
    if (endingStep === lines.length) {
      $('btn-ending-done').style.display = '';
      $('ending-skip').style.display = 'none';
      if (endingTimer) { clearInterval(endingTimer); endingTimer = null; }
    }
  }
}
function endEnding() {
  ended = false;
  if (endingTimer) { clearInterval(endingTimer); endingTimer = null; }
  screens.ending.classList.remove('dawn');
  buildSelect();
  showScreen('title');
}

/* ============ 入力 ============ */
const KEY_DIRS = {
  arrowup: 'up', w: 'up', arrowdown: 'down', s: 'down',
  arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right',
  ' ': 'wait', '.': 'wait',
};
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  Sfx.init();

  if (ended) { // エンディング
    if (['enter', ' ', 'z', 'x'].includes(k)) { e.preventDefault(); if (endingStep >= ENDING_LINES.length) endEnding(); else advanceEnding(); }
    return;
  }
  const active = Object.keys(screens).find(n => screens[n].classList.contains('active'));

  if (k === 'm') { toggleMute(); return; }

  if (active === 'title') {
    if (k === 'arrowup' || k === 'w') { e.preventDefault(); titleIndex--; updateTitleFocus(); Sfx.menu(); return; }
    if (k === 'arrowdown' || k === 's') { e.preventDefault(); titleIndex++; updateTitleFocus(); Sfx.menu(); return; }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      const btn = titleButtons()[titleIndex];
      if (btn) btn.click();
    }
    return;
  }
  if (active === 'select') {
    const COLS = 3;
    if (k === 'arrowleft' || k === 'a') { e.preventDefault(); selIndex--; updateSelectFocus(); Sfx.menu(); return; }
    if (k === 'arrowright' || k === 'd') { e.preventDefault(); selIndex++; updateSelectFocus(); Sfx.menu(); return; }
    if (k === 'arrowup' || k === 'w') { e.preventDefault(); selIndex -= COLS; updateSelectFocus(); Sfx.menu(); return; }
    if (k === 'arrowdown' || k === 's') { e.preventDefault(); selIndex += COLS; updateSelectFocus(); Sfx.menu(); return; }
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      const card = selCards[selIndex];
      if (card && !card.classList.contains('locked')) card.click();
      return;
    }
    if (k === 'escape') { Sfx.menu(); showScreen('title'); }
    return;
  }
  if (active !== 'game') return;

  // オーバーレイ
  if (ovClear.classList.contains('active')) {
    if (k === 'escape') { e.preventDefault(); gotoSelect(); return; }
    if (k === 'enter' || k === ' ' || KEY_DIRS[k]) {
      e.preventDefault();
      if (levelIndex + 1 < LEVELS.length) { startLevel(levelIndex + 1); } else { gotoSelect(); }
      return;
    }
    if (k === 'r') { e.preventDefault(); retry(); }
    return;
  }

  if (k === 'escape') { e.preventDefault(); gotoSelect(); return; }
  if (k === 'z') { e.preventDefault(); undo(); return; }
  if (k === 'r') { e.preventDefault(); retry(); return; }
  if (KEY_DIRS[k]) { e.preventDefault(); input(KEY_DIRS[k]); }
});

function gotoSelect() { stopAutoplay(); Sfx.menu(); buildSelect(); showScreen('select'); }
function continueGame() {
  // 最初の未クリアレベルから
  let i = LEVELS.findIndex(lv => !SAVE.cleared[lv.id]);
  if (i === -1) i = 0;
  startLevel(i);
}
function toggleMute() {
  Sfx.toggle();
  $('btn-mute').textContent = Sfx.muted ? '🔇' : '🔊';
}

/* タッチ: スワイプ */
let touchStart = null;
boardEl.parentElement.addEventListener('touchstart', (e) => {
  Sfx.init();
  if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
}, { passive: true });
boardEl.parentElement.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  if (Math.max(adx, ady) < 22) return; // タップは無視
  input(adx > ady ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
}, { passive: true });

/* D-pad */
document.querySelectorAll('.dbtn').forEach(b => {
  b.addEventListener('click', () => { Sfx.init(); input(b.dataset.dir); });
});

/* ボタン */
$('btn-continue').addEventListener('click', () => { Sfx.init(); Sfx.menu(); continueGame(); });
$('btn-newgame').addEventListener('click', () => { Sfx.init(); Sfx.menu(); startLevel(0); });
$('btn-select').addEventListener('click', () => { Sfx.init(); gotoSelect(); });
$('select-back').addEventListener('click', () => { Sfx.menu(); showScreen('title'); });
$('btn-levels').addEventListener('click', gotoSelect);
$('btn-undo').addEventListener('click', undo);
$('btn-retry').addEventListener('click', retry);
$('btn-mute').addEventListener('click', toggleMute);
$('btn-solution').addEventListener('click', () => { Sfx.init(); playSolution(); });
$('btn-unlock-all').addEventListener('click', () => {
  SAVE.unlockAll = !SAVE.unlockAll;
  persist(); Sfx.menu(); buildSelect();
});
$('btn-next').addEventListener('click', () => { Sfx.menu(); if (levelIndex + 1 < LEVELS.length) startLevel(levelIndex + 1); else gotoSelect(); });
$('btn-clear-retry').addEventListener('click', retry);
$('btn-clear-levels').addEventListener('click', gotoSelect);
$('btn-ending-done').addEventListener('click', endEnding);
screens.ending.addEventListener('click', () => { if (ended && endingStep < ENDING_LINES.length) advanceEnding(); });

/* 初期化 */
$('btn-mute').textContent = Sfx.muted ? '🔇' : '🔊';
buildSelect();
showScreen('title');

/* 自動テスト用フック（tools/browsertest.mjs から使用） */
window.__game = {
  startLevel,
  input(dir) { lastInputAt = 0; input(dir); },
  state: () => cur,
  levelIndex: () => levelIndex,
  save: () => SAVE,
  autoplayActive: () => !!autoplay,
  isEnded: () => ended,
};

})();
