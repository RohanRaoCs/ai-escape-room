/* Path planning: A*, Dijkstra (uniform cost), Greedy best-first and BFS behind one interface.
 *
 * Two state spaces:
 *  - snapshot:   state = cell. Laser gates are frozen at their state at planning time t0.
 *  - space-time: state = (cell, t mod GATE_PERIOD). A WAIT action is allowed and every
 *                arrival is checked against the gate schedule at the actual arrival time,
 *                so the agent can time its passage through a laser gate instead of detouring.
 * Step cost comes from costFn(cell): base cost + coolant + fuzzy risk penalty. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const MOVES4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const MOVES5 = MOVES4.concat([[0, 0]]);

  function Heap() { this.p = []; this.v = []; }
  Heap.prototype.push = function (pri, val) {
    const p = this.p, v = this.v;
    let i = p.length;
    p.push(pri); v.push(val);
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= pri) break;
      p[i] = p[j]; v[i] = v[j]; i = j;
    }
    p[i] = pri; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const p = this.p, v = this.v;
    const top = v[0];
    const lp = p.pop(), lv = v.pop();
    const n = p.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && p[r] < p[l] ? r : l;
        if (p[m] >= lp) break;
        p[i] = p[m]; v[i] = v[m]; i = m;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  };

  const ALGOS = {
    astar: 'A*',
    dijkstra: 'Dijkstra',
    greedy: 'Greedy best-first',
    bfs: 'Breadth-first',
  };

  function plan(world, sx, sy, gx, gy, o) {
    o = o || {};
    const t0n = ER.now();
    const algo = o.algo || 'astar';
    const timeAware = !!o.timeAware && world.gatesActive && !o.ignoreGates;
    const P = timeAware ? ER.GATE_PERIOD : 1;
    const W = world.W, N = world.N, S = N * P, t0 = o.t0 || 0;
    const costFn = o.costFn || ((i) => world.cellCost(i));
    const gateOn = o.ignoreGates ? () => false : (x, y, t) => world.gateOn(x, y, t);
    const goal = gy * W + gx, startCell = sy * W + sx;

    const g = new Float64Array(S).fill(Infinity);
    const par = new Int32Array(S).fill(-1);
    const steps = new Int32Array(S);
    const closed = new Uint8Array(S);
    const order = [];
    const h = (c) => Math.abs((c % W) - gx) + Math.abs(((c / W) | 0) - gy);
    // Tie-break toward deeper nodes (larger g) for A*, which cuts expansions on plateaus.
    const pri = algo === 'astar' ? (gv, c) => gv + h(c) - gv * 1e-6
      : algo === 'greedy' ? (gv, c) => h(c) + gv * 1e-6
        : (gv) => gv;

    const s0 = startCell * P + (timeAware ? t0 % P : 0);
    g[s0] = 0;
    let expanded = 0, found = -1, generated = 1;
    const maxExp = o.maxExpand || 500000;
    const isBFS = algo === 'bfs';
    const queue = isBFS ? [s0] : null;
    let qh = 0;
    const heap = isBFS ? null : new Heap();
    if (!isBFS) heap.push(pri(0, startCell), s0);
    const moves = timeAware ? MOVES5 : MOVES4;

    while (isBFS ? qh < queue.length : heap.p.length) {
      const s = isBFS ? queue[qh++] : heap.pop();
      if (closed[s]) continue;
      closed[s] = 1;
      expanded++;
      const c = (s / P) | 0, ph = s % P;
      order.push(c);
      if (c === goal) { found = s; break; }
      if (expanded >= maxExp) break;
      const cx = c % W, cy = (c / W) | 0;
      const tArr = timeAware ? t0 + steps[s] + 1 : t0;
      for (let k = 0; k < moves.length; k++) {
        const nx = cx + moves[k][0], ny = cy + moves[k][1];
        if (!world.isFree(nx, ny)) continue;
        if (gateOn(nx, ny, tArr)) continue;
        const nc = ny * W + nx;
        const ns = nc * P + (timeAware ? (ph + 1) % P : 0);
        if (closed[ns]) continue;
        const sc = costFn(nc);
        if (!(sc < Infinity)) continue;
        const ng = g[s] + sc;
        if (isBFS || algo === 'greedy') {
          if (g[ns] !== Infinity) continue; // first discovery wins
          g[ns] = ng; par[ns] = s; steps[ns] = steps[s] + 1; generated++;
          if (isBFS) queue.push(ns); else heap.push(pri(ng, nc), ns);
          continue;
        }
        if (ng < g[ns]) {
          g[ns] = ng; par[ns] = s; steps[ns] = steps[s] + 1; generated++;
          heap.push(pri(ng, nc), ns);
        }
      }
    }

    const path = [], cum = [];
    if (found >= 0) {
      let s = found;
      while (s >= 0) { const c = (s / P) | 0; path.push({ x: c % W, y: (c / W) | 0 }); s = par[s]; }
      path.reverse();
      cum.push(0);
      for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + costFn(path[i].y * W + path[i].x));
    }
    return {
      found: found >= 0, path, cum, cost: found >= 0 ? cum[cum.length - 1] : Infinity,
      expanded, generated, order, ms: ER.now() - t0n, algo, timeAware,
    };
  }

  /* True movement cost of a path in the world (coolant counted, risk penalty not). */
  function pathTrueCost(world, path) {
    let c = 0;
    for (let i = 1; i < path.length; i++) c += world.cellCost(path[i].y * world.W + path[i].x);
    return c;
  }

  Object.assign(ER, { plan, pathTrueCost, Heap, ALGOS });
})(typeof globalThis !== 'undefined' ? globalThis : window);
