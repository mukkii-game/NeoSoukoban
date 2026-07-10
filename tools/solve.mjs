/* tools/solve.mjs — 全レベルの機械検証
 * 使い方:
 *   node tools/solve.mjs           # 全レベル: クリア可能 + ナイーブ非可解の検証
 *   node tools/solve.mjs n05      # 特定レベルのみ（解手順も表示）
 */
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const Engine = require('../engine.js');
const LEVELS = require('../levels.js');

const DIR_KEYS = ['up', 'down', 'left', 'right', 'wait'];
const DIR_CHAR = { up: '↑', down: '↓', left: '←', right: '→', wait: '・' };

function makeStart(level, overrides = {}) {
  // overrides: {brickPush, ghostPush, holePush, wrap, spawnInterval, noGhosts}
  const lvl = { ...level };
  if (overrides.wrap !== undefined) lvl.wrap = overrides.wrap;
  if (overrides.spawnInterval !== undefined) lvl.spawnInterval = overrides.spawnInterval;
  if (overrides.noGhosts) lvl.map = level.map.map(r => r.replace(/G/g, '.'));
  const s = Engine.parseLevel(lvl);
  if (overrides.noGhosts) s.ghostCap = 0;
  s.rules = { ...s.rules };
  for (const k of ['wallPush', 'ghostPush', 'holePush', 'mirrorAxis']) {
    if (overrides[k] !== undefined) s.rules[k] = overrides[k];
  }
  return s;
}

export function solve(level, overrides = {}, opts = {}) {
  const maxStates = opts.maxStates || 3_000_000;
  const maxDepth = opts.maxDepth || 400;
  const deadlineMs = opts.deadlineMs || 20_000; // 壁時計タイムアウト（既定20秒）。CLI 側でさらに上書き可
  const progressEvery = opts.progressEvery || 0; // >0 なら深さ何段ごとに進捗を stderr へ
  const t0 = Date.now();
  const start = makeStart(level, overrides);
  const seen = new Set([Engine.serialize(start)]);
  let frontier = [{ s: start, path: [] }];
  for (let depth = 0; depth < maxDepth && frontier.length; depth++) {
    if (Date.now() - t0 > deadlineMs) {
      return { solved: false, reason: 'timeout', states: seen.size, ms: Date.now() - t0 };
    }
    if (progressEvery && depth % progressEvery === 0) {
      process.stderr.write(`   … depth ${depth}, frontier ${frontier.length}, seen ${seen.size}, ${Date.now() - t0}ms\n`);
    }
    const next = [];
    for (const node of frontier) {
      for (const d of DIR_KEYS) {
        const { state, turnConsumed } = Engine.step(node.s, d);
        if (!turnConsumed) continue;
        const key = Engine.serialize(state);
        if (seen.has(key)) continue;
        seen.add(key);
        if (state.status === 'clear') {
          return { solved: true, moves: depth + 1, path: [...node.path, d], states: seen.size };
        }
        if (seen.size > maxStates) {
          return { solved: false, reason: 'state-explosion', states: seen.size };
        }
        next.push({ s: state, path: [...node.path, d] });
        if (next.length > 400000) {
          return { solved: false, reason: 'state-explosion', states: seen.size }; // メモリガード
        }
      }
      if (Date.now() - t0 > deadlineMs) {
        return { solved: false, reason: 'timeout', states: seen.size, ms: Date.now() - t0 };
      }
    }
    frontier = next;
  }
  return {
    solved: false,
    reason: frontier.length ? 'depth-limit' : 'exhausted(証明済み非可解)',
    states: seen.size,
  };
}

export { LEVELS, Engine };

