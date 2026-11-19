// Headless evaluation. Run: node tools/bench.js [seeds=50]
// Writes results/*.csv and results/summary.md (the numbers quoted in REPORT.md).
const fs = require('fs');
const path = require('path');
const ER = require('./load.js');

const NSEEDS = +(process.argv[2] || 50);
const seeds = [...Array(NSEEDS)].map((_, i) => 5000 + i); // held-out: parameters were tuned on 1000-1059
const out = path.join(__dirname, '..', 'results');
fs.mkdirSync(out, { recursive: true });

const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : '–');
const pm = (s, d = 1) => `${f(s.mean, d)} ± ${f(s.std, d)}`;
let md = `# Benchmark results\n\nGenerated ${new Date().toISOString()} · ${NSEEDS} seeded facilities (seeds ${seeds[0]}–${seeds[seeds.length - 1]}) · 31×21 grid · max 900 ticks\n\n`;

const allRows = [];
for (const dyn of ['off', 'normal', 'chaos']) {
  md += `## Mission experiment: ${ER.DYNAMICS[dyn].label} facility\n\n`;
  md += '| Configuration | Success | Ticks (successes) | Path cost (successes) | States explored | Replans | Drone hits | Laser zaps | Final integrity | Plan time ms |\n|---|---|---|---|---|---|---|---|---|---|\n';
  for (const c of ER.AGENT_CONFIGS) {
    const rows = seeds.map((s) => Object.assign({ config: c.id, dynamics: dyn }, ER.runEpisode(Object.assign({}, c, { seed: s, dynamics: dyn }))));
    allRows.push(...rows);
    const S = ER.summarize(rows);
    md += `| ${c.label} | **${f(S.success.mean * 100, 0)}%** | ${pm(S.ticksOk, 0)} | ${pm(S.costOk, 0)} | ${pm(S.expanded, 0)} | ${pm(S.replans)} | ${f(S.hits.mean, 2)} | ${f(S.zaps.mean, 2)} | ${f(S.integrity.mean, 0)} | ${f(S.planMs.mean, 1)} |\n`;
    console.log(dyn.padEnd(7), c.id.padEnd(9), 'success', f(S.success.mean * 100, 0) + '%', 'ticks', f(S.ticksOk.mean, 0), 'expanded', f(S.expanded.mean, 0), 'replans', f(S.replans.mean, 1), JSON.stringify(S.reasons));
  }
  md += '\n';
}
fs.writeFileSync(path.join(out, 'missions.csv'), ER.toCSV(allRows));

// Replan causes for the full agent under normal dynamics
{
  const rows = allRows.filter((r) => r.config === 'unit7' && r.dynamics === 'normal');
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
  md += `### Why UNIT-7 replanned (Dynamic facility, mean per episode)\n\n| Route blocked by collapse | Laser gate conflict | Threat drift / drone | Deviated (after evasion or zap) |\n|---|---|---|---|\n| ${f(sum('replansBlocked'), 2)} | ${f(sum('replansGate'), 2)} | ${f(sum('replansThreat'), 2)} | ${f(sum('replansDeviated'), 2)} |\n\n`;
}

