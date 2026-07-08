/* main.js — 『あなふさぎのよる』UI 層
 * ルールは engine.js のみが持つ。ここは描画・入力・音・セーブだけ。
 */
(() => {
'use strict';

/* ============ セーブ ============ */
const STORAGE_KEY = 'anafusagi_v1';
const SAVE = (() => {
  try { return Object.assign({ cleared: {}, muted: false }, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); }
  catch (e) { return { cleared: {}, muted: false }; }
})();
function persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(SAVE)); } catch (e) {} }

/* ============ サウンド（WebAudio ミニSE） ============ */
const Sfx = {
  ctx: null, muted: !!SAVE.muted, bgmTimer: null, bgmStep: 0,
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
    // A メロ×2 → B メロ×1 → A に戻る（16 ステップ = 4 小節）
    const melodyA = [523.25, 0, 440.00, 493.88, 0, 659.25, 587.33, 0, 523.25, 0, 440.00, 0, 392.00, 440.00, 0, 0];
    const melodyB = [659.25, 0, 783.99, 659.25, 0, 587.33, 523.25, 0, 587.33, 659.25, 0, 523.25, 0, 493.88, 440.00, 0];
    this.bgmTimer = setInterval(() => {
      if (!this.ctx || this.muted || document.hidden) return;
      if (!window.__bgmOk || !window.__bgmOk()) return;
      const bar = Math.floor(this.bgmStep / 4) % chords.length;
      if (this.bgmStep % 4 === 0) {
        chords[bar].forEach((f, i) => this.tone(f, 1.7, 'sine', 0.012, i * 0.04));
        this.tone(bass[bar], 1.2, 'triangle', 0.02);
      }
      const section = Math.floor(this.bgmStep / 16) % 3; // A A B
      const melody = section === 2 ? melodyB : melodyA;
      const m = melody[this.bgmStep % 16];
      if (m) this.tone(m, 0.34, 'triangle', section === 2 ? 0.02 : 0.016, 0.05);
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
  push() { this.tone(170, 0.07, 'square', 0.045); },
  bonk() { this.tone(110, 0.08, 'square', 0.05); },
  scared() { this.tone(620, 0.06, 'triangle', 0.05); this.tone(500, 0.07, 'triangle', 0.05, 0.07); },
  plug() { this.slide(300, 90, 0.16, 'sine', 0.09); this.tone(880, 0.1, 'triangle', 0.05, 0.14); this.tone(1320, 0.12, 'sine', 0.04, 0.2); },
  spawn() { this.slide(140, 520, 0.3, 'sine', 0.05); },
  dodge() { this.slide(700, 1100, 0.09, 'sine', 0.035); },
  holeSlide() { this.slide(180, 120, 0.14, 'sine', 0.06); },
  clear() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.17, 'triangle', 0.07, i * 0.1)); },
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
}

/* ============ ゲーム状態 ============ */
let levelIndex = 0;
let cur = null;             // engine state
let undoStack = [];
let cell = 48;
let holeEls = [];           // 穴タイル要素（holes 配列と同順）
let playerEl = null;
let boxEls = [];            // {el,x,y,kind}
let ghostEls = [];          // {el,x,y}
let levelEffort = 0;        // whisper 用（リトライしても継続）
let whisperShown = false;
let lastInputAt = 0;
let ended = false;          // エンディング再生中フラグ
let autoplay = null;        // 模範解答再生タイマー
let clearOvTimer = null;    // クリア演出の遅延表示タイマー（レベル移動時に必ず破棄する）

// BGM を鳴らしてよい状況か（Sfx から参照）
window.__bgmOk = () => screens.game.classList.contains('active') && cur && cur.status === 'playing' && !ended;

function isUnlocked(i) { return SAVE.unlockAll || i === 0 || !!SAVE.cleared[LEVELS[i - 1].id]; }
function allCleared() { return LEVELS.every(l => SAVE.cleared[l.id]); }

