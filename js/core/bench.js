/* Evaluation harness shared by the browser Benchmark tab and the Node CLI (tools/bench.js).
 * Three experiments:
 *   1. Full missions: agent configurations × seeds under a dynamics level
 *   2. Planner micro-benchmark: identical queries for A*, Dijkstra, Greedy, BFS (states explored, cost, optimality)
 *   3. CSP solver comparison on generated locks (assignments, backtracks, checks, time) */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const AGENT_CONFIGS = [
    { id: 'unit7', label: 'UNIT-7 full: A* + fuzzy + space-time + BT', algo: 'astar', fuzzy: true, timeAware: true, adaptive: true },
    { id: 'snapshot', label: 'A* + fuzzy, snapshot planning', algo: 'astar', fuzzy: true, timeAware: false, adaptive: true },
    { id: 'crisp', label: 'A* + crisp avoidance (no fuzzy)', algo: 'astar', fuzzy: false, timeAware: true, adaptive: true },
    { id: 'dijkstra', label: 'Dijkstra + fuzzy + space-time', algo: 'dijkstra', fuzzy: true, timeAware: true, adaptive: true },
    { id: 'greedy', label: 'Greedy best-first + fuzzy + space-time', algo: 'greedy', fuzzy: true, timeAware: true, adaptive: true },
    { id: 'bfs', label: 'BFS + fuzzy + space-time', algo: 'bfs', fuzzy: true, timeAware: true, adaptive: true },
    { id: 'script', label: 'Fixed script (plans once, never adapts)', algo: 'astar', fuzzy: false, timeAware: false, adaptive: false },
  ];

  const METRICS = ['success', 'ticks', 'moves', 'pathCost', 'expanded', 'planCalls', 'replans', 'planMs', 'hits', 'zaps', 'hazardSteps', 'integrity', 'cspAssign', 'hackTicks'];

  function meanStd(xs) {
    if (!xs.length) return { mean: NaN, std: NaN };
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1);
    return { mean: m, std: Math.sqrt(v) };
  }

  function summarize(rows) {
    const out = { n: rows.length };
    for (const k of METRICS) out[k] = meanStd(rows.map((r) => r[k]));
    // Completion-time metrics over successful runs only (failures would be capped at maxTicks).
    const ok = rows.filter((r) => r.success);
    out.ticksOk = meanStd(ok.map((r) => r.ticks));
    out.costOk = meanStd(ok.map((r) => r.pathCost));
    const reasons = {};
    for (const r of rows) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
    out.reasons = reasons;
    return out;
  }

  function* missionJobs(configs, seeds, dynamics) {
    for (const c of configs) for (const s of seeds) yield { cfg: Object.assign({}, c, { seed: s, dynamics }), config: c };
  }

  function plannerMicro(seeds) {
    const algos = ['astar', 'dijkstra', 'greedy', 'bfs'];
    const rows = [];
    for (const seed of seeds) {
      const w = ER.generateWorld(seed, {});
      w.gatesActive = false;
      // Sprinkle the coolant over a region so costs are non-uniform (BFS/Greedy can be suboptimal).
      const rng = ER.RNG(seed + 555);
      for (let k = 0; k < 40; k++) { const x = rng.int(1, w.W - 2), y = rng.int(1, w.H - 2); if (w.isFree(x, y) && !w.isObjectCell(w.idx(x, y))) w.hazard[w.idx(x, y)] = 1; }
      const targets = [w.exit].concat(w.keys, [w.terminal]);
      for (const tg of targets) {
        const ref = ER.plan(w, w.start.x, w.start.y, tg.x, tg.y, { algo: 'dijkstra' });
        for (const algo of algos) {
          const r = ER.plan(w, w.start.x, w.start.y, tg.x, tg.y, { algo });
          rows.push({ seed, algo, expanded: r.expanded, cost: r.cost, optimal: Math.abs(r.cost - ref.cost) < 1e-9 ? 1 : 0, gap: (r.cost - ref.cost) / ref.cost, ms: r.ms, len: r.path.length - 1 });
        }
        // Space-time A* with gates switched on, versus snapshot A*.
        w.gatesActive = true;
        for (const ta of [false, true]) {
          const r = ER.plan(w, w.start.x, w.start.y, tg.x, tg.y, { algo: 'astar', timeAware: ta, t0: 0 });
          rows.push({ seed, algo: ta ? 'astar_st' : 'astar_snap', expanded: r.expanded, cost: r.cost, optimal: NaN, gap: NaN, ms: r.ms, len: r.path.length - 1 });
        }
        w.gatesActive = false;
      }
    }
    const by = {};
    for (const r of rows) (by[r.algo] = by[r.algo] || []).push(r);
    const summary = {};
    for (const a in by) {
      summary[a] = {
        n: by[a].length,
        expanded: meanStd(by[a].map((r) => r.expanded)),
        cost: meanStd(by[a].map((r) => r.cost)),
        optimalRate: meanStd(by[a].map((r) => r.optimal)).mean,
        gap: meanStd(by[a].map((r) => r.gap)).mean,
        ms: meanStd(by[a].map((r) => r.ms)),
      };
    }
    return { rows, summary };
  }

  function cspBench(nLocks, seed0) {
    const modes = Object.keys(ER.CSP_MODES);
    const rows = [];
    for (let k = 0; k < nLocks; k++) {
      const lock = ER.makeLock(ER.RNG((seed0 || 1) * 1000 + k), 5);
      for (const mode of modes) {
        const r = ER.solveCSP(lock, { mode });
        const valid = r.solution && r.solution.join() === lock.secret.join() ? 1 : 0;
        rows.push({ lock: k, mode, clues: lock.constraints.length, assignments: r.stats.assignments, backtracks: r.stats.backtracks, checks: r.stats.checks, prunes: r.stats.prunes, ms: r.ms, valid });
      }
    }
    const summary = {};
    for (const m of modes) {
      const rs = rows.filter((r) => r.mode === m);
      summary[m] = {
        n: rs.length,
        assignments: meanStd(rs.map((r) => r.assignments)),
        backtracks: meanStd(rs.map((r) => r.backtracks)),
        checks: meanStd(rs.map((r) => r.checks)),
        ms: meanStd(rs.map((r) => r.ms)),
        valid: meanStd(rs.map((r) => r.valid)).mean,
        clues: meanStd(rs.map((r) => r.clues)).mean,
      };
    }
    return { rows, summary };
  }

  function toCSV(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v) => (typeof v === 'string' && /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    return cols.join(',') + '\n' + rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n') + '\n';
  }

  Object.assign(ER, { AGENT_CONFIGS, BENCH_METRICS: METRICS, meanStd, summarize, missionJobs, plannerMicro, cspBench, toCSV });
})(typeof globalThis !== 'undefined' ? globalThis : window);
