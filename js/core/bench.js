/* Evaluation, shared by the web page ("Run evaluation") and `npm run bench`.
 * Measures from the brief: success rate, completion time (ticks), path cost, states explored. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const AGENTS = [
    { id: 'astar', label: 'A* + behaviour tree', algo: 'astar', adaptive: true },
    { id: 'dijkstra', label: 'Dijkstra + behaviour tree', algo: 'dijkstra', adaptive: true },
    { id: 'bfs', label: 'BFS + behaviour tree', algo: 'bfs', adaptive: true },
    { id: 'script', label: 'Fixed script (no replanning)', algo: 'astar', adaptive: false },
  ];

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

  /* Summarise mission results. Ticks and path cost are averaged over successful runs only. */
  function summarize(rows) {
    const ok = rows.filter((r) => r.success);
    return {
      n: rows.length,
      success: mean(rows.map((r) => r.success)),
      ticks: mean(ok.map((r) => r.ticks)),
      pathCost: mean(ok.map((r) => r.pathCost)),
      expanded: mean(rows.map((r) => r.expanded)),
      replans: mean(rows.map((r) => r.replans)),
      hits: mean(rows.map((r) => r.hits)),
    };
  }

  /* Planner comparison on identical start -> goal queries (no dynamics). */
  function plannerCompare(seeds) {
    const out = {};
    for (const algo of ['astar', 'dijkstra', 'bfs']) out[algo] = { expanded: [], cost: [], optimal: [] };
    for (const seed of seeds) {
      const w = ER.generateWorld(seed);
      const rng = ER.RNG(seed + 555); // scatter coolant so step costs are uneven
      for (let k = 0; k < 40; k++) { const x = rng.int(1, w.W - 2), y = rng.int(1, w.H - 2); if (w.isFree(x, y) && !w.isObjectCell(w.idx(x, y))) w.hazard[w.idx(x, y)] = 1; }
      for (const goal of [w.exit, w.terminal, ...w.keys]) {
        const best = ER.plan(w, w.start.x, w.start.y, goal.x, goal.y, { algo: 'dijkstra' }).cost;
        for (const algo in out) {
          const r = ER.plan(w, w.start.x, w.start.y, goal.x, goal.y, { algo });
          out[algo].expanded.push(r.expanded); out[algo].cost.push(r.cost); out[algo].optimal.push(r.cost === best ? 1 : 0);
        }
      }
    }
    const summary = {};
    for (const algo in out) summary[algo] = { queries: out[algo].cost.length, expanded: mean(out[algo].expanded), cost: mean(out[algo].cost), optimal: mean(out[algo].optimal) };
    return summary;
  }

  /* CSP comparison on the same generated locks. */
  function cspCompare(nLocks) {
    const out = {};
    for (const mode in ER.CSP_MODES) out[mode] = { assignments: [], backtracks: [], correct: [] };
    for (let k = 0; k < nLocks; k++) {
      const lock = ER.makeLock(ER.RNG(7000 + k));
      for (const mode in out) {
        const r = ER.solveCSP(lock, { mode });
        out[mode].assignments.push(r.stats.assignments); out[mode].backtracks.push(r.stats.backtracks);
        out[mode].correct.push(r.solution && r.solution.join() === lock.secret.join() ? 1 : 0);
      }
    }
    const summary = {};
    for (const mode in out) summary[mode] = { locks: nLocks, assignments: mean(out[mode].assignments), backtracks: mean(out[mode].backtracks), correct: mean(out[mode].correct) };
    return summary;
  }

  function toCSV(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    return cols.join(',') + '\n' + rows.map((r) => cols.map((c) => r[c]).join(',')).join('\n') + '\n';
  }

  Object.assign(ER, { AGENTS, summarize, plannerCompare, cspCompare, toCSV, mean });
})(typeof globalThis !== 'undefined' ? globalThis : window);
