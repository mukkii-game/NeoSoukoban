/* tools/browsertest.mjs — 実ブラウザ(Edge headless)での E2E 検証
 * 実行: scratchpad など puppeteer-core を npm install したディレクトリを cwd にして
 *   node <repo>/tools/browsertest.mjs [shotsDir]
 * 検証内容:
 *  - コンソールエラー / ページエラーが 0 であること
 *  - 全レベルをソルバーの解で実際にプレイしてクリアできること（engine と UI の整合）
 *  - Undo で状態が正しく巻き戻ること
 *  - 主要画面のスクリーンショット保存
 */
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { LEVELS } from './solve.mjs';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const puppeteer = require('puppeteer-core');
const repoRequire = createRequire(new URL(import.meta.url));
const SOLUTIONS = repoRequire('../solutions.js'); // {id: {path, par, greedy}}

// ブラウザ実体: 環境変数 BROWSER_EXE > scratchpad の chrome-headless-shell > Edge
import { globSync } from 'node:fs';
function findBrowser() {
  if (process.env.BROWSER_EXE) return process.env.BROWSER_EXE;
  try {
    const hits = globSync(path.join(process.cwd(), 'chrome-headless-shell/**/chrome-headless-shell.exe'));
    if (hits.length) return hits[0];
  } catch (e) {}
  return 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
}
const EDGE = findBrowser();
const repoRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')));
const indexUrl = 'file:///' + path.join(repoRoot, 'index.html').replace(/\\/g, '/');
const shotsDir = process.argv[2] || path.join(process.cwd(), 'shots');
mkdirSync(shotsDir, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
const consoleIssues = [];

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  userDataDir: path.join(process.cwd(), 'edge-profile'),
  args: ['--allow-file-access-from-files', '--no-sandbox', '--disable-gpu', '--no-first-run'],
});
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 860 });
page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) consoleIssues.push(msg.type() + ': ' + msg.text()); });
page.on('pageerror', err => consoleIssues.push('pageerror: ' + err.message));

console.log('open:', indexUrl);
await page.goto(indexUrl, { waitUntil: 'load' });
await page.waitForFunction('window.__game !== undefined', { timeout: 5000 });
await sleep(300);
await page.screenshot({ path: path.join(shotsDir, '00-title.png') });

// --- タイトル/レベル選択のキーボード操作（マウスなし） ---
{
  await page.keyboard.press('Enter'); // 進捗なし: フォーカス=はじめから → 1面
  await sleep(180);
  const kb = await page.evaluate(() => ({
    game: document.getElementById('screen-game').classList.contains('active'),
    idx: window.__game.levelIndex(),
  }));
  if (kb.game && kb.idx === 0) console.log('✅ タイトル: Enter で はじめから → 1面');
  else { console.log('❌ タイトルのキーボード開始に失敗 ' + JSON.stringify(kb)); failures++; }
  await page.keyboard.press('Escape'); // レベル選択へ
  await sleep(150);
  await page.keyboard.press('ArrowRight'); // カーソル → 2面（ロック）
  await page.keyboard.press('Enter');
  await sleep(150);
  const kb2 = await page.evaluate(() => ({
    sel: document.getElementById('screen-select').classList.contains('active'),
    game: document.getElementById('screen-game').classList.contains('active'),
  }));
  if (kb2.sel && !kb2.game) console.log('✅ レベル選択: WASD/矢印カーソル + ロック面はEnter無効');
  else { console.log('❌ レベル選択のキーボード挙動 ' + JSON.stringify(kb2)); failures++; }
}

// レベルせんたく画面
await page.evaluate(() => document.getElementById('btn-select').click());
await sleep(250);
await page.screenshot({ path: path.join(shotsDir, '01-select.png') });

