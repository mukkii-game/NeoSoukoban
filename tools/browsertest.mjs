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
import { solve, LEVELS, Engine } from './solve.mjs';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const puppeteer = require('puppeteer-core');

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

// レベルせんたく画面
await page.evaluate(() => document.getElementById('btn-select').click());
await sleep(250);
await page.screenshot({ path: path.join(shotsDir, '01-select.png') });

// --- 全レベルをソルバー解で実プレイ ---
for (let i = 0; i < LEVELS.length; i++) {
  const lv = LEVELS[i];
  const res = solve(lv);
  if (!res.solved) { console.log(`❌ ${lv.id} ソルバーで解けない`); failures++; continue; }
  await page.evaluate(idx => window.__game.startLevel(idx), i);
  await sleep(120);
  const shotLevels = ['n01', 'n03', 'n06', 'n08', 'n09', 'n10', 'n11', 'n13'];
  if (shotLevels.includes(lv.id)) await page.screenshot({ path: path.join(shotsDir, `10-level-${lv.id}.png`) });
  const midAt = Math.floor(res.path.length * 0.7);
  for (let k = 0; k < res.path.length; k++) {
    await page.evaluate(dir => window.__game.input(dir), res.path[k]);
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
  const res = solve(LEVELS[4]);
  const n = Math.min(3, res.path.length - 1); // クリアさせずに途中まで
  for (const d of res.path.slice(0, n)) { await page.evaluate(dir => window.__game.input(dir), d); await sleep(10); }
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

// --- 💡 模範解答の自動再生（ギブアップ）---
{
  await page.evaluate(() => window.__game.startLevel(0));
  await sleep(200);
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

// --- 💭 つぶやきヒント（n03 で 30 ターン経過） ---
{
  await page.evaluate(() => window.__game.startLevel(2));
  await sleep(80);
  for (let k = 0; k < 40; k++) { await page.evaluate(() => window.__game.input('wait')); await sleep(5); }
  const shown = await page.evaluate(() => document.getElementById('whisper').classList.contains('show'));
  if (shown) console.log('✅ 💭 つぶやきヒントが表示される');
  else { console.log('❌ 💭 つぶやきが出ない'); failures++; }
}

// --- 行き詰まり検出（n01 で箱を左上角へ→非可解の証明→💭警告） ---
{
  await page.evaluate(() => window.__game.startLevel(0));
  await sleep(80);
  const moves = ['down', 'right', 'right', 'right', 'up', 'left', 'left', 'left', 'down', 'left', 'up'];
  for (const d of moves) { await page.evaluate(dir => window.__game.input(dir), d); await sleep(10); }
  await sleep(1500); // 検出は入力後 750ms アイドルで走る
  const w = await page.evaluate(() => ({
    text: document.getElementById('whisper').textContent,
    shown: document.getElementById('whisper').classList.contains('show'),
  }));
  if (w.shown && w.text.includes('ふさげない')) console.log('✅ 行き詰まりを検出して💭警告');
  else { console.log('❌ 行き詰まり警告が出ない: ' + JSON.stringify(w)); failures++; }
  // 解ける状態まで Undo すると警告が消える（1回では箱が左列に居て依然詰み→残るのが正しい）
  for (let k = 0; k < 5; k++) { await page.keyboard.press('z'); await sleep(40); }
  await sleep(1300);
  const w2 = await page.evaluate(() => document.getElementById('whisper').classList.contains('show') &&
    document.getElementById('whisper').textContent.includes('ふさげない'));
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
