/* engine.js — 『あなふさぎのよる』純粋ゲームロジック
 * DOM / audio / 乱数 / リアルタイム要素 禁止（CLAUDE.md 参照）。
 * ブラウザでは window.Engine、Node では module.exports として公開される。
 *
 * マップ記号:
 *   #  かべ（実は押せる。ただし非 wrap 面の外周は「外側に立てない」ため幾何的に不動）
 *   X  おせないかべ（見た目がほんの少しだけ違う）
 *   .  床 / P プレイヤー / B 箱 / G おばけ / O 穴
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0], wait: [0, 0] };

  // レベル定義 → 初期状態
  function parseLevel(level) {
    const rows = level.map;
    const h = rows.length;
    const w = rows[0].length;
    const s = {
      w, h,
      wrap: !!level.wrap,
      spawnInterval: level.spawnInterval || 0,
      ghostCap: level.ghostCap != null ? level.ghostCap : 4,
      rules: { wallPush: true, ghostPush: true, holePush: true },
      walls: new Array(w * h).fill(false), // 静的なかべ（X と、非wrap面の外周 #）
      hard: new Array(w * h).fill(false),  // X（見た目区別用。UI 専用）
      holes: [],   // {x,y,plugged,pluggedBy,counter}
      player: null,
      boxes: [],   // {x,y,kind:'box'|'wall'} … 押せるもの（かべ含む）
      ghosts: [],  // {x,y,stun}
      turn: 0,
      status: 'playing', // 'playing' | 'clear'（敗北は存在しない）
    };
    for (let y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error(level.name + ': row ' + y + ' width mismatch');
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '#') {
          // 非 wrap 面の外周は誰も外側に立てないので静的扱いにできる（ソルバー高速化）
          if (!s.wrap && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) s.walls[y * w + x] = true;
          else s.boxes.push({ x, y, kind: 'wall' });
        }
        else if (ch === 'X') { s.walls[y * w + x] = true; s.hard[y * w + x] = true; }
        else if (ch === '.') { /* floor */ }
        else if (ch === 'P') s.player = { x, y };
        else if (ch === 'B') s.boxes.push({ x, y, kind: 'box' });
        else if (ch === 'G') s.ghosts.push({ x, y, stun: 0 });
        else if (ch === 'O') s.holes.push({ x, y, plugged: false, pluggedBy: null, counter: level.spawnInterval || 0 });
        else throw new Error(level.name + ': unknown map char "' + ch + '"');
      }
    }
    if (!s.player) throw new Error(level.name + ': no player');
    if (!s.holes.length) throw new Error(level.name + ': no holes');
    sortGhosts(s);
    return s;
  }

  function clone(s) {
    return {
      w: s.w, h: s.h, wrap: s.wrap,
      spawnInterval: s.spawnInterval, ghostCap: s.ghostCap,
      rules: s.rules,   // 不変なので共有
      walls: s.walls,   // 不変なので共有
      hard: s.hard,     // 不変なので共有
      holes: s.holes.map(o => ({ x: o.x, y: o.y, plugged: o.plugged, pluggedBy: o.pluggedBy, counter: o.counter })),
      player: { x: s.player.x, y: s.player.y },
      boxes: s.boxes.map(b => ({ x: b.x, y: b.y, kind: b.kind })),
      ghosts: s.ghosts.map(g => ({ x: g.x, y: g.y, stun: g.stun })),
      turn: s.turn, status: s.status,
    };
  }

  function wrapCoord(v, size) { return ((v % size) + size) % size; }

  function cellInDir(s, x, y, dx, dy) {
    let nx = x + dx, ny = y + dy;
    if (s.wrap) { nx = wrapCoord(nx, s.w); ny = wrapCoord(ny, s.h); }
    return { x: nx, y: ny };
  }

  function inBounds(s, x, y) { return x >= 0 && y >= 0 && x < s.w && y < s.h; }
  function isWall(s, x, y) { return !inBounds(s, x, y) || s.walls[y * s.w + x]; }
  function holeAt(s, x, y) { for (const o of s.holes) if (o.x === x && o.y === y) return o; return null; }
  function openHoleAt(s, x, y) { const o = holeAt(s, x, y); return o && !o.plugged ? o : null; }
  function boxAt(s, x, y) { for (const b of s.boxes) if (b.x === x && b.y === y) return b; return null; }
  function ghostAt(s, x, y) { for (const g of s.ghosts) if (g.x === x && g.y === y) return g; return null; }
  function occupied(s, x, y) { return boxAt(s, x, y) || ghostAt(s, x, y); }

  // おばけの移動順は常に盤面の読み順（y→x）で固定し、順序非依存にする
  function sortGhosts(s) { s.ghosts.sort((a, b) => a.y - b.y || a.x - b.x); }

  // wrap 面では最短方向で追う
  function signedDelta(from, to, size, wrap) {
    let d = to - from;
    if (wrap) {
      const alt = d > 0 ? d - size : d + size;
      if (Math.abs(alt) < Math.abs(d)) d = alt;
    }
    return d;
  }

  // おばけ1体の次の位置（動けなければ null）。
  // プレイヤーのマスには入れない（このゲームに敗北は存在しない）。
  function ghostNext(s, g) {
    const ddx = signedDelta(g.x, s.player.x, s.w, s.wrap);
    const ddy = signedDelta(g.y, s.player.y, s.h, s.wrap);
    const cands = [];
    const hstep = { dx: Math.sign(ddx), dy: 0 };
    const vstep = { dx: 0, dy: Math.sign(ddy) };
    if (Math.abs(ddx) >= Math.abs(ddy)) {
      if (ddx !== 0) cands.push(hstep);
      if (ddy !== 0) cands.push(vstep);
    } else {
      if (ddy !== 0) cands.push(vstep);
      if (ddx !== 0) cands.push(hstep);
    }
    for (const c of cands) {
      const t = cellInDir(s, g.x, g.y, c.dx, c.dy);
      if (t.x === s.player.x && t.y === s.player.y) continue; // 入ってこられない
      if (isWall(s, t.x, t.y)) continue;
      if (occupied(s, t.x, t.y)) continue;
      if (openHoleAt(s, t.x, t.y)) continue; // おばけは自分からは穴に入らない
      return t;
    }
    return null;
  }

  /* 1入力 = 1ターン。決定論的に状態を進める。
   * できない操作（壁ドン・押せない・よけられる・こわい）でも世界は1ターン進む
   * ＝実質の「待つ」。明示的な wait も残す。
   * 返り値: { state, events, turnConsumed }
   */
  function step(prev, dir) {
    const events = [];
    if (prev.status !== 'playing' || !DIRS[dir]) return { state: prev, events, turnConsumed: false };
    const [dx, dy] = DIRS[dir];
    const s = clone(prev);
    const fail = (type, x, y, extra) => { events.push(Object.assign({ type, x, y }, extra || {})); };

    // --- 1) プレイヤーフェイズ ---
    if (dir === 'wait') {
      events.push({ type: 'wait', x: s.player.x, y: s.player.y });
    } else {
      const t = cellInDir(s, s.player.x, s.player.y, dx, dy);
      const box = isWall(s, t.x, t.y) ? null : boxAt(s, t.x, t.y);
      const ghost = (isWall(s, t.x, t.y) || box) ? null : ghostAt(s, t.x, t.y);

      if (isWall(s, t.x, t.y)) {
        fail('bonk', t.x, t.y);
      } else if (box) {
        // 箱・かべ: 1つだけ押せる
        const u = cellInDir(s, t.x, t.y, dx, dy);
        if ((box.kind === 'wall' && !s.rules.wallPush) ||
            isWall(s, u.x, u.y) || occupied(s, u.x, u.y) ||
            (u.x === s.player.x && u.y === s.player.y)) {
          fail('bonk', u.x, u.y);
        } else {
          const hole = openHoleAt(s, u.x, u.y);
          if (hole) {
            hole.plugged = true; hole.pluggedBy = box.kind;
            s.boxes.splice(s.boxes.indexOf(box), 1);
            events.push({ type: 'plug', x: u.x, y: u.y, what: box.kind, fx: t.x, fy: t.y });
          } else {
            box.x = u.x; box.y = u.y;
            events.push({ type: 'push', what: box.kind, fx: t.x, fy: t.y, tx: u.x, ty: u.y });
          }
          s.player.x = t.x; s.player.y = t.y;
        }
      } else if (ghost) {
        // おばけ: 列になっていればまとめて押せる（チェーン押し）
        if (!s.rules.ghostPush) {
          fail('bonk', t.x, t.y);
        } else {
          const chain = [ghost];
          let cx = t.x, cy = t.y, loop = false;
          while (true) {
            const n = cellInDir(s, cx, cy, dx, dy);
            const g2 = ghostAt(s, n.x, n.y);
            cx = n.x; cy = n.y;
            if (!g2) break;
            if (chain.includes(g2)) { loop = true; break; } // wrap一周の輪
            chain.push(g2);
          }
          const hole = loop ? null : openHoleAt(s, cx, cy);
          if (loop || isWall(s, cx, cy) || boxAt(s, cx, cy) ||
              (cx === s.player.x && cy === s.player.y)) {
            fail('bonk', cx, cy);
          } else if (chain.length === 1 && !hole) {
            // 単体のおばけは、真後ろが穴のとき（逃げ場がない）だけ押せる。
            // それ以外は 1コマ押し出されてから、するりと元の位置へ戻る。
            ghost.stun = 1; // よけるのに精一杯で、このターンは動けない
            fail('dodge', t.x, t.y, { dx, dy, tx: cx, ty: cy });
          } else {
            // 遠い側から順に1マスずつ進める
            for (let i = chain.length - 1; i >= 0; i--) {
              const g = chain[i];
              const n = cellInDir(s, g.x, g.y, dx, dy);
              if (i === chain.length - 1 && hole) {
                hole.plugged = true; hole.pluggedBy = 'ghost';
                s.ghosts.splice(s.ghosts.indexOf(g), 1);
                events.push({ type: 'plug', x: n.x, y: n.y, what: 'ghost', fx: g.x, fy: g.y });
              } else {
                events.push({ type: 'push', what: 'ghost', fx: g.x, fy: g.y, tx: n.x, ty: n.y });
                g.x = n.x; g.y = n.y;
                g.stun = 1; // 押されたおばけは目を回してこのターン動けない
              }
            }
            s.player.x = t.x; s.player.y = t.y;
          }
        }
      } else if (openHoleAt(s, t.x, t.y)) {
        // 穴そのものも押せる（知識アンロック）。押せないときは怖くて入れない
        const hole = openHoleAt(s, t.x, t.y);
        const u = cellInDir(s, t.x, t.y, dx, dy);
        const canSlide = s.rules.holePush &&
          !isWall(s, u.x, u.y) && !occupied(s, u.x, u.y) && !holeAt(s, u.x, u.y) &&
          !(u.x === s.player.x && u.y === s.player.y);
        if (!canSlide) {
          fail('scared', t.x, t.y);
        } else {
          const hi = s.holes.indexOf(hole);
          hole.x = u.x; hole.y = u.y;
          s.player.x = t.x; s.player.y = t.y;
          events.push({ type: 'holePush', hi, fx: t.x, fy: t.y, tx: u.x, ty: u.y });
        }
      } else {
        s.player.x = t.x; s.player.y = t.y;
        events.push({ type: 'walk', x: t.x, y: t.y });
      }
    }
    s.turn++;

    // --- 2) クリア判定（最後の穴を塞いだ瞬間に勝ち。おばけは動かない） ---
    if (s.holes.every(o => o.plugged)) {
      s.status = 'clear';
      events.push({ type: 'clear' });
      return { state: s, events, turnConsumed: true };
    }

    // --- 3) おばけフェイズ ---
    sortGhosts(s);
    for (const g of s.ghosts) {
      if (g.stun > 0) { g.stun--; events.push({ type: 'dizzy', x: g.x, y: g.y }); continue; }
      const t = ghostNext(s, g);
      if (!t) continue;
      const fx = g.x, fy = g.y;
      g.x = t.x; g.y = t.y;
      events.push({ type: 'ghostMove', fx, fy, tx: t.x, ty: t.y });
    }

    // --- 4) 湧きフェイズ ---
    if (s.spawnInterval > 0) {
      for (const o of s.holes) {
        if (o.plugged) continue;
        if (o.counter > 0) o.counter--;
        if (o.counter <= 0) {
          if (s.ghosts.length < s.ghostCap && !occupied(s, o.x, o.y) &&
              !(s.player.x === o.x && s.player.y === o.y)) {
            s.ghosts.push({ x: o.x, y: o.y, stun: 0 }); // 湧いたターンは動かない
            o.counter = s.spawnInterval;
            events.push({ type: 'spawn', x: o.x, y: o.y });
          }
          // cap 超過などで湧けない場合は counter 0 のまま次ターン再試行
        }
      }
    }

    return { state: s, events, turnConsumed: true };
  }

  // ソルバー用: 状態の正規化キー（turn は含めない）
  function serialize(s) {
    const boxes = s.boxes.map(b => b.kind[0] + b.x + ',' + b.y).sort().join('|');
    const ghosts = s.ghosts.map(g => g.x + ',' + g.y + (g.stun ? '*' : '')).sort().join('|');
    const holes = s.holes.map(o => o.x + ',' + o.y + ':' + (o.plugged ? 'X' : o.counter)).join('|');
    return s.player.x + ',' + s.player.y + ';' + boxes + ';' + ghosts + ';' + holes;
  }

  return {
    DIRS, parseLevel, clone, step, serialize,
    isWall, holeAt, openHoleAt, boxAt, ghostAt, cellInDir,
  };
});