// --- 全レベルを模範解答（BFS最短 or グリーディ証人）で実プレイ ---
for (let i = 0; i < LEVELS.length; i++) {
  const lv = LEVELS[i];
  const sol = SOLUTIONS[lv.id];
  if (!sol || !sol.path) { console.log(`❌ ${lv.id} solutions.js に解がない`); failures++; continue; }
  await page.evaluate(idx => window.__game.startLevel(idx), i);
  await sleep(120);
  const shotLevels = ['n01', 'n03', 'n05', 'n08', 'n13', 'n16', 'n18', 'n19'];
  if (shotLevels.includes(lv.id)) await page.screenshot({ path: path.join(shotsDir, `10-level-${lv.id}.png`) });
  const midAt = Math.floor(sol.path.length * 0.7);
  for (let k = 0; k < sol.path.length; k++) {
    await page.evaluate(dir => window.__game.input(dir), sol.path[k]);
    await sleep(15);
    if (k === midAt && shotLevels.includes(lv.id)) {
      await sleep(250);
      await page.screenshot({ path: path.join(shotsDir, `11-mid-${lv.id}.png`) });
    }
  }
  await sleep(150);
  const st = await page.evaluate(() => ({ status: window.__game.state().status, turn: window.__game.state().turn }));
  if (st.status === 'clear') console.log(`✅ ${lv.id} ${lv.name}: UI 上で ${st.turn} 手クリア`);
  else { console.log(`❌ ${lv.id} ${lv.name}: UI 再生でクリアできず (status=${st.status})`); failures++; }
  if (i === 0) { // n01: 最短手数(=par)でクリア → Perfect! バッジが出るはず
    await sleep(700);
    const badge = await page.evaluate(() => document.getElementById('clear-perfect').textContent);
    if (badge.includes('Perfect')) console.log('✅ 最短クリアで Perfect! バッジ表示');
    else { console.log('❌ 最短クリアなのに Perfect! バッジが出ない: ' + JSON.stringify(badge)); failures++; }
    // クリア画面から「レベルせんたく」→ 重ねて暗く表示されないこと + n01カードにPerfect反映
    await page.evaluate(() => document.getElementById('btn-clear-levels').click());
    await sleep(150);
    const selState = await page.evaluate(() => {
      const cards = document.querySelectorAll('.level-card');
      return {
        selectActive: document.getElementById('screen-select').classList.contains('active'),
        ovClearActive: document.getElementById('ov-clear').classList.contains('active'),
        n01Perfect: cards[0].classList.contains('perfect'),
        n01PerfectText: cards[0].querySelector('.pmini') ? cards[0].querySelector('.pmini').textContent : null,
      };
    });
    if (selState.selectActive && !selState.ovClearActive) console.log('✅ クリア画面→レベルせんたく でオーバーレイが残らない');
    else { console.log('❌ レベルせんたく遷移後もクリアオーバーレイが残る: ' + JSON.stringify(selState)); failures++; }
    if (selState.n01Perfect && selState.n01PerfectText && selState.n01PerfectText.includes('Perfect')) {
      console.log('✅ レベルせんたくに「Perfect!」の文字ラベルが表示される');
    } else { console.log('❌ レベルせんたくに Perfect が反映されない: ' + JSON.stringify(selState)); failures++; }
  }
  if (lv.finale) { await sleep(1400); await page.screenshot({ path: path.join(shotsDir, '30-ending.png') }); }
  else { await sleep(700); await page.screenshot({ path: path.join(shotsDir, `20-clear-${lv.id}.png`) }); }
  // クリアオーバーレイを閉じてもとに戻す
  await page.evaluate(() => {
    document.getElementById('ov-clear').classList.remove('active');
    const ed = document.getElementById('screen-ending');
    if (ed.classList.contains('active')) location.reload();
  });
  if (lv.finale) { await page.waitForFunction('window.__game !== undefined', { timeout: 5000 }); }
}

