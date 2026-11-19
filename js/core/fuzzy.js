/* Mamdani fuzzy inference (min for AND, max aggregation, centroid defuzzification).
 *
 * The risk controller turns three uncertain readings into a crisp threat level 0-100:
 *   distance  - corridor (BFS) distance between a cell and the security drone
 *   alert     - how alert the drone is (from its FSM state)
 *   integrity - the agent's remaining hull integrity
 * The output drives two things: a per-cell cost penalty inside A*, and the Behaviour
 * Tree's "Threat high?" condition that switches the agent into evasion. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const trap = (a, b, c, d) => (x) => {
    if (x < a || x > d) return 0;
    if (x >= b && x <= c) return 1;
    if (x < b) return (x - a) / (b - a);
    return (d - x) / (d - c);
  };
  const tri = (a, b, c) => trap(a, b, b, c);

  function FuzzySystem(def) {
    this.inputs = def.inputs;
    this.output = def.output;
    this.rules = def.rules;
    this.samples = def.samples || 101;
  }
  FuzzySystem.prototype.fuzzify = function (vals) {
    const mu = {};
    for (const name in this.inputs) {
      const v = this.inputs[name];
      const x = Math.max(v.range[0], Math.min(v.range[1], vals[name]));
      mu[name] = {};
      for (const s in v.sets) mu[name][s] = v.sets[s](x);
    }
    return mu;
  };
  FuzzySystem.prototype.infer = function (vals) {
    const mu = this.fuzzify(vals);
    const fired = [], outStrength = {};
    for (const r of this.rules) {
      let st = 1;
      for (const [v, s] of r.if) st = Math.min(st, mu[v][s]);
      fired.push(st);
      if (st > 0) outStrength[r.then] = Math.max(outStrength[r.then] || 0, st);
    }
    const [lo, hi] = this.output.range;
    const n = this.samples, agg = new Float32Array(n);
    let num = 0, den = 0;
    for (let k = 0; k < n; k++) {
      const x = lo + ((hi - lo) * k) / (n - 1);
      let m = 0;
      for (const s in outStrength) m = Math.max(m, Math.min(outStrength[s], this.output.sets[s](x)));
      agg[k] = m; num += m * x; den += m;
    }
    return { value: den > 0 ? num / den : lo, mu, fired, agg, outStrength };
  };

  function makeRiskFuzzy() {
    return new FuzzySystem({
      inputs: {
        distance: {
          label: 'Drone distance (cells)', range: [0, 20],
          sets: { Near: trap(0, 0, 2, 5), Medium: tri(3, 7, 11), Far: trap(9, 13, 20, 20) },
        },
        alert: {
          label: 'Drone alertness', range: [0, 1],
          sets: { Calm: trap(0, 0, 0.25, 0.55), Alert: trap(0.45, 0.75, 1, 1) },
        },
        integrity: {
          label: 'Hull integrity (%)', range: [0, 100],
          sets: { Critical: trap(0, 0, 30, 55), Healthy: trap(40, 70, 100, 100) },
        },
      },
      output: {
        label: 'Threat level', range: [0, 100],
        sets: {
          VeryLow: trap(0, 0, 8, 22), Low: tri(12, 28, 44), Medium: tri(35, 50, 65),
          High: tri(58, 74, 90), VeryHigh: trap(82, 94, 100, 100),
        },
      },
      rules: [
        { if: [['distance', 'Near'], ['alert', 'Alert']], then: 'VeryHigh' },
        { if: [['distance', 'Near'], ['alert', 'Calm']], then: 'Medium' },
        { if: [['distance', 'Medium'], ['alert', 'Alert']], then: 'High' },
        { if: [['distance', 'Medium'], ['alert', 'Calm']], then: 'Low' },
        { if: [['distance', 'Far'], ['alert', 'Alert']], then: 'Low' },
        { if: [['distance', 'Far'], ['alert', 'Calm']], then: 'VeryLow' },
        { if: [['distance', 'Near'], ['integrity', 'Critical']], then: 'VeryHigh' },
        { if: [['distance', 'Medium'], ['integrity', 'Critical']], then: 'Medium' },
        { if: [['distance', 'Far'], ['integrity', 'Healthy']], then: 'VeryLow' },
      ],
    });
  }
  function ruleText(r) {
    const names = { distance: 'distance', alert: 'drone', integrity: 'integrity' };
    return 'IF ' + r.if.map(([v, s]) => `${names[v]} is ${s}`).join(' AND ') + ` THEN threat is ${r.then}`;
  }

  Object.assign(ER, { trap, tri, FuzzySystem, makeRiskFuzzy, ruleText });
})(typeof globalThis !== 'undefined' ? globalThis : window);