// CLI として直接実行されたときだけ検証を走らせる
if (process.argv[1] && process.argv[1].endsWith('solve.mjs')) {
  runCli();
}
function runCli() {
const emit = process.argv.includes('--emit');
const only = process.argv.find(a => LEVELS.some(l => l.id === a));
const solutions = {};

/* 巨大面用: 段階的グリーディ探索。
 * 「穴がもう1つ塞がる状態」までの BFS を繰り返して手順を継ぎ足す。
 * 最短性は保証しないが、決定論エンジンなので手順=クリア可能の証明（witness）になる。 */
function greedySolve(level, opts = {}) {
  let s = makeStart(level, {});
  const full = [];
  const stageCap = opts.stageStates || 600000;
  for (let stage = 0; stage < 60; stage++) {
    const plugged0 = s.holes.filter(o => o.plugged).length;
    const seen = new Set([Engine.serialize(s)]);
    let frontier = [{ s, path: [] }];
    let found = null;
    while (frontier.length && !found) {
      const next = [];
      for (const node of frontier) {
        for (const d of DIR_KEYS) {
          const { state, turnConsumed } = Engine.step(node.s, d);
          if (!turnConsumed) continue;
          const k = Engine.serialize(state);
          if (seen.has(k)) continue;
          seen.add(k);
          const p = [...node.path, d];
          const plugged = state.holes.filter(o => o.plugged).length;
          if (state.status === 'clear' || plugged > plugged0) { found = { state, p }; break; }
          if (seen.size > stageCap) return { solved: false, reason: 'greedy-stage-explosion(stage ' + stage + ')' };
          next.push({ s: state, path: p });
          if (next.length > 300000) return { solved: false, reason: 'greedy-frontier-explosion(stage ' + stage + ')' };
        }
        if (found) break;
      }
      if (!found) frontier = next;
    }
    if (!found) return { solved: false, reason: 'greedy-stage-exhausted(stage ' + stage + ')' };
    full.push(...found.p);
    s = found.state;
    if (s.status === 'clear') return { solved: true, moves: full.length, path: full, greedy: true };
  }
  return { solved: false, reason: 'greedy-stage-limit' };
}
let allOk = true;
for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  const t0 = Date.now();
  let res = solve(level);
  if (!res.solved && res.reason === 'state-explosion') {
    console.log(`   … ${level.id}: BFS爆発(${res.states}) → グリーディ探索に切替`);
    res = greedySolve(level);
  }
  const ms = Date.now() - t0;
  if (res.solved) {
    // おばけ・湧きが解に絡んでいるかの診断（絡まないなら min 手数が変わらない）
    let diag = '';
    if (!res.greedy && (/G/.test(level.map.join('')) || level.spawnInterval)) {
      const ng = solve(level, { noGhosts: true, spawnInterval: 0 });
      diag = ng.solved
        ? ` [おばけ無し: ${ng.moves}手 ${ng.moves === res.moves ? '⚠️飾り?' : 'OK絡む'}]`
        : (String(ng.reason).startsWith('exhausted')
          ? ' [おばけ無しでは非可解=必須]'
          : ' [おばけ無し診断: 判定不能(爆発)]');
    }
    const kind = res.greedy ? 'witness(グリーディ)' : '最短';
    console.log(`✅ ${level.id} ${level.name}: ${kind} ${res.moves} 手 (${res.states || '-'} states, ${ms}ms)${diag}`);
    if (only) console.log('   ' + res.path.map(d => DIR_CHAR[d]).join(''));
    solutions[level.id] = { path: res.path, par: res.moves, greedy: !!res.greedy };
  } else {
    allOk = false;
    console.log(`❌ ${level.id} ${level.name}: 解けない! ${res.reason} (${res.states} states, ${ms}ms)`);
  }
  if (level.verifyNaive) {
    for (const ov of level.verifyNaive) {
      const t1 = Date.now();
      const nres = solve(level, ov);
      const nms = Date.now() - t1;
      if (!nres.solved && String(nres.reason).startsWith('exhausted')) {
        console.log(`   ✅ naive ${JSON.stringify(ov)}: 非可解を証明 (${nres.states} states, ${nms}ms)`);
      } else if (nres.solved) {
        allOk = false;
        console.log(`   ❌ naive ${JSON.stringify(ov)}: ${nres.moves} 手で解けてしまう!`);
      } else {
        allOk = false;
        console.log(`   ⚠️ naive ${JSON.stringify(ov)}: 判定不能 (${nres.reason})`);
      }
    }
  }
}
if (emit && allOk && !only) {
  const outPath = fileURLToPath(new URL('../solutions.js', import.meta.url));
  const body = JSON.stringify(solutions, null, 0);
  writeFileSync(outPath,
    '/* solutions.js — AUTO-GENERATED by `node tools/solve.mjs --emit`. 手で編集しない。\n' +
    ' * 各レベルの模範解答（ギブアップ再生用）。レベルやルールを変えたら再生成すること。 */\n' +
    '(function (root, factory) {\n' +
    "  if (typeof module !== 'undefined' && module.exports) module.exports = factory();\n" +
    '  else root.SOLUTIONS = factory();\n' +
    "})(typeof window !== 'undefined' ? window : globalThis, function () {\n" +
    "  'use strict';\n" +
    '  return ' + body + ';\n' +
    '});\n');
  console.log('📝 solutions.js を再生成しました');
}
console.log(allOk ? '\nALL OK' : '\nNG があります');
process.exit(allOk ? 0 : 1);
}
