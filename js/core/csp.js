/* Constraint Satisfaction: the vault lock.
 *
 * Variables D1..Dn (lock dials), domains {0..9}. Constraints are clues printed on the
 * terminal: AllDifferent, a checksum, unary facts (parity, primality, bounds) and binary
 * relations (sums, orderings, differences). The generator keeps adding clues until the
 * code is unique, then deletes every clue that is not needed, so the puzzle is minimal.
 *
 * Solvers (selectable, so they can be compared):
 *   bt          - chronological backtracking
 *   fc          - backtracking + forward checking
 *   mrv_fc      - + minimum-remaining-values / degree variable ordering
 *   mrv_fc_ac3  - + node consistency and AC-3 arc consistency before search
 * A "power surge" (mutateLock) rewires the lock mid-run: two dials change, broken clues
 * are removed and new ones added, so any code the agent already derived becomes invalid. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const PRIMES = new Set([2, 3, 5, 7]);
  const D = (i) => 'D' + (i + 1);

  const C = {
    allDiff(n) {
      return {
        kind: 'alldiff', vars: [...Array(n).keys()], text: 'All dials differ',
        ok(a) { let seen = 0; for (const v of a) if (v >= 0) { if (seen & (1 << v)) return false; seen |= 1 << v; } return true; },
      };
    },
    sumAll(n, k) {
      return {
        kind: 'sum', vars: [...Array(n).keys()], text: `Checksum D1+…+D${n} = ${k}`,
        ok(a) { let s = 0, u = 0; for (const v of a) { if (v >= 0) s += v; else u++; } return u === 0 ? s === k : s <= k && s + 9 * u >= k; },
      };
    },
    parity(i, p) { return { kind: 'unary', vars: [i], text: `${D(i)} is ${p ? 'odd' : 'even'}`, ok: (a) => a[i] < 0 || a[i] % 2 === p }; },
    prime(i, yes) { return { kind: 'unary', vars: [i], text: `${D(i)} is ${yes ? '' : 'not '}prime`, ok: (a) => a[i] < 0 || PRIMES.has(a[i]) === yes }; },
    gtC(i, k) { return { kind: 'unary', vars: [i], text: `${D(i)} > ${k}`, ok: (a) => a[i] < 0 || a[i] > k }; },
    ltC(i, k) { return { kind: 'unary', vars: [i], text: `${D(i)} < ${k}`, ok: (a) => a[i] < 0 || a[i] < k }; },
    sum2(i, j, k) { return { kind: 'binary', vars: [i, j], text: `${D(i)} + ${D(j)} = ${k}`, ok: (a) => a[i] < 0 || a[j] < 0 || a[i] + a[j] === k }; },
    gt2(i, j) { return { kind: 'binary', vars: [i, j], text: `${D(i)} > ${D(j)}`, ok: (a) => a[i] < 0 || a[j] < 0 || a[i] > a[j] }; },
    diff2(i, j, k) { return { kind: 'binary', vars: [i, j], text: `|${D(i)} − ${D(j)}| = ${k}`, ok: (a) => a[i] < 0 || a[j] < 0 || Math.abs(a[i] - a[j]) === k }; },
    eq(i, v) { return { kind: 'unary', vars: [i], text: `${D(i)} = ${v}`, ok: (a) => a[i] < 0 || a[i] === v }; },
  };

  function randomConstraint(rng, s) {
    const n = s.length;
    const i = rng.int(0, n - 1);
    let j = rng.int(0, n - 2); if (j >= i) j++;
    const r = rng.next();
    if (r < 0.1) return C.parity(i, s[i] % 2);
    if (r < 0.18) return C.prime(i, PRIMES.has(s[i]));
    if (r < 0.26) return s[i] > 0 ? C.gtC(i, rng.int(Math.max(0, s[i] - 4), s[i] - 1)) : null;
    if (r < 0.34) return s[i] < 9 ? C.ltC(i, rng.int(s[i] + 1, Math.min(9, s[i] + 4))) : null;
    if (r < 0.62) return C.sum2(Math.min(i, j), Math.max(i, j), s[i] + s[j]);
    if (r < 0.82) return s[i] > s[j] ? C.gt2(i, j) : C.gt2(j, i);
    return C.diff2(Math.min(i, j), Math.max(i, j), Math.abs(s[i] - s[j]));
  }

  function solveCSP(lock, o) {
    o = o || {};
    const t0 = ER.now();
    const mode = o.mode || 'mrv_fc_ac3';
    const useMRV = mode.includes('mrv'), useFC = mode.includes('fc'), useAC3 = mode.includes('ac3');
    const n = lock.n, cons = lock.constraints;
    const byVar = [...Array(n)].map(() => []);
    for (const c of cons) for (const v of c.vars) byVar[v].push(c);
    const nbrs = [...Array(n)].map((_, v) => {
      const s = new Set();
      for (const c of byVar[v]) for (const u of c.vars) if (u !== v) s.add(u);
      return [...s];
    });
    const a = new Array(n).fill(-1);
    let domains = [...Array(n)].map(() => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const stats = { assignments: 0, backtracks: 0, checks: 0, prunes: 0 };
    const trace = o.trace ? [] : null;
    const TRACE_MAX = 4000;
    const push = (e) => { if (trace && trace.length < TRACE_MAX) trace.push(e); };
    const limit = o.limit || 1;
    const sols = [];

    // Node consistency on unary clues (part of the FC / AC-3 configurations).
    if (useFC || useAC3) {
      for (let v = 0; v < n; v++) {
        const unary = byVar[v].filter((c) => c.vars.length === 1);
        if (!unary.length) continue;
        const nd = domains[v].filter((x) => { a[v] = x; const ok = unary.every((c) => (stats.checks++, c.ok(a))); a[v] = -1; return ok; });
        stats.prunes += domains[v].length - nd.length;
        domains[v] = nd;
      }
    }
    let consistentStart = domains.every((d) => d.length > 0);
    if (consistentStart && useAC3) consistentStart = ac3();

    function ac3() {
      const arcs = [];
      const pairTest = (c, i, j) => (x, y) => { const b = new Array(n).fill(-1); b[i] = x; b[j] = y; return c.ok(b); };
      for (const c of cons) {
        if (c.vars.length === 2) {
          const [i, j] = c.vars;
          arcs.push([i, j, pairTest(c, i, j)], [j, i, pairTest(c, j, i)]);
        } else if (c.kind === 'alldiff') {
          for (const i of c.vars) for (const j of c.vars) if (i !== j) arcs.push([i, j, (x, y) => x !== y]);
        }
      }
      const queue = arcs.slice();
      while (queue.length) {
        const [i, j, test] = queue.shift();
        const nd = domains[i].filter((x) => domains[j].some((y) => (stats.checks++, test(x, y))));
        if (nd.length < domains[i].length) {
          stats.prunes += domains[i].length - nd.length;
          domains[i] = nd;
          push({ t: 'p', v: i, n: nd.length });
          if (!nd.length) return false;
          for (const arc of arcs) if (arc[1] === i && arc[0] !== j) queue.push(arc);
        }
      }
      return true;
    }

    function selectVar() {
      let best = -1, bestSize = Infinity, bestDeg = -1;
      for (let v = 0; v < n; v++) {
        if (a[v] >= 0) continue;
        if (!useMRV) return v;
        const size = domains[v].length;
        const deg = nbrs[v].reduce((s, u) => s + (a[u] < 0 ? 1 : 0), 0);
        if (size < bestSize || (size === bestSize && deg > bestDeg)) { best = v; bestSize = size; bestDeg = deg; }
      }
      return best;
    }
    function consistent(v) {
      for (const c of byVar[v]) { stats.checks++; if (!c.ok(a)) return false; }
      return true;
    }
    function bt(depth) {
      const v = selectVar();
      if (v < 0) { sols.push(a.slice()); push({ t: 's' }); return sols.length >= limit; }
      for (const val of domains[v]) {
        a[v] = val; stats.assignments++; push({ t: 'a', v, val });
        if (consistent(v)) {
          let saved = null, ok = true;
          if (useFC) {
            saved = domains.slice();
            for (const u of nbrs[v]) {
              if (a[u] >= 0) continue;
              const nd = domains[u].filter((x) => {
                a[u] = x;
                let good = true;
                for (const c of byVar[u]) { stats.checks++; if (!c.ok(a)) { good = false; break; } }
                a[u] = -1;
                return good;
              });
              if (nd.length < domains[u].length) { stats.prunes += domains[u].length - nd.length; domains[u] = nd; push({ t: 'p', v: u, n: nd.length }); }
              if (!nd.length) { ok = false; break; }
            }
          }
          if (ok && bt(depth + 1)) return true;
          if (saved) domains = saved;
        }
        a[v] = -1; stats.backtracks++; push({ t: 'u', v });
      }
      return false;
    }
    if (consistentStart) bt(0);
    return { solution: sols[0] || null, solutions: sols, stats, trace, ms: ER.now() - t0, mode };
  }

  const countSolutions = (lock, limit) => solveCSP(lock, { mode: 'mrv_fc', limit: limit || 2 }).solutions.length;

  function makeUnique(lock, rng) {
    const have = new Set(lock.constraints.map((c) => c.text));
    let guard = 0;
    while (countSolutions(lock, 2) !== 1 && guard++ < 80) {
      const c = randomConstraint(rng, lock.secret);
      if (!c || have.has(c.text)) continue;
      have.add(c.text);
      lock.constraints.push(c);
    }
    let i = 0;
    while (countSolutions(lock, 2) !== 1) { lock.constraints.push(C.eq(i, lock.secret[i])); i++; }
    // Minimise: drop every clue (except AllDifferent) whose removal keeps the code unique.
    for (let k = lock.constraints.length - 1; k >= 1; k--) {
      const c = lock.constraints.splice(k, 1)[0];
      if (countSolutions(lock, 2) !== 1) lock.constraints.splice(k, 0, c);
    }
  }

  function makeLock(rng, n) {
    n = n || 5;
    const secret = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, n);
    const lock = { n, secret, version: 0, constraints: [C.allDiff(n)] };
    if (rng.chance(0.6)) lock.constraints.push(C.sumAll(n, secret.reduce((s, x) => s + x, 0)));
    makeUnique(lock, rng);
    return lock;
  }

  /* Power surge: rewire two dials, drop clues that no longer hold, add new ones. */
  function mutateLock(lock, rng) {
    const s = lock.secret.slice();
    const pos = rng.shuffle([...Array(lock.n).keys()]).slice(0, 2);
    const free = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => !s.includes(d)));
    pos.forEach((p, k) => { s[p] = free[k]; });
    const before = new Set(lock.constraints.map((c) => c.text));
    lock.secret = s;
    lock.constraints = lock.constraints.filter((c) => c.kind === 'alldiff' || c.ok(s));
    const removed = [...before].filter((t) => !lock.constraints.some((c) => c.text === t));
    makeUnique(lock, rng);
    const added = lock.constraints.map((c) => c.text).filter((t) => !before.has(t));
    lock.version++;
    return { changedDials: pos.map((p) => p + 1), removed, added };
  }

  const CSP_MODES = {
    bt: 'Plain backtracking',
    fc: 'Backtracking + forward checking',
    mrv_fc: 'MRV + forward checking',
    mrv_fc_ac3: 'MRV + FC + AC-3',
  };

  Object.assign(ER, { solveCSP, makeLock, mutateLock, countSolutions, CSP_MODES, CSPConstraints: C });
})(typeof globalThis !== 'undefined' ? globalThis : window);