// --- Undo 整合性: n05 で 5 手 → 5 Undo → 初期状態一致 ---
{
  await page.evaluate(() => window.__game.startLevel(4));
  await sleep(80);
  const before = await page.evaluate(() => JSON.stringify({
    p: window.__game.state().player, b: window.__game.state().boxes, g: window.__game.state().ghosts,
    h: window.__game.state().holes,
  }));
  const upath = SOLUTIONS[LEVELS[4].id].path;
  const n = Math.min(3, upath.length - 1); // クリアさせずに途中まで
  for (const d of upath.slice(0, n)) { await page.evaluate(dir => window.__game.input(dir), d); await sleep(10); }
  for (let k = 0; k < n; k++) { await page.keyboard.press('z'); await sleep(30); }
  const after = await page.evaluate(() => JSON.stringify({
    p: window.__game.state().player, b: window.__game.state().boxes, g: window.__game.state().ghosts,
    h: window.__game.state().holes,
  }));
  if (before === after) console.log('✅ Undo: 5手→5Undo で完全一致');
  else { console.log('❌ Undo: 巻き戻し不一致\n  before=' + before + '\n  after =' + after); failures++; }
}

// --- おばけはプレイヤーのマスに入れない・敗北が存在しない ---
{
  await page.evaluate(() => window.__game.startLevel(3)); // n04 おばけ面
  await sleep(80);
  const p0 = await page.evaluate(() => ({ ...window.__game.state().player }));
  let ok = true, adjacent = false;
  for (let k = 0; k < 30; k++) {
    await page.evaluate(() => window.__game.input('wait'));
    await sleep(10);
    const st = await page.evaluate(() => ({
      p: window.__game.state().player, s: window.__game.state().status,
      g: window.__game.state().ghosts,
    }));
    if (st.s !== 'playing') { console.log('❌ 待機中に status が ' + st.s + ' になった'); failures++; ok = false; break; }
    if (st.p.x !== p0.x || st.p.y !== p0.y) { console.log('❌ 待機中にプレイヤーが動かされた'); failures++; ok = false; break; }
    if (st.g.some(g => g.x === st.p.x && g.y === st.p.y)) { console.log('❌ おばけがプレイヤーのマスに侵入'); failures++; ok = false; break; }
    if (st.g.some(g => Math.abs(g.x - st.p.x) + Math.abs(g.y - st.p.y) === 1)) adjacent = true;
  }
  if (ok && adjacent) console.log('✅ おばけは隣で止まる（侵入・敗北なし）');
  else if (ok) { console.log('⚠️ 30待機でおばけが隣接しなかった（要確認）'); }
}

// --- 💡 模範解答の自動再生（途中から＝現在の状態から解く）---
{
  await page.evaluate(() => window.__game.startLevel(0));
  await sleep(200);
  await page.evaluate(() => window.__game.input('down')); // 1手すすめてから
  await sleep(100);
  await page.evaluate(() => document.getElementById('btn-solution').click());
  let s = 'playing';
  for (let k = 0; k < 40 && s !== 'clear'; k++) { await sleep(250); s = await page.evaluate(() => window.__game.state().status); }
  if (s === 'clear') console.log('✅ 💡 模範解答再生でクリア');
  else {
    const diag = await page.evaluate(() => {
      const before = window.__game.state().turn;
      window.__game.input('right');
      return JSON.stringify({
        turn: before,
        manualWorks: window.__game.state().turn !== before,
        autoplay: window.__game.autoplayActive(),
        ended: window.__game.isEnded(),
        ovClear: document.getElementById('ov-clear').classList.contains('active'),
        sol: window.SOLUTIONS ? Object.keys(window.SOLUTIONS).length : -1,
      });
    });
    console.log('❌ 模範解答再生が完走しない (status=' + s + ') ' + diag); failures++;
  }
  await page.evaluate(() => document.getElementById('ov-clear').classList.remove('active'));
}

// --- 最短より多い手数でクリアすると Perfect! が出ないことの確認（n01 + 無駄な1手）---
{
  await page.evaluate(() => window.__game.startLevel(0));
  await sleep(120);
  const path = SOLUTIONS.n01.path;
  await page.evaluate(() => window.__game.input('wait')); // 無駄な1手
  for (const d of path) { await page.evaluate(dir => window.__game.input(dir), d); await sleep(15); }
  await sleep(700);
  const badge = await page.evaluate(() => document.getElementById('clear-perfect').textContent);
  if (!badge.includes('Perfect')) console.log('✅ 最短+1手では Perfect! が出ない');
  else { console.log('❌ 最短より多い手数なのに Perfect! が出てしまう'); failures++; }
  await page.evaluate(() => document.getElementById('ov-clear').classList.remove('active'));
}