/* ============ レベルせんたく ============ */
function buildSelect() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const card = document.createElement('button');
    const unlocked = isUnlocked(i);
    const cleared = !!SAVE.cleared[lv.id];
    card.className = 'level-card' + (unlocked ? '' : ' locked') + (cleared ? ' cleared' : '');
    card.innerHTML =
      `<div class="t">${lv.time}</div>` +
      `<div class="n">${unlocked ? lv.name : '？？？'}</div>` +
      `<div class="s">${cleared ? '⭐' : unlocked ? '🌙' : '🔒'}</div>`;
    if (unlocked) card.addEventListener('click', () => { Sfx.init(); Sfx.menu(); startLevel(i); });
    grid.appendChild(card);
  });
}

/* ============ 盤面レイアウト ============ */
function layout() {
  if (!cur) return;
  const availW = Math.min(window.innerWidth - 24, 620);
  const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;
  const availH = window.innerHeight - (isTouch ? 320 : 210);
  cell = Math.max(26, Math.min(60, Math.floor(Math.min(availW / cur.w, availH / cur.h))));
  document.documentElement.style.setProperty('--cell', cell + 'px');
  boardEl.style.width = (cur.w * cell) + 'px';
  boardEl.style.height = (cur.h * cell) + 'px';
  // 全スプライト再配置（アニメなし）
  placeSprite(playerEl, cur.player.x, cur.player.y, true);
  boxEls.forEach(b => placeSprite(b.el, b.x, b.y, true));
  ghostEls.forEach(g => placeSprite(g.el, g.x, g.y, true));
}
window.addEventListener('resize', layout);

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
  levelIndex = i;
  const lv = LEVELS[i];
  cur = Engine.parseLevel(lv);
  undoStack = [];
  if (!keepEffort) { levelEffort = 0; whisperShown = false; }
  if (clearOvTimer) { clearTimeout(clearOvTimer); clearOvTimer = null; }
  ovClear.classList.remove('active');
  $('hud-time').textContent = lv.time;
  $('hud-name').textContent = lv.name;
  $('whisper').classList.remove('show');
  deadlockShown = false;
  lastCheckedKey = '';
  if (deadlockTimer) { clearTimeout(deadlockTimer); deadlockTimer = null; }

  // 静的タイル
  tilesEl.innerHTML = '';
  objsEl.innerHTML = '';
  fxEl.innerHTML = '';
  holeEls = []; boxEls = []; ghostEls = [];
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
  playerEl = makeSprite('player', '<span class="body">🐱</span>');
  for (const b of cur.boxes) {
    const el = makeSprite(b.kind === 'wall' ? 'wallobj' : 'box',
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
    el.classList.toggle('plugged', o.plugged);
    el.classList.toggle('eyes', !o.plugged && cur.spawnInterval > 0 && o.counter === 1 && cur.ghosts.length < cur.ghostCap);
    let plug = el.querySelector('.plug-emoji, .plug-wall');
    if (o.plugged && !plug) {
      if (o.pluggedBy === 'wall') {
        plug = document.createElement('span');
        plug.className = 'plug-wall';
      } else {
        plug = document.createElement('span');
        plug.className = 'plug-emoji' + (o.pluggedBy === 'ghost' ? ' ghosty' : '');
        plug.textContent = o.pluggedBy === 'box' ? '📦' : '👻';
      }
      el.appendChild(plug);
    } else if (!o.plugged && plug) plug.remove();
  });
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
function isWrapJump(fx, fy, tx, ty) { return Math.abs(fx - tx) > 1 || Math.abs(fy - ty) > 1; }

