/* Correctness tests. Run with `npm test`. Each returns { pass, detail }. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  function coolantWorld(seed) {
    const w = ER.generateWorld(seed), rng = ER.RNG(seed);
    for (let k = 0; k < 40; k++) { const x = rng.int(1, w.W - 2), y = rng.int(1, w.H - 2); if (w.isFree(x, y)) w.hazard[w.idx(x, y)] = 1; }
    return w;
  }
  function eachQuery(fn) {
    for (let seed = 1; seed <= 30; seed++) {
      const w = coolantWorld(seed);
      for (const g of [w.exit, w.terminal, ...w.keys]) fn(w, g, seed);
    }
  }

  ER.TESTS = [
    {
      name: 'A* finds optimal paths (same cost as Dijkstra)',
      run() {
        let bad = null;
        eachQuery((w, g, seed) => {
          const a = ER.plan(w, 1, 1, g.x, g.y, { algo: 'astar' }), d = ER.plan(w, 1, 1, g.x, g.y, { algo: 'dijkstra' });
          if (a.cost !== d.cost) bad = `seed ${seed}: ${a.cost} vs ${d.cost}`;
          for (let i = 1; i < a.path.length; i++) {
            const p = a.path[i - 1], q = a.path[i];
            if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1 || !w.isFree(q.x, q.y)) bad = `invalid step on seed ${seed}`;
          }
        });
        return { pass: !bad, detail: bad || '150 of 150 queries optimal and valid' };
      },
    },
    {
      name: 'A* explores fewer states than Dijkstra',
      run() {
        let a = 0, d = 0, worse = 0;
        eachQuery((w, g) => {
          const ra = ER.plan(w, 1, 1, g.x, g.y, { algo: 'astar' }).expanded, rd = ER.plan(w, 1, 1, g.x, g.y, { algo: 'dijkstra' }).expanded;
          a += ra; d += rd; if (ra > rd) worse++;
        });
        return { pass: worse === 0, detail: `${a} vs ${d} states (${Math.round(100 - (100 * a) / d)}% fewer)` };
      },
    },
    {
      name: 'Every lock has exactly one solution and both solvers find it',
      run() {
        for (let k = 0; k < 40; k++) {
          const lock = ER.makeLock(ER.RNG(900 + k));
          if (ER.countSolutions(lock, 3) !== 1) return { pass: false, detail: `lock ${k} not unique` };
          for (const mode in ER.CSP_MODES) {
            const r = ER.solveCSP(lock, { mode });
            if (!r.solution || r.solution.join() !== lock.secret.join()) return { pass: false, detail: `${mode} wrong on lock ${k}` };
          }
        }
        return { pass: true, detail: '40 locks, 80 correct solves' };
      },
    },
    {
      name: 'MRV + forward checking needs fewer assignments than plain backtracking',
      run() {
        let s = 0, b = 0;
        for (let k = 0; k < 40; k++) {
          const lock = ER.makeLock(ER.RNG(900 + k));
          s += ER.solveCSP(lock, { mode: 'mrv_fc' }).stats.assignments; b += ER.solveCSP(lock, { mode: 'bt' }).stats.assignments;
        }
        return { pass: s < b, detail: `${s} vs ${b} assignments` };
      },
    },
    {
      name: 'A power surge gives a new lock that still has one solution',
      run() {
        for (let k = 0; k < 40; k++) {
          const rng = ER.RNG(900 + k), lock = ER.makeLock(rng);
          ER.mutateLock(lock, rng);
          const r = ER.solveCSP(lock, { mode: 'mrv_fc' });
          if (ER.countSolutions(lock, 3) !== 1 || r.solution.join() !== lock.secret.join()) return { pass: false, detail: `lock ${k}` };
        }
        return { pass: true, detail: '40 of 40 surges valid' };
      },
    },
    {
      name: 'Behaviour tree: Survive interrupts a running task, then the task resumes',
      run() {
        const BT = ER.BT, log = [];
        let danger = false;
        const tree = BT.selector('root', [
          BT.sequence('survive', [BT.condition('danger', () => danger), BT.action('evade', () => (log.push('evade'), BT.S.RUNNING))]),
          BT.action('work', () => (log.push('work'), BT.S.RUNNING)),
        ]);
        tree.run({ t: 0 }); danger = true; tree.run({ t: 1 }); danger = false; tree.run({ t: 2 });
        return { pass: log.join() === 'work,evade,work', detail: log.join(' → ') };
      },
    },
    {
      name: 'Runs are reproducible from the seed',
      run() {
        const a = JSON.stringify(ER.runEpisode({ seed: 7 })), b = JSON.stringify(ER.runEpisode({ seed: 7 }));
        return { pass: a === b, detail: 'seed 7 gives identical results twice' };
      },
    },
    {
      name: 'The agent escapes every static facility',
      run() {
        let ok = 0;
        for (let s = 1; s <= 20; s++) ok += ER.runEpisode({ seed: s, dynamic: false }).success;
        return { pass: ok === 20, detail: `${ok} of 20` };
      },
    },
    {
      name: 'With dynamic events, the adaptive agent clearly beats the fixed script',
      run() {
        let a = 0, f = 0;
        for (let s = 1; s <= 30; s++) { a += ER.runEpisode({ seed: s }).success; f += ER.runEpisode({ seed: s, adaptive: false }).success; }
        return { pass: a >= 27 && a > f + 10, detail: `adaptive ${a}/30, fixed script ${f}/30` };
      },
    },
  ];
})(typeof globalThis !== 'undefined' ? globalThis : window);
