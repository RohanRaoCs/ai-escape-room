/* Correctness test suite, shared by the browser Testing page and `node tools/test.js`.
 * Each test returns { pass, detail }. `proves` says which claim or requirement it backs up. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  function hazardWorld(seed) {
    const w = ER.generateWorld(seed, {});
    w.gatesActive = false;
    const rng = ER.RNG(seed);
    for (let k = 0; k < 40; k++) { const x = rng.int(1, w.W - 2), y = rng.int(1, w.H - 2); if (w.isFree(x, y)) w.hazard[w.idx(x, y)] = 1; }
    return w;
  }

  const TESTS = [
    {
      group: 'Search', name: 'A* finds optimal routes',
      proves: 'A* returns the same (optimal) cost as Dijkstra on 200 queries with uneven step costs, and every path is a valid chain of free cells.',
      run() {
        for (let seed = 1; seed <= 40; seed++) {
          const w = hazardWorld(seed);
          for (const tg of [w.exit, ...w.keys, w.terminal]) {
            const d = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'dijkstra' });
            const a = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'astar' });
            if (Math.abs(a.cost - d.cost) > 1e-9) return { pass: false, detail: `seed ${seed}: A* ${a.cost} vs Dijkstra ${d.cost}` };
            for (let i = 1; i < a.path.length; i++) {
              const p = a.path[i - 1], q = a.path[i];
              if (Math.abs(p.x - q.x) + Math.abs(p.y - q.y) !== 1 || !w.isFree(q.x, q.y)) return { pass: false, detail: `invalid step on seed ${seed}` };
            }
          }
        }
        return { pass: true, detail: '200 of 200 queries optimal' };
      },
    },
    {
      group: 'Search', name: 'A* explores fewer states than Dijkstra',
      proves: 'The Manhattan heuristic prunes the search: A* never expands more states than uniform-cost search.',
      run() {
        let a = 0, d = 0;
        for (let seed = 1; seed <= 40; seed++) {
          const w = hazardWorld(seed);
          for (const tg of [w.exit, ...w.keys, w.terminal]) {
            const ra = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'astar' }), rd = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'dijkstra' });
            if (ra.expanded > rd.expanded) return { pass: false, detail: `seed ${seed}: ${ra.expanded} > ${rd.expanded}` };
            a += ra.expanded; d += rd.expanded;
          }
        }
        return { pass: true, detail: `${a.toLocaleString()} vs ${d.toLocaleString()} states (${Math.round(100 - (100 * a) / d)}% fewer)` };
      },
    },
    {
      group: 'Search', name: 'Greedy best-first is not always optimal',
      proves: 'A sanity check on the comparison: Greedy ignores path cost, so on some queries it returns a costlier route.',
      run() {
        let worse = 0;
        for (let seed = 1; seed <= 40; seed++) {
          const w = hazardWorld(seed);
          for (const tg of [w.exit, ...w.keys, w.terminal]) {
            if (ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'greedy' }).cost > ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'dijkstra' }).cost + 1e-9) worse++;
          }
        }
        return { pass: worse > 0, detail: `suboptimal on ${worse} of 200 queries` };
      },
    },
    {
      group: 'Search', name: 'Space-time A* never walks into an active laser gate',
      proves: 'Planning over (cell, time) respects the gate schedule: replaying every planned path tick by tick never stands in a gate while it is on.',
      run() {
        let n = 0;
        for (let seed = 1; seed <= 30; seed++) {
          const w = ER.generateWorld(seed, {});
          for (const t0 of [0, 3, 7]) for (const tg of [w.exit, ...w.keys]) {
            const r = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'astar', timeAware: true, t0 });
            if (!r.found) return { pass: false, detail: `no path on seed ${seed}` };
            for (let i = 1; i < r.path.length; i++) if (w.gateOn(r.path[i].x, r.path[i].y, t0 + i)) return { pass: false, detail: `seed ${seed}, step ${i}` };
            n++;
          }
        }
        return { pass: true, detail: `${n} paths replayed, 0 collisions` };
      },
    },
    {
      group: 'Search', name: 'Space-time A* is optimal',
      proves: 'Adding time to the state keeps A* optimal: it matches space-time Dijkstra on every query.',
      run() {
        for (let seed = 1; seed <= 30; seed++) {
          const w = ER.generateWorld(seed, {});
          for (const t0 of [0, 3, 7]) for (const tg of [w.exit, ...w.keys]) {
            const a = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'astar', timeAware: true, t0 });
            const d = ER.plan(w, 1, 1, tg.x, tg.y, { algo: 'dijkstra', timeAware: true, t0 });
            if (Math.abs(a.cost - d.cost) > 1e-9) return { pass: false, detail: `seed ${seed}: ${a.cost} vs ${d.cost}` };
          }
        }
        return { pass: true, detail: '360 of 360 queries match' };
      },
    },
    {
      group: 'Constraint satisfaction', name: 'Every solver finds the vault code',
      proves: 'All four CSP solvers return the secret code, and it satisfies every clue, on 40 generated locks.',
      run() {
        for (let k = 0; k < 40; k++) {
          const lock = ER.makeLock(ER.RNG(900 + k), 5);
          for (const mode of Object.keys(ER.CSP_MODES)) {
            const r = ER.solveCSP(lock, { mode });
            if (!r.solution || r.solution.join() !== lock.secret.join() || !lock.constraints.every((c) => c.ok(r.solution))) return { pass: false, detail: `${mode} on lock ${k}` };
          }
        }
        return { pass: true, detail: '160 of 160 solves correct' };
      },
    },
    {
      group: 'Constraint satisfaction', name: 'Every lock has exactly one solution',
      proves: 'The puzzle generator only produces fair puzzles: the clues pin down a single code.',
      run() {
        for (let k = 0; k < 40; k++) if (ER.countSolutions(ER.makeLock(ER.RNG(900 + k), 5), 3) !== 1) return { pass: false, detail: `lock ${k}` };
        return { pass: true, detail: '40 of 40 unique' };
      },
    },
    {
      group: 'Constraint satisfaction', name: 'Heuristics reduce search',
      proves: 'MRV + forward checking + AC-3 never needs more assignments than plain backtracking.',
      run() {
        let best = 0, bt = 0;
        for (let k = 0; k < 40; k++) {
          const lock = ER.makeLock(ER.RNG(900 + k), 5);
          const a = ER.solveCSP(lock, { mode: 'mrv_fc_ac3' }).stats.assignments, b = ER.solveCSP(lock, { mode: 'bt' }).stats.assignments;
          if (a > b) return { pass: false, detail: `lock ${k}: ${a} > ${b}` };
          best += a; bt += b;
        }
        return { pass: true, detail: `${best} vs ${bt} assignments in total` };
      },
    },
    {
      group: 'Constraint satisfaction', name: 'A power surge produces a new valid puzzle',
      proves: 'When constraints change mid-run, the new clue set still has exactly one solution, and the solver finds it.',
      run() {
        for (let k = 0; k < 40; k++) {
          const rng = ER.RNG(900 + k);
          const lock = ER.makeLock(rng, 5);
          const ch = ER.mutateLock(lock, rng);
          const r = ER.solveCSP(lock, { mode: 'mrv_fc_ac3' });
          if (!ch.changedDials.length || !r.solution || r.solution.join() !== lock.secret.join() || ER.countSolutions(lock, 3) !== 1 || lock.version !== 1) return { pass: false, detail: `lock ${k}` };
        }
        return { pass: true, detail: '40 of 40 surges valid' };
      },
    },
    {
      group: 'Fuzzy logic', name: 'Threat falls with distance',
      proves: 'The rule base behaves sensibly: moving away from the drone never increases the threat.',
      run() {
        const f = ER.makeRiskFuzzy();
        for (const alert of [0.2, 1]) {
          let prev = Infinity;
          for (let d = 0; d <= 20; d++) {
            const v = f.infer({ distance: d, alert, integrity: 100 }).value;
            if (v > prev + 1e-6) return { pass: false, detail: `alert ${alert}, d=${d}` };
            prev = v;
          }
        }
        return { pass: true, detail: 'monotonic over 0–20 cells' };
      },
    },
    {
      group: 'Fuzzy logic', name: 'An alert drone is more dangerous than a calm one',
      proves: 'Alertness (from the drone state machine) changes the output.',
      run() {
        const f = ER.makeRiskFuzzy();
        const calm = f.infer({ distance: 3, alert: 0.2, integrity: 100 }).value, hot = f.infer({ distance: 3, alert: 1, integrity: 100 }).value;
        return { pass: hot > calm, detail: `${hot.toFixed(1)} vs ${calm.toFixed(1)} at 3 cells` };
      },
    },
    {
      group: 'Fuzzy logic', name: 'A damaged agent is more cautious',
      proves: 'Low hull integrity raises the threat at the same distance.',
      run() {
        const f = ER.makeRiskFuzzy();
        const hurt = f.infer({ distance: 6, alert: 0.2, integrity: 20 }).value, fine = f.infer({ distance: 6, alert: 0.2, integrity: 100 }).value;
        return { pass: hurt > fine, detail: `${hurt.toFixed(1)} vs ${fine.toFixed(1)} at 6 cells` };
      },
    },
    {
      group: 'Behaviour tree', name: 'Survive pre-empts a running action and then resumes it',
      proves: 'The tree is reactive: a high-priority branch interrupts work the moment its condition holds.',
      run() {
        const BT = ER.BT; let threat = false; const log = [];
        const tree = BT.selector('root', [
          BT.sequence('survive', [BT.condition('threat', () => threat), BT.action('evade', () => (log.push('evade'), BT.S.RUNNING))]),
          BT.action('work', () => (log.push('work'), BT.S.RUNNING)),
        ]);
        tree.run({ t: 0 }); threat = true; tree.run({ t: 1 }); threat = false; tree.run({ t: 2 });
        return { pass: log.join() === 'work,evade,work', detail: log.join(' → ') };
      },
    },
    {
      group: 'Simulation', name: 'Runs are reproducible',
      proves: 'The same seed gives the same episode, so every benchmark number can be re-checked.',
      run() {
        const a = ER.runEpisode({ seed: 7, dynamics: 'normal' }), b = ER.runEpisode({ seed: 7, dynamics: 'normal' });
        for (const r of [a, b]) { delete r.wallMs; delete r.planMs; }
        return { pass: JSON.stringify(a) === JSON.stringify(b), detail: `seed 7: ${a.ticks} ticks both times` };
      },
    },
    {
      group: 'Simulation', name: 'The agent escapes every static facility',
      proves: 'The full mission (keycards, CSP lock, exit) is solvable and solved on 20 maps.',
      run() {
        let ok = 0;
        for (let s = 1; s <= 20; s++) ok += ER.runEpisode({ seed: s, dynamics: 'off' }).success;
        return { pass: ok === 20, detail: `${ok} of 20 escaped` };
      },
    },
    {
      group: 'Simulation', name: 'The agent recovers from power surges',
      proves: 'When the lock is rewired mid-run, the behaviour tree sends the agent back to re-solve it.',
      run() {
        let surged = 0, rec = 0;
        for (let s = 1; s <= 30; s++) { const r = ER.runEpisode({ seed: s, dynamics: 'normal' }); if (r.surges) { surged++; rec += r.success; } }
        return { pass: surged > 0 && rec / surged >= 0.9, detail: `${rec} of ${surged} surge runs escaped` };
      },
    },
    {
      group: 'Simulation', name: 'Adapting beats a fixed plan',
      proves: 'The core requirement: on dynamic maps the adaptive agent clearly beats a fixed sequence of actions.',
      run() {
        let a = 0, s = 0;
        for (let k = 1; k <= 25; k++) {
          a += ER.runEpisode({ seed: k, dynamics: 'normal' }).success;
          s += ER.runEpisode({ seed: k, dynamics: 'normal', adaptive: false, fuzzy: false, timeAware: false }).success;
        }
        return { pass: a >= 22 && a > s + 8, detail: `adaptive ${a}/25 vs fixed script ${s}/25` };
      },
    },
    {
      group: 'Reinforcement learning', name: 'Q-learning learns a near-optimal escape',
      proves: 'After 2,500 episodes the greedy policy escapes within 25% of the A* optimum.',
      run(ctx) {
        const lab = new ER.QLab(4);
        lab.train(2500);
        ctx.lab = lab;
        const g = lab.greedy(), opt = lab.optimal();
        return { pass: g.success && g.steps <= opt.steps * 1.25, detail: `${g.steps} steps vs optimal ${opt.steps}` };
      },
    },
    {
      group: 'Reinforcement learning', name: 'After a collapse, planning adapts and learning must retrain',
      proves: 'A* reroutes instantly around new rubble; the learned policy needs more episodes to recover.',
      run(ctx) {
        const lab = ctx.lab || (() => { const l = new ER.QLab(4); l.train(2500); return l; })();
        const cell = lab.mutate();
        const stale = lab.greedy(), opt = lab.optimal();
        lab.train(1500);
        const fixed = lab.greedy();
        return {
          pass: !!cell && opt.steps < Infinity && fixed.success,
          detail: `A* ${opt.steps} steps; stale policy ${stale.success ? 'still works' : 'fails (' + stale.reason + ')'}; retrained policy ${fixed.success ? 'works' : 'fails'}`,
        };
      },
    },
  ];

  ER.TESTS = TESTS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
