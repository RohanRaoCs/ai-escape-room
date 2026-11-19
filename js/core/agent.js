/* UNIT-7, the escape agent.
 *
 *  Decisions  : a behaviour tree, re-evaluated from the root every tick:
 *                 Survive > Escape > Crack the lock > Collect keycards > Hold position
 *  Navigation : A* (or Dijkstra / BFS). The drone and the cells next to it are treated as
 *               blocked. Each tick the remaining route is re-checked, and a new plan is made
 *               when rubble blocks it, the drone moves onto it, or the agent was pushed off it.
 *  Puzzle     : the CSP solver cracks the vault lock; a power surge invalidates the code.
 *
 * With cfg.adaptive = false the agent is the "fixed script" baseline: it plans the whole
 * mission once at the start and follows it blindly (no replanning, no evasion). */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const S = () => ER.BT.S;

  function permutations(arr) {
    if (arr.length <= 1) return [arr.slice()];
    return arr.flatMap((x, i) => permutations(arr.slice(0, i).concat(arr.slice(i + 1))).map((p) => [x].concat(p)));
  }

  function Agent(sim, cfg) {
    this.sim = sim; this.w = sim.world; this.cfg = cfg;
    this.x = this.w.start.x; this.y = this.w.start.y;
    this.px = this.x; this.py = this.y;
    this.integrity = 100;
    this.keys = 0;
    this.codeVersion = -1; // lock version the agent has cracked
    this.code = null;
    this.plan = null; this.lastSearch = null;
    this.hack = null; this.lastHack = null;
    this.targetKey = null;
    this.stun = 0; this.evading = false; this.failedAt = {};
    this.mode = 'starting';
    this.stats = { moves: 0, waits: 0, pathCost: 0, expanded: 0, planCalls: 0, replans: 0, hits: 0, evadeTicks: 0, cspAssign: 0, hackTicks: 0 };
    if (cfg.adaptive) this.tree = this.buildTree(); else this.buildScript();
  }
  const P = Agent.prototype;

  /* ---------- Behaviour tree ---------- */
  P.buildTree = function () {
    const a = this, BT = ER.BT, w = this.w;
    return BT.selector('Root', [
      BT.sequence('Survive', [
        BT.condition('Drone chasing nearby?', () => a.threatened()),
        BT.action('Evade drone', () => a.evade()),
      ]),
      BT.sequence('Escape', [
        BT.condition('Vault unlocked?', () => a.exitUnlocked()),
        BT.action('Go to exit', () => a.navigate(w.exit.x, w.exit.y, 'exit')),
      ]),
      BT.sequence('Crack the lock', [
        BT.condition('All keycards held?', () => a.keys === w.keys.length),
        BT.action('Go to terminal', () => a.navigate(w.terminal.x, w.terminal.y, 'terminal')),
        BT.action('Solve lock (CSP)', () => a.solveLock()),
      ]),
      BT.sequence('Collect keycards', [
        BT.action('Choose next keycard', () => a.chooseKey()),
        BT.action('Go to keycard', () => a.navigate(a.targetKey.x, a.targetKey.y, 'keycard ' + a.targetKey.name)),
      ]),
      BT.action('Hold position', () => { a.mode = 'holding (no route)'; a.stats.waits++; return S().RUNNING; }),
    ]);
  };

  P.update = function () {
    this.px = this.x; this.py = this.y;
    if (this.stun > 0) { this.stun--; this.mode = 'stunned'; return; }
    if (this.cfg.adaptive) this.tree.run({ t: this.sim.t });
    else this.scriptStep();
  };

  P.exitUnlocked = function () { return this.keys === this.w.keys.length && this.codeVersion === this.sim.lock.version; };

  P.threatened = function () {
    const d = this.sim.drone;
    const yes = !!d && d.state === 'CHASE' && this.sim.droneDistAt(this.w.idx(this.x, this.y)) <= 3;
    if (yes !== this.evading) this.sim.say('BT', yes ? 'Drone is chasing and close: switching to Evade' : 'Drone has dropped back: resuming mission');
    this.evading = yes;
    return yes;
  };

  /* ---------- Navigation with A* and replanning ---------- */
  P.costFn = function () {
    const w = this.w, sim = this.sim;
    if (!sim.drone) return (i) => w.cellCost(i);
    return (i) => (sim.droneDistAt(i) <= 1 ? Infinity : w.cellCost(i)); // keep clear of the drone
  };

  P.replan = function (gx, gy, tag, why) {
    const sim = this.sim, st = this.stats;
    const r = ER.plan(this.w, this.x, this.y, gx, gy, { algo: this.cfg.algo, costFn: this.costFn() });
    st.planCalls++; st.expanded += r.expanded;
    if (why !== 'new goal') st.replans++;
    this.lastSearch = { order: r.order, t: sim.t };
    if (!r.found) {
      this.plan = null; this.failedAt[tag] = sim.t;
      sim.say('PLAN', `No route to ${tag} right now (${r.expanded} states searched), waiting`);
      return false;
    }
    this.plan = { tag, path: r.path, idx: 0 };
    if (why !== 'new goal') sim.emit({ type: 'replan', x: this.x, y: this.y });
    sim.say('PLAN', `${why === 'new goal' ? 'Plan' : 'Replan (' + why + ')'} to ${tag}: ${r.path.length - 1} steps, cost ${r.cost}, ${r.expanded} states searched`);
    return true;
  };

  /* Why the current plan can no longer be followed, or null if it is still fine. */
  P.checkPlan = function (p) {
    const cur = p.path[p.idx];
    if (!cur || cur.x !== this.x || cur.y !== this.y) return 'pushed off route';
    const cost = this.costFn();
    for (let i = p.idx + 1; i < p.path.length; i++) {
      const c = p.path[i];
      if (!this.w.isFree(c.x, c.y)) return 'route blocked';
      if (cost(this.w.idx(c.x, c.y)) === Infinity) return 'drone on route';
    }
    return null;
  };

  P.navigate = function (gx, gy, tag) {
    if (this.x === gx && this.y === gy) { this.plan = null; return S().SUCCESS; }
    this.mode = 'going to ' + tag;
    if (!this.plan || this.plan.tag !== tag) {
      if (this.sim.t - (this.failedAt[tag] ?? -99) < 3) return S().FAILURE; // don't re-search every tick
      if (!this.replan(gx, gy, tag, 'new goal')) return S().FAILURE;
    } else {
      const why = this.checkPlan(this.plan);
      if (why && !this.replan(gx, gy, tag, why)) return S().FAILURE;
    }
    const p = this.plan, next = p.path[p.idx + 1];
    this.moveTo(next.x, next.y);
    p.idx++;
    return S().RUNNING;
  };

  P.moveTo = function (x, y) {
    const w = this.w, i = w.idx(x, y);
    this.x = x; this.y = y;
    this.stats.moves++;
    this.stats.pathCost += w.cellCost(i);
    if (w.hazard[i]) this.integrity -= 3; // coolant damages the hull
    const k = w.keyAt(x, y);
    if (k) {
      k.taken = true; this.keys++;
      if (this.targetKey === k) this.targetKey = null;
      this.sim.say('KEY', `Picked up the ${k.name} keycard (${this.keys}/${w.keys.length})`);
      this.sim.emit({ type: 'key', x, y, color: k.color });
    }
  };

  P.pathAhead = function (from, to) {
    if (this.cfg.adaptive) return this.plan ? this.plan.path.slice(this.plan.idx + from, this.plan.idx + to) : [];
    const leg = this.script.legs[this.script.leg];
    return leg ? leg.path.slice(this.script.i + from, this.script.i + to) : [];
  };

  /* ---------- Keycard order: try every order, keep the shortest tour ---------- */
  P.bestTour = function (remaining) {
    if (!remaining.length) return [];
    const w = this.w;
    const fromMe = w.bfs(w.idx(this.x, this.y));
    const fromKey = remaining.map((k) => w.bfs(w.idx(k.x, k.y)));
    const term = w.idx(w.terminal.x, w.terminal.y);
    let best = null, bestLen = Infinity;
    for (const order of permutations([...remaining.keys()])) {
      const legs = [fromMe[w.idx(remaining[order[0]].x, remaining[order[0]].y)]];
      for (let j = 1; j < order.length; j++) legs.push(fromKey[order[j - 1]][w.idx(remaining[order[j]].x, remaining[order[j]].y)]);
      legs.push(fromKey[order[order.length - 1]][term]);
      if (legs.some((d) => d < 0)) continue;
      const len = legs.reduce((s, d) => s + d, 0);
      if (len < bestLen) { bestLen = len; best = order; }
    }
    return best ? best.map((i) => remaining[i]) : [];
  };

  P.chooseKey = function () {
    if (this.targetKey && !this.targetKey.taken) return S().SUCCESS;
    const order = this.bestTour(this.w.keys.filter((k) => !k.taken));
    if (!order.length) return S().FAILURE;
    this.targetKey = order[0];
    this.sim.say('BT', `Best keycard order: ${order.map((k) => k.name).join(' → ')} → terminal`);
    return S().SUCCESS;
  };

  /* ---------- Crack the lock with the CSP solver ---------- */
  P.solveLock = function () {
    const sim = this.sim, lock = sim.lock;
    if (this.codeVersion === lock.version) return S().SUCCESS;
    this.mode = 'cracking the lock';
    if (!this.hack || this.hack.version !== lock.version) {
      if (this.hack) sim.say('CSP', 'The clues changed while solving: starting again');
      const r = ER.solveCSP(lock, { mode: this.cfg.csp, trace: !!sim.cfg.verbose });
      this.stats.cspAssign += r.stats.assignments;
      // Dialling in takes 1 tick per 4 solver assignments, so a smarter solver escapes sooner.
      this.hack = this.lastHack = { version: lock.version, result: r, progress: 0, need: Math.max(2, Math.ceil(r.stats.assignments / 4)) };
      sim.say('CSP', `${ER.CSP_MODES[this.cfg.csp]}: ${r.stats.assignments} assignments, ${r.stats.backtracks} backtracks`);
    }
    this.hack.progress++;
    this.stats.hackTicks++;
    if (this.hack.progress < this.hack.need) return S().RUNNING;
    this.codeVersion = lock.version;
    this.code = this.hack.result.solution;
    this.hack = null;
    sim.say('CSP', `Lock cracked: ${this.code.join('-')}. The exit is open`);
    return S().SUCCESS;
  };

  /* ---------- Evade: step to the neighbouring cell farthest from the drone ---------- */
  P.evade = function () {
    const w = this.w, sim = this.sim;
    let best = null, bestD = sim.droneDistAt(w.idx(this.x, this.y));
    for (const [dx, dy] of ER.DIRS) {
      const nx = this.x + dx, ny = this.y + dy;
      if (!w.isFree(nx, ny)) continue;
      const d = sim.droneDistAt(w.idx(nx, ny));
      if (d > bestD) { bestD = d; best = { x: nx, y: ny }; }
    }
    this.mode = 'evading the drone';
    this.stats.evadeTicks++;
    if (best) this.moveTo(best.x, best.y); else this.stats.waits++;
    return S().RUNNING;
  };

  /* ---------- Baseline: fixed script ---------- */
  P.buildScript = function () {
    const w = this.w;
    const stops = this.bestTour(w.keys).map((k) => ({ x: k.x, y: k.y, kind: 'key' }));
    stops.push({ x: w.terminal.x, y: w.terminal.y, kind: 'terminal' }, { x: w.exit.x, y: w.exit.y, kind: 'exit' });
    this.script = { legs: [], leg: 0, i: 0 };
    let from = { x: this.x, y: this.y };
    for (const s of stops) {
      const r = ER.plan(w, from.x, from.y, s.x, s.y, { algo: this.cfg.algo });
      this.stats.planCalls++; this.stats.expanded += r.expanded;
      this.script.legs.push({ path: r.found ? r.path : [from], kind: s.kind });
      from = s;
    }
    this.sim.say('PLAN', 'Fixed script planned once at the start. It will not replan');
  };
  P.scriptStep = function () {
    const sc = this.script, sim = this.sim;
    let leg = sc.legs[sc.leg];
    while (leg && sc.i >= leg.path.length - 1) {
      if (leg.kind === 'terminal' && this.codeVersion !== sim.lock.version) { this.solveLock(); return; }
      if (leg.kind === 'exit') { this.mode = 'stuck at a locked exit'; this.stats.waits++; return; }
      sc.leg++; sc.i = 0; leg = sc.legs[sc.leg];
    }
    const next = leg.path[sc.i + 1];
    if (!this.w.isFree(next.x, next.y)) { this.mode = 'blocked: the script has no alternative'; this.stats.waits++; return; }
    this.moveTo(next.x, next.y);
    sc.i++;
    this.mode = 'following the fixed script';
  };

  ER.Agent = Agent;
  ER.permutations = permutations;
})(typeof globalThis !== 'undefined' ? globalThis : window);