/* ============ 1手すすめる ============ */
function input(dir, fromAuto = false) {
  if (!cur || cur.status !== 'playing' || ended) return;
  if (autoplay && !fromAuto) return; // 模範解答の再生中は手入力を無視
  if (!fromAuto && ovClear.classList.contains('active')) return;
  const now = performance.now();
  if (!fromAuto && now - lastInputAt < 70) return;
  lastInputAt = now;

  const prevPlayer = { x: cur.player.x, y: cur.player.y };
  const { state, events, turnConsumed } = Engine.step(cur, dir);

  if (!turnConsumed) return;

  undoStack.push(cur);
  if (undoStack.length > 600) undoStack.shift();
  cur = state;
  levelEffort++;

  // --- イベント反映 ---
  for (const ev of events) {
    switch (ev.type) {
      case 'bonk':
        Sfx.bonk();
        boardEl.classList.remove('shakeit'); void boardEl.offsetWidth; boardEl.classList.add('shakeit');
        break;
      case 'scared':
        Sfx.scared();
        addFx(ev.x, ev.y, '💦');
        break;
      case 'dodge': {
        // 単体のおばけ: 1コマ押し出されてから、するりと元の位置へ戻る
        Sfx.dodge();
        const sp = findGhostEl(ev.x, ev.y);
        if (sp) {
          squash(sp.el);
          if (!isWrapJump(ev.x, ev.y, ev.tx, ev.ty)) {
            placeSprite(sp.el, ev.tx, ev.ty);
            setTimeout(() => {
              // その後 押される/落ちる などで座標が変わっていたら戻さない
              if (sp.x === ev.x && sp.y === ev.y && ghostEls.includes(sp)) placeSprite(sp.el, ev.x, ev.y);
            }, 150);
          }
        }
        addFx(ev.tx, ev.ty, 'スカッ');
        break;
      }
      case 'walk':
        Sfx.walk();
        movePlayerTo(ev.x, ev.y, prevPlayer);
        break;
      case 'push': {
        Sfx.push();
        const sp = ev.what === 'ghost' ? findGhostEl(ev.fx, ev.fy) : findBoxEl(ev.fx, ev.fy);
        if (sp) {
          placeSprite(sp.el, ev.tx, ev.ty, isWrapJump(ev.fx, ev.fy, ev.tx, ev.ty));
          sp.x = ev.tx; sp.y = ev.ty;
          squash(sp.el);
          if (ev.what === 'ghost') {
            sp.el.classList.remove('dizzy'); void sp.el.offsetWidth; sp.el.classList.add('dizzy');
            setTimeout(() => sp.el.classList.remove('dizzy'), 600);
            addFx(ev.tx, ev.ty, '💫');
          }
        }
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
        Sfx.push(); Sfx.plug();
        const px = ev.x, py = ev.y;
        // 押し元スプライト（落ちる直前の位置 = ev.fx/fy）
        const sp = ev.what === 'ghost' ? findGhostEl(ev.fx, ev.fy) : findBoxEl(ev.fx, ev.fy);
        if (sp) {
          placeSprite(sp.el, px, py, isWrapJump(sp.x, sp.y, px, py));
          sp.el.style.transition = 'transform .11s ease-out, opacity .3s .1s, scale .3s .1s';
          sp.el.style.opacity = '0';
          sp.el.style.scale = '0.4';
          const el = sp.el;
          setTimeout(() => el.remove(), 450);
          if (ev.what === 'ghost') ghostEls.splice(ghostEls.indexOf(sp), 1);
          else boxEls.splice(boxEls.indexOf(sp), 1);
        }
        // プレイヤーは押し込んだ位置へ
        const me = cur.player;
        movePlayerTo(me.x, me.y, prevPlayer);
        addFx(px, py, ev.what === 'ghost' ? '💜' : '✨', 'pop');
        setTimeout(updateHoles, 200);
        break;
      }
      case 'ghostMove': {
        const sp = findGhostEl(ev.fx, ev.fy);
        if (sp) { placeSprite(sp.el, ev.tx, ev.ty, isWrapJump(ev.fx, ev.fy, ev.tx, ev.ty)); sp.x = ev.tx; sp.y = ev.ty; }
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
  updateHoles();
  maybeWhisper();
  scheduleDeadlockCheck();
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
function scheduleDeadlockCheck() {
  if (deadlockTimer) clearTimeout(deadlockTimer);
  deadlockTimer = setTimeout(runDeadlockCheck, 750);
}
function runDeadlockCheck() {
  deadlockTimer = null;
  if (!cur || cur.status !== 'playing' || ended || autoplay || cur.turn === 0) return;
  const key = Engine.serialize(cur);
  if (key === lastCheckedKey) return;
  lastCheckedKey = key;
  const res = solvableWithin(cur, 25000);
  if (res === 'unsolvable') {
    deadlockShown = true;
    $('whisper').textContent = '💭 ……これは、もう ふさげない かたち かも。（Z でもどる / R でやりなおす）';
    $('whisper').classList.add('show');
  } else if (deadlockShown) {
    deadlockShown = false;
    $('whisper').classList.remove('show');
  }
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
  if (deadlockShown) { deadlockShown = false; $('whisper').classList.remove('show'); }
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

/* ============ 模範解答の自動再生（ギブアップ） ============ */
function stopAutoplay() {
  if (autoplay) { clearInterval(autoplay); autoplay = null; }
}
function playSolution() {
  if (ended || !cur) return;
  if (autoplay) { stopAutoplay(); return; } // もう一度押すと中断
  const lv = LEVELS[levelIndex];
  const path = SOLUTIONS[lv.id];
  if (!path || !path.length) return;
  startLevel(levelIndex, true); // 最初から再生
  $('whisper').textContent = '💡 こたえを さいせいちゅう…（R で ちゅうだん）';
  $('whisper').classList.add('show');
  let i = 0;
  autoplay = setInterval(() => {
    if (i >= path.length || !cur || cur.status !== 'playing') { stopAutoplay(); return; }
    input(path[i++], true);
  }, 180);
}

// Undo 用: 状態からスプライトを作り直す（アニメなし）
function refreshFromState() {
  objsEl.innerHTML = '';
  boxEls = []; ghostEls = [];
  playerEl = makeSprite('player', '<span class="body">🐱</span>');
  placeSprite(playerEl, cur.player.x, cur.player.y, true);
  for (const b of cur.boxes) {
    const el = makeSprite(b.kind === 'wall' ? 'wallobj' : 'box',
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
}

/* ============ クリア・エンディング ============ */
function onClear() {
  stopAutoplay();
  const lv = LEVELS[levelIndex];
  SAVE.cleared[lv.id] = true;
  persist();
  Sfx.clear();
  if (lv.finale) {
    setTimeout(playEnding, 900);
    return;
  }
  $('clear-desc').textContent = `${lv.time} 「${lv.name}」 — ${cur.turn} てで ふさいだ`;
  $('btn-next').style.display = levelIndex + 1 < LEVELS.length ? '' : 'none';
  clearOvTimer = setTimeout(() => { clearOvTimer = null; ovClear.classList.add('active'); }, 650);
}

const ENDING_LINES = [
  { t: 'すべての あなを ふさいだ。', em: false },
  { t: 'そうこは、しずかに なった。', em: false },
  { t: '🐱', em: true },
  { t: '……ちょっとだけ、しずかすぎる。', em: false },
  { t: '『 また こんど、あそぼうね 』', em: false, ghost: true },
  { t: 'とおくで、あさの おとが する。', em: false },
  { t: '🌅', em: true },
  { t: '― あなふさぎのよる ・ おしまい ―', em: false },
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
  ENDING_LINES.forEach(line => {
    const d = document.createElement('div');
    d.className = 'line' + (line.em ? ' em' : '');
    d.textContent = line.t;
    if (line.ghost) d.style.color = '#c9a6ff';
    wrap.appendChild(d);
  });
  screens.ending.classList.add('dawn');
  advanceEnding();
  endingTimer = setInterval(advanceEnding, 1900); // タップでも進められる
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
    if (k === 'enter' || k === ' ') { e.preventDefault(); Sfx.menu(); continueGame(); }
    return;
  }
  if (active === 'select') {
    if (k === 'escape') { Sfx.menu(); showScreen('title'); }
    return;
  }
  if (active !== 'game') return;

  // オーバーレイ
  if (ovClear.classList.contains('active')) {
    if (k === 'enter' || k === ' ') {
      e.preventDefault();
      if (levelIndex + 1 < LEVELS.length) { startLevel(levelIndex + 1); } else { gotoSelect(); }
    }
    if (k === 'r') { e.preventDefault(); retry(); }
    if (k === 'escape') { e.preventDefault(); gotoSelect(); }
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
$('btn-start').addEventListener('click', () => { Sfx.init(); Sfx.menu(); continueGame(); });
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
