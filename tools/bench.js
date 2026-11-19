// Evaluation. Run: npm run bench   (writes results/summary.md and results/missions.csv)
const fs = require('fs');
const path = require('path');
const ER = require('./load.js');

const N = +(process.argv[2] || 100);
const seeds = [...Array(N)].map((_, i) => 5000 + i);
const out = path.join(__dirname, '..', 'results');
fs.mkdirSync(out, { recursive: true });
const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');

let md = `# Evaluation results\n\n${N} generated facilities per row (seeds ${seeds[0]}-${seeds[N - 1]}). Ticks and path cost are averaged over successful runs.\n\n`;
const rows = [];
for (const dynamic of [false, true]) {
  md += `## ${dynamic ? 'Dynamic' : 'Static'} facility\n\n| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |\n|---|---|---|---|---|---|---|\n`;
  for (const a of ER.AGENTS) {
    const rs = seeds.map((s) => Object.assign({ agent: a.id, dynamic: dynamic ? 1 : 0 }, ER.runEpisode({ seed: s, dynamic, algo: a.algo, adaptive: a.adaptive })));
    rows.push(...rs);
    const S = ER.summarize(rs);
    md += `| ${a.label} | ${f(S.success * 100)}% | ${f(S.ticks)} | ${f(S.pathCost)} | ${f(S.expanded)} | ${f(S.replans, 1)} | ${f(S.hits, 2)} |\n`;
    console.log(dynamic ? 'dynamic' : 'static ', a.id.padEnd(9), f(S.success * 100) + '%', 'ticks', f(S.ticks), 'cost', f(S.pathCost), 'states', f(S.expanded));
  }
  md += '\n';
}

const P = ER.plannerCompare(seeds.slice(0, 40));
md += '## Planner comparison (same queries, uneven step costs)\n\n| Planner | Queries | States explored | Path cost | Optimal |\n|---|---|---|---|---|\n';
for (const [k, s] of Object.entries(P)) md += `| ${ER.ALGOS[k]} | ${s.queries} | ${f(s.expanded)} | ${f(s.cost, 1)} | ${f(s.optimal * 100)}% |\n`;

const C = ER.cspCompare(100);
md += '\n## Lock solver comparison (100 generated locks)\n\n| Solver | Assignments | Backtracks | Correct |\n|---|---|---|---|\n';
for (const [k, s] of Object.entries(C)) md += `| ${ER.CSP_MODES[k]} | ${f(s.assignments, 1)} | ${f(s.backtracks, 1)} | ${f(s.correct * 100)}% |\n`;

fs.writeFileSync(path.join(out, 'summary.md'), md);
fs.writeFileSync(path.join(out, 'missions.csv'), ER.toCSV(rows));
console.log('\n' + md);
