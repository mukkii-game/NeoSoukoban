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
      spawnOnce: !!level.spawnOnce, // true なら各穴は生涯で1体しか湧かない
      rules: { wallPush: true, ghostPush: true, holePush: true, mirrorAxis: true },
      lastAxis: '', // プレイヤーが最後に動いた軸 'h'|'v'|''（おばけの追跡軸の優先に使う）
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
        else if (ch === 'G') s.ghosts.push({ x, y, stun: 0, momentum: null, wobbling: false });
        else if (ch === 'O') s.holes.push({ x, y, plugged: false, pluggedBy: null, counter: level.spawnInterval || 0, spawned: false });
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
      spawnInterval: s.spawnInterval, ghostCap: s.ghostCap, spawnOnce: s.spawnOnce,
      rules: s.rules,   // 不変なので共有
      walls: s.walls,   // 不変なので共有
      hard: s.hard,     // 不変なので共有
      holes: s.holes.map(o => ({ x: o.x, y: o.y, plugged: o.plugged, pluggedBy: o.pluggedBy, counter: o.counter, spawned: o.spawned })),
      player: { x: s.player.x, y: s.player.y },
      boxes: s.boxes.map(b => ({ x: b.x, y: b.y, kind: b.kind })),
      ghosts: s.ghosts.map(g => ({ x: g.x, y: g.y, stun: g.stun, momentum: g.momentum, wobbling: !!g.wobbling })),
      turn: s.turn, status: s.status, lastAxis: s.lastAxis,
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
    let ddx = signedDelta(g.x, s.player.x, s.w, s.wrap);
    let ddy = signedDelta(g.y, s.player.y, s.h, s.wrap);
    // ループ面: 近く（マンハッタン距離3以内）ではワープ越しに追うが、
    // 遠いときはワープのことを忘れてまっすぐ向かう（直感に合わせる）
    if (s.wrap) {
      const pdx = s.player.x - g.x, pdy = s.player.y - g.y;
      if (Math.abs(pdx) + Math.abs(pdy) > 3) { ddx = pdx; ddy = pdy; }
    }
    const cands = [];
    const hstep = { dx: Math.sign(ddx), dy: 0 };
    const vstep = { dx: 0, dy: Math.sign(ddy) };
    // 軸の優先: プレイヤーが最後に動いた軸に合わせてついてくる（鏡像軸）。
    // 動いていない/その軸の差が0のときは距離の大きい軸を優先。
    let preferH;
    if (s.rules.mirrorAxis && s.lastAxis === 'h' && ddx !== 0) preferH = true;
    else if (s.rules.mirrorAxis && s.lastAxis === 'v' && ddy !== 0) preferH = false;
    else preferH = Math.abs(ddx) >= Math.abs(ddy);
    if (preferH) {
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

  // おばけの列を dx,dy 方向に押す共通処理（プレイヤーが直接押す場合と、
  // 箱がおばけに突き当たって押す場合の両方から呼ばれる）。
  // soloAlwaysDodges が true のときだけ、単体（列の長さ1）は「よけて戻る」
  // （＝押し手の後ろが空くので逃げ場がある）。false のときは単体でも戻れず
  // その場に留まる（＝箱に押された場合。箱自身が戻り先を塞いでしまうため）。
  // hadMomentum: 前ターンに（連結列の一員として）押されて生き残った子を
  // その時の方向つきで記録した Map（ghost -> dir文字列）。
  // 同じ方向へ押され続けている（＝直前ターンにも同方向に押されて動いていた）
  // 単体は、まだ勢いがついているとみなしてよけない＝連打・長押しし続ける限り
  // 列がちぎれても最後の1体まで押し込める。方向を変えたり1手でも他のことを
  // すると勢いは失われ、次に押されたときはまた素直によける。
  // touchedWobble: このターンに動かされた（ばたばた判定を再評価された）子の集合。
  // ターン末尾の確定スイープで「前ターンからばたついていたが今ターンは
  // 触られなかった子」だけを確定させるために使う。
  // 戻り値: { blocked:true, cx, cy } / { dodge:true } / { moved:true }
  function pushGhostChain(s, events, ghost, dx, dy, dirName, soloAlwaysDodges, hadMomentum, touchedWobble) {
    const chain = [ghost];
    let cx = ghost.x, cy = ghost.y, loop = false;
    while (true) {
      const n = cellInDir(s, cx, cy, dx, dy);
      const g2 = ghostAt(s, n.x, n.y);
      cx = n.x; cy = n.y;
      if (!g2) break;
      if (chain.includes(g2)) { loop = true; break; } // wrap一周の輪
      chain.push(g2);
    }
    if (loop || (cx === s.player.x && cy === s.player.y)) {
      return { blocked: true, cx, cy };
    }
    // 単体（列の長さ1）をプレイヤーが直接押す場合だけは特別扱い: 先が壁でも
    // 箱でも「何もできずに弾かれる」のではなく、必ず「ヒョイ」で済ませる
    // （逃げ場の有無を問わず、単体は常によける）。2体以上の列や箱に押された
    // 場合は、これまでどおり壁・箱で本当にブロックされる。
    const soloCanDodgeHere = chain.length === 1 && soloAlwaysDodges && !ghost.wobbling;
    const wallOrBoxBlocked = isWall(s, cx, cy) || boxAt(s, cx, cy);
    if (wallOrBoxBlocked && !soloCanDodgeHere) {
      return { blocked: true, cx, cy };
    }
    const hole = wallOrBoxBlocked ? null : openHoleAt(s, cx, cy);
    if (soloCanDodgeHere && (wallOrBoxBlocked || !!hole || hadMomentum.get(ghost) !== dirName)) {
      // 単体のおばけは、押し手の後ろが空いていれば必ずよけて戻る
      // （逃げ場がなくなる＝2体以上の連結か、箱に押された場合、既にばたばた中
      // だけ捕まる）。「勢い」は床を進むときだけ足踏みを省く効果で、
      // 穴・壁・箱に対しては勢いだけでは捕まらない/ブロックされない＝
      // 単体で触れたら必ずよける（連結2体以上でなければ捕まらない、という
      // 原則を守る）。
      ghost.stun = 1; // よけるのに精一杯で、このターンは動けない
      events.push({ type: 'dodge', x: ghost.x, y: ghost.y, dx, dy, tx: cx, ty: cy });
      return { dodge: true };
    }
    // 遠い側から順に1マスずつ進める。各メンバーの行き先が開いた穴なら、
    // その先にも穴が連続している（＝連結2体以上でさらに奥へ伸ばせる）か、
    // もしくは自分が既にばたばた中（前ターンからの続き）なら即プラグせず
    // 「ばたばた」状態で足踏みする（次のターンに動かされなければ確定して落ちる）。
    // それ以外（孤立した穴、または単体の即席キャッチ）は従来どおり即プラグ。
    // holeTouchedInChain: この列のどこか（自分より奥）で穴に触れた（プラグ／
    // ばたばた化した）瞬間、その巻き添えで単体になった残りの子に「勢い」を
    // タダで持たせない。穴が絡まなかった純粋な床の連結押しだけ、従来どおり
    // 勢いがつく（連打・長押しを続ける限りよけずに済む、という趣旨を維持）。
    let holeTouchedInChain = false;
    for (let i = chain.length - 1; i >= 0; i--) {
      const g = chain[i];
      const fx = g.x, fy = g.y;
      const n = cellInDir(s, fx, fy, dx, dy);
      const h = openHoleAt(s, n.x, n.y);
      g.x = n.x; g.y = n.y;
      g.stun = 1; // 押されたおばけは目を回してこのターン動けない
      touchedWobble.add(g);
      if (h) {
        holeTouchedInChain = true;
        const beyond = cellInDir(s, n.x, n.y, dx, dy);
        const extendable = chain.length >= 2 && !!openHoleAt(s, beyond.x, beyond.y);
        if (g.wobbling || extendable) {
          g.wobbling = true;
          events.push({ type: 'land', what: 'ghost', fx, fy, tx: n.x, ty: n.y });
        } else {
          h.plugged = true; h.pluggedBy = 'ghost';
          s.ghosts.splice(s.ghosts.indexOf(g), 1);
          events.push({ type: 'plug', x: n.x, y: n.y, what: 'ghost', fx, fy });
        }
      } else {
        g.wobbling = false;
        g.momentum = holeTouchedInChain ? null : dirName; // 次のターンも同方向に押され続ければ、よけずに済む
        events.push({ type: 'push', what: 'ghost', fx, fy, tx: n.x, ty: n.y });
      }
    }
    return { moved: true };
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
    // 前ターンの「勢い」を読み取ってから、このターンぶんはいったん全員リセット
    // （このターンに押された子だけ、末尾で改めてセットし直す）
    const hadMomentum = new Map();
    for (const g of s.ghosts) { if (g.momentum) hadMomentum.set(g, g.momentum); g.momentum = null; }
    // ばたばた（穴に乗ったがまだ確定していない）おばけの、今ターン開始時点の一覧と、
    // 今ターンに動かされた(押された)ものの一覧
    const wasWobbling = new Set(s.ghosts.filter(g => g.wobbling));
    const touchedWobble = new Set();

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
        // 箱・かべ: 1つだけ押せる。先におばけがいる場合は、箱でおばけ（の列）を
        // 押しのける（箱自身が戻り先を塞ぐので、単体のおばけでも逃げられない）。
        const u = cellInDir(s, t.x, t.y, dx, dy);
        const blockedByWall = (box.kind === 'wall' && !s.rules.wallPush) ||
          isWall(s, u.x, u.y) || boxAt(s, u.x, u.y) || (u.x === s.player.x && u.y === s.player.y);
        const blockingGhost = blockedByWall ? null : ghostAt(s, u.x, u.y);
        if (blockedByWall) {
          fail('bonk', u.x, u.y, { what: box.kind, ox: t.x, oy: t.y });
        } else if (blockingGhost) {
          if (!s.rules.ghostPush) {
            fail('bonk', u.x, u.y, { what: box.kind, ox: t.x, oy: t.y });
          } else {
            const result = pushGhostChain(s, events, blockingGhost, dx, dy, dir, false, hadMomentum, touchedWobble);
            if (result.blocked) {
              fail('bonk', result.cx, result.cy, { what: box.kind, ox: t.x, oy: t.y });
            } else {
              // おばけを押しのけた先（u）が、湧いた直後でまだ動いていない等の
              // 理由でまだ塞がっていない穴だった場合は、通常どおり箱がそこに
              // 落ちて塞ぐ（おばけが退いただけで箱がただ乗っかるのは変）。
              const holeAtU = openHoleAt(s, u.x, u.y);
              if (holeAtU) {
                holeAtU.plugged = true; holeAtU.pluggedBy = box.kind;
                s.boxes.splice(s.boxes.indexOf(box), 1);
                events.push({ type: 'plug', x: u.x, y: u.y, what: box.kind, fx: t.x, fy: t.y });
              } else {
                box.x = u.x; box.y = u.y;
                events.push({ type: 'push', what: box.kind, fx: t.x, fy: t.y, tx: u.x, ty: u.y });
              }
              s.player.x = t.x; s.player.y = t.y;
            }
          }
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
        // おばけ: 列になっていればまとめて押せる（チェーン押し）。
        // プレイヤーが直接押す場合、単体は必ずよけて戻る（soloAlwaysDodges=true）。
        if (!s.rules.ghostPush) {
          fail('bonk', t.x, t.y);
        } else {
          const result = pushGhostChain(s, events, ghost, dx, dy, dir, true, hadMomentum, touchedWobble);
          if (result.blocked) {
            fail('bonk', result.cx, result.cy);
          } else if (result.moved) {
            s.player.x = t.x; s.player.y = t.y;
          }
          // result.dodge の場合、プレイヤーは動かない（今までどおり）
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
    if (dir !== 'wait' && (s.player.x !== prev.player.x || s.player.y !== prev.player.y ||
        events.some(e => e.type === 'push' || e.type === 'plug' || e.type === 'holePush'))) {
      s.lastAxis = dx !== 0 ? 'h' : 'v';
    }

    // --- 1b) ばたばた確定スイープ: 前ターンからばたついていて、今ターン
    // 動かされなかった子はここで確定して落ちる。
    for (const g of s.ghosts.slice()) {
      if (g.wobbling && wasWobbling.has(g) && !touchedWobble.has(g)) {
        const h = holeAt(s, g.x, g.y);
        if (h && !h.plugged) {
          h.plugged = true; h.pluggedBy = 'ghost';
          s.ghosts.splice(s.ghosts.indexOf(g), 1);
          events.push({ type: 'plug', x: g.x, y: g.y, what: 'ghost', fx: g.x, fy: g.y });
        }
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
    // 連結追従（ぱっくまんの列）: プレイヤーが空けたマスに隣の子が入り、
    // その子が空けたマスにさらに隣の子が入り……と、遠ざからない限り列ごと続く。
    // 列に入らなかった子は鏡像軸（プレイヤーが最後に動いた軸を優先）で近づく。
    const pOldX = prev.player.x, pOldY = prev.player.y;
    const playerMoved = s.player.x !== pOldX || s.player.y !== pOldY;
    sortGhosts(s);
    const acted = new Set();
    for (const g of s.ghosts) {
      if (g.stun > 0) { g.stun--; acted.add(g); events.push({ type: 'dizzy', x: g.x, y: g.y }); }
      if (g.wobbling) acted.add(g); // ばたばた中は自分から動かない（押されたときだけ動く）
    }
    const dist = (x1, y1, x2, y2) =>
      Math.abs(signedDelta(x1, x2, s.w, s.wrap)) + Math.abs(signedDelta(y1, y2, s.h, s.wrap));
    // プレイヤーから途切れずつながっている「列」のメンバーは、道なりに無条件で追従する。
    // 列に属していない子だけ「そこへ入ると遠ざかるなら合流しない」ガードが効く。
    const trainSet = new Set();
    {
      const frontier = [{ x: pOldX, y: pOldY }, { x: s.player.x, y: s.player.y }];
      while (frontier.length) {
        const c = frontier.pop();
        for (const g of s.ghosts) {
          if (trainSet.has(g)) continue;
          if (dist(g.x, g.y, c.x, c.y) === 1) { trainSet.add(g); frontier.push({ x: g.x, y: g.y }); }
        }
      }
    }
    if (playerMoved) {
      let vac = { x: pOldX, y: pOldY };
      for (let hop = 0; hop < s.ghosts.length && vac; hop++) {
        if (occupied(s, vac.x, vac.y) || openHoleAt(s, vac.x, vac.y) ||
            (vac.x === s.player.x && vac.y === s.player.y)) break;
        let follower = null;
        for (const g of s.ghosts) {
          if (acted.has(g)) continue;
          if (dist(g.x, g.y, vac.x, vac.y) !== 1) continue;
          if (!trainSet.has(g) &&
              dist(vac.x, vac.y, s.player.x, s.player.y) > dist(g.x, g.y, s.player.x, s.player.y)) continue;
          follower = g; break;
        }
        if (!follower) break;
        const fx = follower.x, fy = follower.y;
        follower.x = vac.x; follower.y = vac.y;
        acted.add(follower);
        events.push({ type: 'ghostMove', fx, fy, tx: vac.x, ty: vac.y, chain: true });
        vac = { x: fx, y: fy };
      }
    }
    // きんぎょのフン: プレイヤーから途切れずつながっている子は隊列を保つ（勝手に崩れない）
    const inTrain = new Set();
    {
      const frontier = [{ x: s.player.x, y: s.player.y }];
      while (frontier.length) {
        const c = frontier.pop();
        for (const g of s.ghosts) {
          if (inTrain.has(g)) continue;
          if (dist(g.x, g.y, c.x, c.y) === 1) { inTrain.add(g); frontier.push({ x: g.x, y: g.y }); }
        }
      }
    }
    for (const g of s.ghosts) {
      if (acted.has(g)) continue;
      if (inTrain.has(g)) continue; // 隊列保持
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
        if (s.spawnOnce && o.spawned) continue; // 生涯で1体だけの穴は、湧いたら二度と湧かない
        if (o.counter > 0) o.counter--;
        if (o.counter <= 0) {
          if (s.ghosts.length < s.ghostCap && !occupied(s, o.x, o.y) &&
              !(s.player.x === o.x && s.player.y === o.y)) {
            s.ghosts.push({ x: o.x, y: o.y, stun: 0, momentum: null, wobbling: false }); // 湧いたターンは動かない
            o.counter = s.spawnInterval;
            o.spawned = true;
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
    const ghosts = s.ghosts.map(g => g.x + ',' + g.y + (g.stun ? '*' : '') + (g.momentum ? 'm' + g.momentum[0] : '') + (g.wobbling ? 'w' : '')).sort().join('|');
    const holes = s.holes.map(o => o.x + ',' + o.y + ':' + (o.plugged ? 'X' : o.counter) + (o.spawned ? 's' : '')).join('|');
    return s.player.x + ',' + s.player.y + ';' + boxes + ';' + ghosts + ';' + holes + ';' + s.lastAxis;
  }

  return {
    DIRS, parseLevel, clone, step, serialize,
    isWall, holeAt, openHoleAt, boxAt, ghostAt, cellInDir,
  };
});
