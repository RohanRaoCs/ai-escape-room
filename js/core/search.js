/* Path planning: A*, Dijkstra and breadth-first search behind one function.
 *  - A*       : priority = g + h, with h = Manhattan distance (admissible: every step costs >= 1)
 *  - Dijkstra : priority = g  (uniform-cost search, no heuristic)
 *  - BFS      : FIFO queue, ignores step costs (fewest steps, not cheapest path)
 * Returns the path, its cost and the number of states expanded. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  /* Binary min-heap of (priority, value) pairs. */
  function Heap() { this.p = []; this.v = []; }
  Heap.prototype.push = function (pri, val) {
    const p = this.p, v = this.v;
    let i = p.length;
    p.push(pri); v.push(val);
    while (i > 0) { const j = (i - 1) >> 1; if (p[j] <= pri) break; p[i] = p[j]; v[i] = v[j]; i = j; }
    p[i] = pri; v[i] = val;
  };
  Heap.prototype.pop = function () {
    const p = this.p, v = this.v, top = v[0], lp = p.pop(), lv = v.pop(), n = p.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const m = l + 1 < n && p[l + 1] < p[l] ? l + 1 : l;
        if (p[m] >= lp) break;
        p[i] = p[m]; v[i] = v[m]; i = m;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  };

  const ALGOS = { astar: 'A*', dijkstra: 'Dijkstra', bfs: 'Breadth-first' };

  /* costFn(cell) gives the cost of stepping into a cell; Infinity means "do not enter". */
  function plan(world, sx, sy, gx, gy, o) {
    o = o || {};
    const t0 = ER.now();
    const algo = o.algo || 'astar';
    const W = world.W, N = world.N;
    const costFn = o.costFn || ((i) => world.cellCost(i));
    const start = sy * W + sx, goal = gy * W + gx;
    const g = new Float64Array(N).fill(Infinity), parent = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    const h = (c) => Math.abs((c % W) - gx) + Math.abs(((c / W) | 0) - gy);
    const order = [];
    let expanded = 0;

    g[start] = 0;
    const isBFS = algo === 'bfs';
    const queue = [start];
    let qh = 0;
    const heap = new Heap();
    if (!isBFS) heap.push(algo === 'astar' ? h(start) : 0, start);

    while (isBFS ? qh < queue.length : heap.p.length) {
      const c = isBFS ? queue[qh++] : heap.pop();
      if (closed[c]) continue;
      closed[c] = 1;
      expanded++;
      order.push(c);
      if (c === goal) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of ER.DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!world.isFree(nx, ny)) continue;
        const n = ny * W + nx;
        if (closed[n]) continue;
        const step = costFn(n);
        if (step === Infinity) continue;
        const ng = g[c] + step;
        if (isBFS) {
          if (g[n] !== Infinity) continue; // first discovery wins
          g[n] = ng; parent[n] = c; queue.push(n);
        } else if (ng < g[n]) {
          g[n] = ng; parent[n] = c;
          heap.push(algo === 'astar' ? ng + h(n) : ng, n);
        }
      }
    }

    const found = closed[goal] === 1;
    const path = [];
    if (found) for (let c = goal; c >= 0; c = parent[c]) path.unshift(world.xy(c));
    return { found, path, cost: found ? g[goal] : Infinity, expanded, order, ms: ER.now() - t0, algo };
  }

  Object.assign(ER, { plan, Heap, ALGOS });
})(typeof globalThis !== 'undefined' ? globalThis : window);