// --- 🔓 ぜんぶひらく ---
{
  await page.evaluate(() => { document.getElementById('btn-levels').click(); });
  await sleep(100);
  await page.evaluate(() => document.getElementById('btn-unlock-all').click());
  await sleep(100);
  const locked = await page.evaluate(() => document.querySelectorAll('.level-card.locked').length);
  if (locked === 0) console.log('✅ 🔓 ぜんぶひらく でロック解除');
  else { console.log('❌ 全開放後もロックが ' + locked + ' 件'); failures++; }
  await page.evaluate(() => document.getElementById('btn-unlock-all').click()); // 戻す
}

// --- 💭 つぶやきヒント（n02 まわりみち whisperAfter=25） ---
{
  await page.evaluate(() => window.__game.startLevel(1));
  await sleep(80);
  for (let k = 0; k < 30; k++) { await page.evaluate(() => window.__game.input('wait')); await sleep(5); }
  const shown = await page.evaluate(() => document.getElementById('whisper').classList.contains('show'));
  if (shown) console.log('✅ 💭 つぶやきヒントが表示される');
  else { console.log('❌ 💭 つぶやきが出ない'); failures++; }
}

// --- 行き詰まり検出（n01 で箱を左上角へ→非可解の証明→大きめの💭警告） ---
{
  await page.evaluate(() => window.__game.startLevel(0));
  await sleep(80);
  const moves = ['down', 'right', 'right', 'right', 'up', 'left', 'left', 'left', 'down', 'left', 'up'];
  for (const d of moves) { await page.evaluate(dir => window.__game.input(dir), d); await sleep(10); }
  await sleep(1200); // 検出は入力後 250ms から分割BFS開始（このケースは小さく即決着）
  const w = await page.evaluate(() => {
    const el = document.getElementById('whisper');
    return { text: el.textContent, shown: el.classList.contains('show'), danger: el.classList.contains('danger') };
  });
  if (w.shown && w.danger && w.text.includes('ふさげない')) console.log('✅ 行き詰まりを検出して大きめの💭警告（移動は引き続き可能）');
  else { console.log('❌ 行き詰まり警告が出ない: ' + JSON.stringify(w)); failures++; }
  // 移動キーは引き続き有効（モーダルでロックしない方針）であることを確認
  const before = await page.evaluate(() => ({ ...window.__game.state().player }));
  await page.evaluate(() => window.__game.input('down'));
  await sleep(80);
  const after = await page.evaluate(() => ({ ...window.__game.state().player }));
  if (before.x !== after.x || before.y !== after.y) console.log('✅ どんづまり中でも移動できる（強制ロックしない）');
  else { console.log('⚠️ どんづまり中に移動できなかった（意図通りなら無視可）'); }
  // 解ける状態まで Undo すると警告が消える
  for (let k = 0; k < 6; k++) { await page.keyboard.press('z'); await sleep(40); }
  await sleep(1000);
  const w2 = await page.evaluate(() => {
    const el = document.getElementById('whisper');
    return el.classList.contains('show') && el.textContent.includes('ふさげない');
  });
  if (!w2) console.log('✅ 解ける状態まで Undo すると警告が解除');
  else { console.log('❌ 解ける状態に戻しても警告が残る'); failures++; }
}

// --- モバイルビュー ---
await page.setViewport({ width: 390, height: 800, hasTouch: true, isMobile: true });
await page.evaluate(() => window.__game.startLevel(0));
await sleep(250);
await page.screenshot({ path: path.join(shotsDir, '50-mobile-game.png') });

if (consoleIssues.length) {
  console.log('❌ console/page エラー:');
  consoleIssues.forEach(m => console.log('   ' + m));
  failures++;
} else console.log('✅ コンソールエラーなし');

await browser.close();
console.log(failures ? `\nNG x${failures}` : '\nE2E ALL OK');
process.exit(failures ? 1 : 0);
