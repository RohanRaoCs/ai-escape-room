/* Constraint Satisfaction: the vault lock.
 *
 * Variables : D1..D5 (lock dials), each with domain {0..9}
 * Constraints (the "clues" on the terminal): all dials differ, plus clues such as
 *   "D1 is odd", "D3 > 4", "D2 + D4 = 11", "D3 > D5", "|D1 - D2| = 3".
 * The generator adds true clues until exactly one code fits, then removes every clue it can
 * without losing uniqueness, so each puzzle is minimal.
 *
 * Two solvers are compared:
 *   bt      plain backtracking (assign dials in order, undo on conflict)
 *   mrv_fc  backtracking + MRV variable ordering + forward checking
 * A power surge (mutateLock) changes two dials and their clues while the agent is running. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const PRIMES = new Set([2, 3, 5, 7]);
  const D = (i) => 'D' + (i + 1);

  // Each constraint: { vars, text, ok(a) }. `a[i] = -1` means unassigned; ok() returns
  // false only when the assigned values already break the clue.
  const C = {
    allDiff(n) {
      return { vars: [...Array(n).keys()], text: 'All dials differ', ok(a) { const s = a.filter((v) => v >= 0); return new Set(s).size === s.length; } };
    },
    parity: (i, p) => ({ vars: [i], text: `${D(i)} is ${p ? 'odd' : 'even'}`, ok: (a) => a[i] < 0 || a[i] % 2 === p }),
    prime: (i, yes) => ({ vars: [i], text: `${D(i)} is ${yes ? '' : 'not '}prime`, ok: (a) => a[i] < 0 || PRIMES.has(a[i]) === yes }),
    gtC: (i, k) => ({ vars: [i], text: `${D(i)} > ${k}`, ok: (a) => a[i] < 0 || a[i] > k }),
    ltC: (i, k) => ({ vars: [i], text: `${D(i)} < ${k}`, ok: (a) => a[i] < 0 || a[i] < k }),
    sum2: (i, j, k) => ({ vars: [i, j], text: `${D(i)} + ${D(j)} = ${k}`, ok: (a) => a[i] < 0 || a[j] < 0 || a[i] + a[j] === k }),
    gt2: (i, j) => ({ vars: [i, j], text: `${D(i)} > ${D(j)}`, ok: (a) => a[i] < 0 || a[j] < 0 || a[i] > a[j] }),
    diff2: (i, j, k) => ({ vars: [i, j], text: `|${D(i)} − ${D(j)}| = ${k}`, ok: (a) => a[i] < 0 || a[j] < 0 || Math.abs(a[i] - a[j]) === k }),
    eq: (i, v) => ({ vars: [i], text: `${D(i)} = ${v}`, ok: (a) => a[i] < 0 || a[i] === v }),
  };

  /* A random clue that is true for the secret code s. */
  function randomClue(rng, s) {
    const i = rng.int(0, s.length - 1);
    let j = rng.int(0, s.length - 2); if (j >= i) j++;
    const lo = Math.min(i, j), hi = Math.max(i, j), r = rng.next();
    if (r < 0.1) return C.parity(i, s[i] % 2);
    if (r < 0.18) return C.prime(i, PRIMES.has(s[i]));
    if (r < 0.26) return s[i] > 0 ? C.gtC(i, rng.int(Math.max(0, s[i] - 4), s[i] - 1)) : null;
    if (r < 0.34) return s[i] < 9 ? C.ltC(i, rng.int(s[i] + 1, Math.min(9, s[i] + 4))) : null;
    if (r < 0.62) return C.sum2(lo, hi, s[i] + s[j]);
    if (r < 0.82) return s[i] > s[j] ? C.gt2(i, j) : C.gt2(j, i);
    return C.diff2(lo, hi, Math.abs(s[i] - s[j]));
  }

  function solveCSP(lock, o) {
    o = o || {};
    const t0 = ER.now();
    const smart = (o.mode || 'mrv_fc') === 'mrv_fc';
    const n = lock.n, byVar = [...Array(n)].map(() => []);
    for (const c of lock.constraints) for (const v of c.vars) byVar[v].push(c);
    const a = new Array(n).fill(-1);
    let domains = [...Array(n)].map(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const stats = { assignments: 0, backtracks: 0, checks: 0 };
    const trace = o.trace ? [] : null; // replayed by the UI to animate the dials
    const limit = o.limit || 1, sols = [];
    const consistent = (v) => byVar[v].every((c) => (stats.checks++, c.ok(a)));

    function selectVar() {
      let best = -1;
      for (let v = 0; v < n; v++) {
        if (a[v] >= 0) continue;
        if (!smart) return v; // plain backtracking: next dial in order
        if (best < 0 || domains[v].length < domains[best].length) best = v; // MRV
      }
      return best;
    }
    // Forward checking: remove values from unassigned dials that now break a clue.
    function forwardCheck() {
      for (let u = 0; u < n; u++) {
        if (a[u] >= 0) continue;
        domains[u] = domains[u].filter((x) => { a[u] = x; const ok = consistent(u); a[u] = -1; return ok; });
        if (!domains[u].length) return false;
      }
      return true;
    }
    function backtrack() {
      const v = selectVar();
      if (v < 0) { sols.push(a.slice()); return sols.length >= limit; }
      for (const val of domains[v]) {
        a[v] = val; stats.assignments++;
        if (trace) trace.push({ v, val });
        if (consistent(v)) {
          const saved = domains;
          if (smart) domains = domains.slice();
          if ((!smart || forwardCheck()) && backtrack()) return true;
          domains = saved;
        }
        a[v] = -1; stats.backtracks++;
        if (trace) trace.push({ v, val: -1 });
      }
      return false;
    }
    backtrack();
    return { solution: sols[0] || null, solutions: sols, stats, trace, ms: ER.now() - t0 };
  }

  const countSolutions = (lock, limit) => solveCSP(lock, { mode: 'mrv_fc', limit: limit || 2 }).solutions.length;

  function makeUnique(lock, rng) {
    const have = new Set(lock.constraints.map((c) => c.text));
    for (let guard = 0; countSolutions(lock, 2) !== 1 && guard < 80; guard++) {
      const c = randomClue(rng, lock.secret);
      if (c && !have.has(c.text)) { have.add(c.text); lock.constraints.push(c); }
    }
    for (let i = 0; countSolutions(lock, 2) !== 1; i++) lock.constraints.push(C.eq(i, lock.secret[i]));
    // Drop every clue (except "all differ") that is not needed for a unique answer.
    for (let k = lock.constraints.length - 1; k >= 1; k--) {
      const c = lock.constraints.splice(k, 1)[0];
      if (countSolutions(lock, 2) !== 1) lock.constraints.splice(k, 0, c);
    }
  }

  function makeLock(rng) {
    const secret = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 5);
    const lock = { n: 5, secret, version: 0, constraints: [C.allDiff(5)] };
    makeUnique(lock, rng);
    return lock;
  }

  /* Power surge: rewire two dials, drop clues that no longer hold, add new ones. */
  function mutateLock(lock, rng) {
    const s = lock.secret.slice();
    const pos = rng.shuffle([0, 1, 2, 3, 4]).slice(0, 2);
    const unused = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !s.includes(d)));
    pos.forEach((p, k) => { s[p] = unused[k]; });
    const before = new Set(lock.constraints.map((c) => c.text));
    lock.secret = s;
    lock.constraints = lock.constraints.filter((c) => c.ok(s));
    const removed = [...before].filter((t) => !lock.constraints.some((c) => c.text === t));
    makeUnique(lock, rng);
    const added = lock.constraints.map((c) => c.text).filter((t) => !before.has(t));
    lock.version++;
    return { changedDials: pos.map((p) => p + 1), removed, added };
  }

  const CSP_MODES = { bt: 'Plain backtracking', mrv_fc: 'MRV + forward checking' };
  Object.assign(ER, { solveCSP, makeLock, mutateLock, countSolutions, CSP_MODES });
})(typeof globalThis !== 'undefined' ? globalThis : window);
