/* UNIT-7: the escape agent.
 *
 * Decision layer  : reactive Behaviour Tree (Survive > Escape > Crack lock > Collect keycards > Hold)
 * Navigation      : A* (or Dijkstra/Greedy/BFS) over a fuzzy-risk cost map, optionally in space-time
 * Plan monitoring : every tick the remaining plan is validated; it is repaired on
 *                   blockage (rubble), laser-gate conflicts, deviation, or when the fuzzy
 *                   threat along the route drifts above what was planned for
 * Puzzle layer    : CSP solver cracks the vault lock; a power surge invalidates the code
 *
 * With cfg.adaptive = false the agent becomes the baseline "fixed script": it compiles one
 * route at t = 0 from the blueprint and follows it blindly, with no replanning or evasion. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const RISK_WEIGHT_DEFAULT = 30; // tuned on seeds 1000-1059 (see REPORT.md)

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    arr.forEach((x, i) => {
      for (const p of permutations(arr.slice(0, i).concat(arr.slice(i + 1)))) out.push([x].concat(p));
    });
    return out;
  }

  function Agent(sim, cfg) {
    this.sim = sim;
    this.w = sim.world;
    this.cfg = cfg;
    this.x = this.w.start.x; this.y = this.w.start.y;
    this.px = this.x; this.py = this.y;
    this.integrity = 100;
    this.keys = 0;
    this.codeVersion = -1;
    this.code = null;
    this.plan = null;
    this.lastSearch = null;
    this.hack = null;
    this.lastHack = null;
    this.targetKey = null;
    this.targetAt = -999;
    this.failedAt = {};
    this.stun = 0;
    this.evading = false;
    this.risk = 0;
    this.mode = 'booting';
    this.stats = {
      moves: 0, waits: 0, pathCost: 0, expanded: 0, planCalls: 0, replans: 0, replansBy: {},
      planMs: 0, hits: 0, zaps: 0, hazardSteps: 0, evadeTicks: 0, stunTicks: 0, blockedWaits: 0,
      cspSolves: 0, cspAssign: 0, cspBacktracks: 0, cspChecks: 0, hackTicks: 0,
    };
    if (cfg.adaptive) this.tree = this.buildTree();
    else this.buildScript();
  }
  const P = Agent.prototype;
  const S = () => ER.BT.S;

  /* ---------- Behaviour Tree ---------- */
  P.buildTree = function () {
    const a = this, BT = ER.BT, w = this.w;
    return BT.selector('Root', [
      BT.sequence('Survive', [
        BT.condition('Threat high? (fuzzy)', () => a.threatHigh()),
        BT.action('Evade drone', () => a.evade()),
      ]),
      BT.sequence('Escape', [
        BT.condition('Vault unlocked?', () => a.exitUnlocked()),
        BT.action('Navigate → exit', () => a.navigate(w.exit.x, w.exit.y, 'exit')),
      ]),
      BT.sequence('Crack the lock', [
        BT.condition('All keycards held?', () => a.keys === w.keys.length),
        BT.action('Navigate → terminal', () => a.navigate(w.terminal.x, w.terminal.y, 'terminal')),
        BT.action('Solve lock (CSP)', () => a.solveLock()),
      ]),
      BT.sequence('Collect keycards', [
        BT.action('Optimise keycard tour', () => a.chooseKey()),
        BT.action('Navigate → keycard', () => (a.targetKey ? a.navigate(a.targetKey.x, a.targetKey.y, 'key:' + a.targetKey.name) : S().FAILURE)),
      ]),
      BT.action('Hold position', () => a.hold()),
    ]);
  };

  P.update = function () {
    this.px = this.x; this.py = this.y;
    if (this.stun > 0) { this.stun--; this.stats.stunTicks++; this.mode = 'stunned'; return; }
    if (this.cfg.adaptive) this.tree.run({ t: this.sim.t, agent: this });
    else this.scriptStep();
  };

  P.exitUnlocked = function () { return this.keys === this.w.keys.length && this.codeVersion === this.sim.lock.version; };

  P.threatHigh = function () {
    const sim = this.sim, d = sim.drone;
    if (!d) { this.risk = 0; return false; }
    const here = this.w.idx(this.x, this.y);
    this.risk = sim.riskAt(here);
    let yes;
    if (this.cfg.fuzzy) {
      const th = this.evading ? this.cfg.riskThreshold - 12 : this.cfg.riskThreshold;
      yes = this.risk >= th;
    } else {
      const dd = sim.droneDist[here];
      yes = d.state === 'CHASE' && dd >= 0 && dd <= 3; // crisp rule baseline
    }
    if (yes !== this.evading) {
      sim.say('BT', yes ? `Threat ${this.risk.toFixed(0)}/100 — switching to EVADE` : `Threat down to ${this.risk.toFixed(0)} — resuming mission`);
      this.evading = yes;
    }
    return yes;
  };

  /* ---------- Navigation ---------- */
  P.costFn = function () {
    const w = this.w, sim = this.sim;
    if (!sim.drone) return (i) => w.cellCost(i);
    if (this.cfg.fuzzy) {
      return (i) => {
        const r = sim.riskAt(i);
        return w.cellCost(i) + (r > 15 ? ((r - 15) / 85) * (this.cfg.riskWeight || RISK_WEIGHT_DEFAULT) : 0);
      };
    }
    return (i) => { const d = sim.droneDist[i]; return d >= 0 && d <= 1 ? Infinity : w.cellCost(i); };
  };

  P.replan = function (gx, gy, tag, why) {
    const sim = this.sim, cfg = this.cfg, st = this.stats;
    const r = ER.plan(this.w, this.x, this.y, gx, gy, {
      algo: cfg.algo, timeAware: cfg.timeAware, t0: sim.t, costFn: this.costFn(),
    });
    st.planCalls++; st.expanded += r.expanded; st.planMs += r.ms;
    if (why !== 'new goal') { st.replans++; st.replansBy[why] = (st.replansBy[why] || 0) + 1; }
    this.lastSearch = { order: r.order, t: sim.t, expanded: r.expanded, why, found: r.found };
    if (!r.found) {
      this.plan = null;
      this.failedAt[tag] = sim.t;
      sim.say('PLAN', `No route to ${tag} (${why}); ${r.expanded} states explored, holding`);
      return false;
    }
    this.plan = { tag, gx, gy, path: r.path, cum: r.cum, idx: 0, madeAt: sim.t, lastRiskCheck: sim.t };
    if (why !== 'new goal') sim.emit({ type: 'replan', x: this.x, y: this.y });
    sim.say('PLAN', `${why === 'new goal' ? 'Plan' : 'REPLAN [' + why + ']'} → ${tag}: ${r.path.length - 1} steps, cost ${r.cost.toFixed(1)}, ${r.expanded} states, ${r.ms.toFixed(2)} ms`);
    return true;
  };

  P.checkPlan = function (p) {
    const w = this.w, sim = this.sim, t = sim.t;
    const cur = p.path[p.idx];
    if (!cur || cur.x !== this.x || cur.y !== this.y) return 'deviated';
    const crisp = !this.cfg.fuzzy && sim.drone ? this.costFn() : null;
    for (let i = p.idx + 1; i < p.path.length; i++) {
      const c = p.path[i];
      if (!w.isFree(c.x, c.y)) return 'route blocked';
      if (this.cfg.timeAware) { if (w.gateOn(c.x, c.y, t + (i - p.idx))) return 'gate timing'; }
      else if (w.gateOn(c.x, c.y, t)) return 'laser gate';
      if (crisp && crisp(w.idx(c.x, c.y)) === Infinity) return 'drone on route';
    }
    if (this.cfg.fuzzy && sim.drone && t - p.lastRiskCheck >= 2) {
      p.lastRiskCheck = t;
      const cf = this.costFn();
      let now = 0;
      for (let i = p.idx + 1; i < p.path.length; i++) now += cf(w.idx(p.path[i].x, p.path[i].y));
      const planned = p.cum[p.cum.length - 1] - p.cum[p.idx];
      if (now > planned * 1.2 + 2) return 'threat drift';
    }
    return null;
  };

  P.navigate = function (gx, gy, tag) {
    if (this.x === gx && this.y === gy) { this.plan = null; return S().SUCCESS; }
    this.mode = 'navigate → ' + tag;
    const p = this.plan;
    if (!p || p.tag !== tag) {
      if (this.failedAt[tag] != null && this.sim.t - this.failedAt[tag] < 3) return S().FAILURE;
      if (!this.replan(gx, gy, tag, 'new goal')) return S().FAILURE;
    } else {
      const why = this.checkPlan(p);
      if (why && !this.replan(gx, gy, tag, why)) return S().FAILURE;
    }
    return this.followPlan(this.plan);
  };

  P.followPlan = function (p) {
    const w = this.w, t = this.sim.t;
    const nxt = p.path[p.idx + 1];
    if (!nxt) return S().SUCCESS;
    if (nxt.x === this.x && nxt.y === this.y) {
      p.idx++; this.stats.waits++; this.mode = 'waiting for laser gate';
      return S().RUNNING;
    }
    const gate = this.cfg.timeAware ? w.gateOn(nxt.x, nxt.y, t + 1) : w.gateOn(nxt.x, nxt.y, t);
    if (!w.isFree(nxt.x, nxt.y) || gate) { this.stats.waits++; this.stats.blockedWaits++; return S().RUNNING; }
    this.moveTo(nxt.x, nxt.y);
    p.idx++;
    return S().RUNNING;
  };

  P.moveTo = function (x, y) {
    const w = this.w, sim = this.sim, st = this.stats;
    this.x = x; this.y = y;
    st.moves++;
    const i = w.idx(x, y);
    st.pathCost += w.cellCost(i);
    if (w.hazard[i]) { this.integrity -= 3; st.hazardSteps++; }
    const k = w.keyAt(x, y);
    if (k) {
      k.taken = true;
      this.keys++;
      sim.say('KEY', `Picked up ${k.name} keycard (${this.keys}/${w.keys.length})`);
      sim.emit({ type: 'key', x, y, color: k.color });
      if (this.targetKey === k) this.targetKey = null;
    }
  };

  P.pathAhead = function (a, b) {
    if (this.cfg.adaptive) return this.plan ? this.plan.path.slice(this.plan.idx + a, this.plan.idx + b) : [];
    const sc = this.script, leg = sc && sc.legs[sc.leg];
    return leg ? leg.path.slice(sc.i + a, sc.i + b) : [];
  };

  /* ---------- Mission planning: keycard tour (exhaustive over orders) ---------- */
  P.bestTour = function (rem) {
    const w = this.w;
    const dA = w.bfs(w.idx(this.x, this.y));
    const dK = rem.map((k) => w.bfs(w.idx(k.x, k.y)));
    const term = w.terminal ? w.idx(w.terminal.x, w.terminal.y) : w.idx(w.exit.x, w.exit.y);
    let best = null, bestCost = Infinity;
    for (const perm of permutations([...rem.keys()])) {
      let c = dA[w.idx(rem[perm[0]].x, rem[perm[0]].y)];
      if (c < 0) continue;
      let ok = true;
      for (let j = 1; j < perm.length && ok; j++) {
        const d = dK[perm[j - 1]][w.idx(rem[perm[j]].x, rem[perm[j]].y)];
        if (d < 0) ok = false; else c += d;
      }
      const dl = dK[perm[perm.length - 1]][term];
      if (!ok || dl < 0) continue;
      c += dl;
      if (c < bestCost) { bestCost = c; best = perm; }
    }
    if (!best) {
      const reach = rem.filter((k) => dA[w.idx(k.x, k.y)] >= 0).sort((p, q) => dA[w.idx(p.x, p.y)] - dA[w.idx(q.x, q.y)]);
      return reach;
    }
    return best.map((i) => rem[i]);
  };

  P.chooseKey = function () {
    const w = this.w, sim = this.sim;
    const rem = w.keys.filter((k) => !k.taken);
    if (!rem.length) return S().FAILURE;
    if (this.targetKey && !this.targetKey.taken && sim.t - this.targetAt < 30) return S().SUCCESS;
    const order = this.bestTour(rem);
    this.mode = 'planning tour';
    if (!order.length) { this.targetKey = null; return S().FAILURE; }
    const prev = this.targetKey;
    this.targetKey = order[0];
    this.targetAt = sim.t;
    if (prev !== this.targetKey) sim.say('BT', `Tour optimiser (${order.length}! orders): ${order.map((k) => k.name).join(' → ')} → terminal`);
    return S().SUCCESS;
  };

  /* ---------- Puzzle: crack the vault lock with the CSP solver ---------- */
  P.solveLock = function () {
    const sim = this.sim, lock = sim.lock, st = this.stats;
    if (this.codeVersion === lock.version) return S().SUCCESS;
    this.mode = 'cracking lock';
    if (!this.hack || this.hack.version !== lock.version) {
      if (this.hack) sim.say('CSP', 'Constraints changed mid-solve! Discarding partial work and re-solving');
      const r = ER.solveCSP(lock, { mode: this.cfg.csp, trace: !!sim.cfg.verbose });
      st.cspSolves++; st.cspAssign += r.stats.assignments; st.cspBacktracks += r.stats.backtracks; st.cspChecks += r.stats.checks;
      // Hacking takes time proportional to search effort: smarter CSP heuristics = faster escape.
      const need = Math.max(2, Math.ceil(r.stats.assignments / 4));
      this.hack = { version: lock.version, result: r, progress: 0, need };
      this.lastHack = this.hack;
      sim.say('CSP', `${ER.CSP_MODES[this.cfg.csp]}: ${lock.constraints.length} clues, ${r.stats.assignments} assignments, ${r.stats.backtracks} backtracks, ${r.stats.prunes} prunes → ${need} ticks to dial in`);
      sim.emit({ type: 'hack' });
    }
    this.hack.progress++;
    st.hackTicks++;
    if (this.hack.progress >= this.hack.need) {
      const sol = this.hack.result.solution;
      this.codeVersion = lock.version;
      this.code = sol;
      this.hack = null;
      sim.say('CSP', `Vault code cracked: ${sol ? sol.join('-') : '??'}. Exit door unlocked`);
      sim.emit({ type: 'unlock' });
      return S().SUCCESS;
    }
    return S().RUNNING;
  };

  /* ---------- Survival: evade the drone using the fuzzy threat field ---------- */
  P.evade = function () {
    const w = this.w, sim = this.sim, t = sim.t, W = w.W;
    const start = w.idx(this.x, this.y);
    const dist = new Int16Array(w.N).fill(-1);
    const par = new Int32Array(w.N).fill(-1);
    const dCell = sim.drone ? w.idx(sim.drone.x, sim.drone.y) : -1;
    const q = [start];
    dist[start] = 0;
    let best = start, bestScore = sim.riskAt(start) + (w.hazard[start] ? 8 : 0);
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (dist[c] >= 5) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of ER.DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!w.passable(nx, ny, t + 1)) continue;
        const n = ny * W + nx;
        if (dist[n] >= 0 || n === dCell) continue;
        dist[n] = dist[c] + 1; par[n] = c; q.push(n);
        const sc = sim.riskAt(n) + 3 * dist[n] + (w.hazard[n] ? 8 : 0);
        if (sc < bestScore) { best = n; bestScore = sc; }
      }
    }
    this.stats.evadeTicks++;
    this.mode = 'evading drone';
    if (best === start) { this.stats.waits++; return S().RUNNING; }
    let c = best;
    while (par[c] !== start) c = par[c];
    this.moveTo(c % W, (c / W) | 0);
    return S().RUNNING;
  };

  P.hold = function () {
    this.mode = 'holding position (no route)';
    this.stats.waits++;
    return S().RUNNING;
  };

  /* ---------- Baseline: fixed script, no adaptation ---------- */
  P.buildScript = function () {
    const w = this.w, sim = this.sim;
    const order = this.bestTour(w.keys.filter((k) => !k.taken));
    const wps = order.map((k) => ({ x: k.x, y: k.y, kind: 'key' }));
    wps.push({ x: w.terminal.x, y: w.terminal.y, kind: 'terminal' });
    wps.push({ x: w.exit.x, y: w.exit.y, kind: 'exit' });
    let cur = { x: this.x, y: this.y };
    this.script = { legs: [], leg: 0, i: 0 };
    for (const wp of wps) {
      const r = ER.plan(w, cur.x, cur.y, wp.x, wp.y, { algo: this.cfg.algo, ignoreGates: true });
      this.stats.planCalls++; this.stats.expanded += r.expanded; this.stats.planMs += r.ms;
      this.script.legs.push({ path: r.found ? r.path : [cur], kind: wp.kind });
      cur = wp;
    }
    const total = this.script.legs.reduce((s, l) => s + l.path.length - 1, 0);
    sim.say('PLAN', `Fixed script compiled from blueprint: ${total} moves. It will not replan`);
  };

  P.scriptStep = function () {
    const sc = this.script, sim = this.sim, w = this.w;
    let leg = sc.legs[sc.leg];
    while (leg && sc.i >= leg.path.length - 1) {
      if (leg.kind === 'terminal' && this.codeVersion !== sim.lock.version) { this.solveLock(); return; }
      if (leg.kind === 'exit') { this.mode = 'at exit: door locked'; this.stats.waits++; return; }
      sc.leg++; sc.i = 0; leg = sc.legs[sc.leg];
    }
    if (!leg) return;
    const nxt = leg.path[sc.i + 1];
    if (!w.passable(nxt.x, nxt.y, sim.t)) {
      this.stats.waits++; this.stats.blockedWaits++;
      this.mode = 'blocked: script has no alternative';
      return;
    }
    this.moveTo(nxt.x, nxt.y);
    sc.i++;
    this.mode = 'following fixed script';
  };

  ER.Agent = Agent;
  ER.permutations = permutations;
})(typeof globalThis !== 'undefined' ? globalThis : window);