// Planner micro-benchmark
{
  const res = ER.plannerMicro(seeds.slice(0, Math.min(NSEEDS, 40)));
  fs.writeFileSync(path.join(out, 'planners.csv'), ER.toCSV(res.rows));
  const names = { astar: 'A*', dijkstra: 'Dijkstra', greedy: 'Greedy best-first', bfs: 'BFS', astar_snap: 'A* snapshot (gates frozen at t=0)', astar_st: 'A* space-time (gate schedule)' };
  md += `## Planner micro-benchmark\n\nSame start→goal queries (exit, keycards, terminal) on ${Math.min(NSEEDS, 40)} maps with 40 coolant cells (step cost 6). Optimal = cost equals Dijkstra's.\n\n| Planner | Queries | States explored | Path cost | Optimal | Mean cost gap | Time ms |\n|---|---|---|---|---|---|---|\n`;
  for (const a of ['astar', 'dijkstra', 'greedy', 'bfs', 'astar_snap', 'astar_st']) {
    const s = res.summary[a];
    md += `| ${names[a]} | ${s.n} | ${pm(s.expanded, 0)} | ${pm(s.cost, 1)} | ${Number.isFinite(s.optimalRate) ? f(s.optimalRate * 100, 0) + '%' : 'n/a'} | ${Number.isFinite(s.gap) ? f(s.gap * 100, 1) + '%' : 'n/a'} | ${f(s.ms.mean, 3)} |\n`;
    console.log('planner', a.padEnd(10), 'expanded', f(s.expanded.mean, 0), 'cost', f(s.cost.mean, 1), 'optimal', f(s.optimalRate * 100, 0));
  }
  md += '\n';
}

// CSP comparison
{
  const res = ER.cspBench(100, 7);
  fs.writeFileSync(path.join(out, 'csp.csv'), ER.toCSV(res.rows));
  md += `## CSP solver comparison\n\n100 generated vault locks (5 dials, minimal clue sets, mean ${f(res.summary.bt.clues, 1)} clues).\n\n| Solver | Assignments | Backtracks | Constraint checks | Time ms | Correct |\n|---|---|---|---|---|---|\n`;
  for (const m in ER.CSP_MODES) {
    const s = res.summary[m];
    md += `| ${ER.CSP_MODES[m]} | ${pm(s.assignments, 1)} | ${pm(s.backtracks, 1)} | ${pm(s.checks, 0)} | ${f(s.ms.mean, 3)} | ${f(s.valid * 100, 0)}% |\n`;
    console.log('csp', m.padEnd(11), 'assign', f(s.assignments.mean, 1), 'bt', f(s.backtracks.mean, 1), 'checks', f(s.checks.mean, 0));
  }
  md += '\n';
}

// Q-learning vs planning
{
  md += `## Learning vs planning (Q-learning lab)\n\n17×11 facility, 2 keycards. Policy trained for 2500 episodes, then a collapse is dropped on the learned route.\n\n| Seed | Episodes to first greedy success | Learned steps | A* optimal steps | Policy after collapse | A* after collapse | Episodes to recover |\n|---|---|---|---|---|---|---|\n`;
  const qrows = [];
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const lab = new ER.QLab(seed);
    let first = null;
    for (let e = 0; e < 2500; e += 50) { lab.train(50); if (first == null && lab.greedy().success) first = lab.episodes; }
    const g = lab.greedy(), opt = lab.optimal();
    const cell = lab.mutate();
    const g2 = lab.greedy(), opt2 = lab.optimal();
    let rec = null;
    if (!g2.success) for (let e = 0; e < 3000; e += 50) { lab.train(50); if (lab.greedy().success) { rec = e + 50; break; } }
    qrows.push({ seed, firstSuccess: first, learnedSteps: g.success ? g.steps : NaN, optimal: opt.steps, afterCollapse: g2.success ? 'ok' : g2.reason, astarAfter: opt2.steps, recoverEpisodes: g2.success ? 0 : rec });
    md += `| ${seed} | ${first ?? '>2500'} | ${g.success ? g.steps : 'fail'} | ${opt.steps} | ${cell ? (g2.success ? 'still works' : 'fails (' + g2.reason + ')') : 'n/a'} | ${opt2.steps} (replanned instantly) | ${g2.success ? '0' : rec ?? '>3000'} |\n`;
  }
  fs.writeFileSync(path.join(out, 'qlearning.csv'), ER.toCSV(qrows));
  md += '\n';
}

fs.writeFileSync(path.join(out, 'summary.md'), md);
console.log('\nWrote results/summary.md, missions.csv, planners.csv, csp.csv, qlearning.csv');
