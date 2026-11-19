/* Simulation loop and dynamic events.
 *
 * One tick:
 *   1. scheduled events fire (ceiling collapse onto the agent's route, power surge)
 *   2. coolant spreads
 *   3. sensors update (drone BFS distance field + fuzzy threat table)
 *   4. agent acts (Behaviour Tree tick, or fixed script)
 *   5. drone acts (FSM)
 *   6. t++, then interactions: drone contact, laser zap, win/lose checks */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const DYNAMICS = {
    off: { label: 'Static', drone: false, gates: false, collapses: 0, surges: 0, hazardEvery: 0, hazardMax: 0, detect: 5 },
    normal: { label: 'Dynamic', drone: true, gates: true, collapses: 3, surges: 1, hazardEvery: 14, hazardMax: 14, detect: 5 },
    chaos: { label: 'Chaos', drone: true, gates: true, collapses: 6, surges: 2, hazardEvery: 7, hazardMax: 30, detect: 6 },
  };
  const DEFAULTS = {
    seed: 1, algo: 'astar', fuzzy: true, timeAware: true, adaptive: true, dynamics: 'normal',
    csp: 'mrv_fc_ac3', w: 31, h: 21, maxTicks: 900, riskThreshold: 68, riskWeight: 30, verbose: false,
  };

  function Simulation(cfg) {
    const c = (this.cfg = Object.assign({}, DEFAULTS, cfg));
    this.dyn = DYNAMICS[c.dynamics];
    this.world = ER.generateWorld(c.seed, { w: c.w, h: c.h });
    this.world.gatesActive = this.dyn.gates;
    this.rng = ER.RNG(c.seed * 7919 + 13);
    this.lock = ER.makeLock(ER.RNG(c.seed * 31 + 101), 5);
    this.fuzzy = ER.makeRiskFuzzy();
    this.riskCache = new Map();
    this.drone = this.dyn.drone ? new ER.Drone(this.world, this.dyn.detect) : null;
    this.t = 0;
    this.logs = [];
    this.fx = [];
    this.done = false;
    this.result = null;
    this.collapses = 0;
    this.surges = 0;
    this.hazardCells = [];
    for (let i = 0; i < this.world.N; i++) if (this.world.hazard[i]) this.hazardCells.push(i);
    this.schedule = [];
    for (let k = 0; k < this.dyn.collapses; k++) this.schedule.push({ t: this.rng.int(20, 300), type: 'collapse' });
    for (let k = 0; k < this.dyn.surges; k++) this.schedule.push({ t: this.rng.int(70, 330), type: 'surge' });
    this.schedule.sort((a, b) => a.t - b.t);
    this.agent = null;
    this.updateSensors();
    this.agent = new ER.Agent(this, c);
    this.say('SYS', `Facility ${c.w}×${c.h}, seed ${c.seed}. Dynamics: ${this.dyn.label}. Mission: ${this.world.keys.length} keycards → terminal → vault exit`);
  }
  const P = Simulation.prototype;

  P.say = function (cat, msg) {
    if (!this.cfg.verbose) return;
    this.logs.push({ t: this.t, cat, msg });
    if (this.logs.length > 600) this.logs.splice(0, 100);
  };
  P.emit = function (fx) {
    if (!this.cfg.verbose) return;
    fx.t = this.t; fx.born = (typeof performance !== 'undefined' ? performance.now() : 0);
    this.fx.push(fx);
    if (this.fx.length > 80) this.fx.shift();
  };

  P.updateSensors = function () {
    const w = this.world, d = this.drone;
    if (!d) return;
    this.droneDist = w.bfs(w.idx(d.x, d.y));
    const alert = d.alertness();
    const integ = this.agent ? Math.max(0, Math.round(this.agent.integrity / 5) * 5) : 100;
    const key = alert + '|' + integ;
    let tab = this.riskCache.get(key);
    if (!tab) {
      tab = new Float32Array(21);
      for (let k = 0; k <= 20; k++) tab[k] = this.fuzzy.infer({ distance: k, alert, integrity: integ }).value;
      this.riskCache.set(key, tab);
    }
    this.riskTable = tab;
  };
  P.riskAt = function (i) {
    if (!this.drone) return 0;
    const d = this.droneDist[i];
    return this.riskTable[d < 0 || d > 20 ? 20 : d];
  };
  P.droneDistAt = function (i) {
    if (!this.drone) return 20;
    const d = this.droneDist[i];
    return d < 0 || d > 20 ? 20 : d;
  };

  P.step = function () {
    if (this.done) return;
    const t = this.t;
    while (this.schedule.length && this.schedule[0].t <= t) {
      const e = this.schedule.shift();
      if (e.type === 'collapse') this.collapse(false); else this.surge(false);
    }
    this.spreadHazard(t);
    this.updateSensors();
    this.agent.update();
    if (this.drone) this.drone.update(this);
    this.t++;
    this.interactions();
    this.updateSensors();
    this.checkEnd();
  };

  P.interactions = function () {
    const a = this.agent, d = this.drone, w = this.world;
    if (d && d.state !== 'COOLDOWN') {
      const same = d.x === a.x && d.y === a.y;
      const swapped = d.x === a.px && d.y === a.py && d.px === a.x && d.py === a.y;
      if (same || swapped) {
        a.integrity -= 25; a.stun = 2; a.stats.hits++;
        d.setState('COOLDOWN', this, 'contact');
        d.timer = 15;
        this.say('HIT', `Drone strike! Integrity ${a.integrity}%. Stunned for 2 ticks`);
        this.emit({ type: 'hit', x: a.x, y: a.y });
      }
    }
    if (w.gateOn(a.x, a.y, this.t)) {
      a.integrity -= 12; a.stats.zaps++;
      this.say('HIT', `Laser gate fired while crossing (${a.x},${a.y}). Integrity ${a.integrity}%`);
      this.emit({ type: 'zap', x: a.x, y: a.y });
      if (w.isFree(a.px, a.py) && !w.gateOn(a.px, a.py, this.t)) { a.x = a.px; a.y = a.py; }
    }
  };

  P.checkEnd = function () {
    const a = this.agent, w = this.world;
    if (a.integrity <= 0) this.end(false, 'destroyed');
    else if (a.x === w.exit.x && a.y === w.exit.y && a.exitUnlocked()) this.end(true, 'escaped');
    else if (this.t >= this.cfg.maxTicks) this.end(false, 'timeout');
  };

  P.end = function (success, reason) {
    this.done = true;
    this.result = this.metrics(success, reason);
    this.say('SYS', success ? `ESCAPED in ${this.t} ticks, path cost ${this.agent.stats.pathCost}` : `MISSION FAILED (${reason}) at tick ${this.t}`);
  };

  P.metrics = function (success, reason) {
    const a = this.agent, s = a.stats;
    return {
      seed: this.cfg.seed, success: success ? 1 : 0, reason, ticks: this.t, moves: s.moves, waits: s.waits,
      pathCost: s.pathCost, expanded: s.expanded, planCalls: s.planCalls, replans: s.replans,
      planMs: +s.planMs.toFixed(3), hits: s.hits, zaps: s.zaps, hazardSteps: s.hazardSteps,
      evadeTicks: s.evadeTicks, integrity: Math.max(0, a.integrity), cspAssign: s.cspAssign,
      cspBacktracks: s.cspBacktracks, cspChecks: s.cspChecks, hackTicks: s.hackTicks,
      collapses: this.collapses, surges: this.surges,
      replansBlocked: s.replansBy['route blocked'] || 0,
      replansGate: (s.replansBy['laser gate'] || 0) + (s.replansBy['gate timing'] || 0),
      replansThreat: (s.replansBy['threat drift'] || 0) + (s.replansBy['drone on route'] || 0),
      replansDeviated: s.replansBy['deviated'] || 0,
    };
  };

  /* ---------- Dynamic events ---------- */
  P.collapse = function (manual) {
    const w = this.world, a = this.agent, rng = this.rng;
    const aCell = w.idx(a.x, a.y);
    const dCell = this.drone ? w.idx(this.drone.x, this.drone.y) : -1;
    const valid = (i) => w.tiles[i] === ER.FLOOR && !w.isObjectCell(i) && i !== aCell && i !== dCell;
    let target = -1, onRoute = false;
    const ahead = rng.shuffle(a.pathAhead(2, 12).map((c) => w.idx(c.x, c.y)));
    for (const i of ahead) if (valid(i) && w.objectivesReachable(aCell, i)) { target = i; onRoute = true; break; }
    if (target < 0) {
      for (let k = 0; k < 120; k++) {
        const x = rng.int(1, w.W - 2), y = rng.int(1, w.H - 2), i = w.idx(x, y);
        const md = Math.abs(x - a.x) + Math.abs(y - a.y);
        if (md < 3 || md > 14) continue;
        if (valid(i) && w.objectivesReachable(aCell, i)) { target = i; break; }
      }
    }
    if (target < 0) return false;
    w.setTile(target, ER.RUBBLE);
    w.hazard[target] = 0;
    this.collapses++;
    const { x, y } = w.xy(target);
    this.say('EVENT', `${manual ? '[operator] ' : ''}Ceiling collapse at (${x},${y})${onRoute ? ', right on the planned route!' : ''}`);
    this.emit({ type: 'collapse', x, y });
    return true;
  };

  P.surge = function (manual) {
    const ch = ER.mutateLock(this.lock, this.rng);
    this.surges++;
    this.lastSurge = Object.assign({ t: this.t }, ch);
    this.say('EVENT', `${manual ? '[operator] ' : ''}POWER SURGE: dials ${ch.changedDials.map((d) => 'D' + d).join(', ')} rewired. ` +
      `Clues removed: ${ch.removed.length ? ch.removed.join('; ') : 'none'}. Clues added: ${ch.added.length ? ch.added.join('; ') : 'none'}`);
    if (this.agent && this.agent.codeVersion === this.lock.version - 1) this.say('BT', 'Known vault code is now invalid, so "Vault unlocked?" fails and the BT falls back to "Crack the lock"');
    this.emit({ type: 'surge' });
  };

  P.spreadHazard = function (t) {
    const dy = this.dyn, w = this.world;
    if (!dy.hazardEvery || t === 0 || t % dy.hazardEvery !== 0 || this.hazardCells.length >= dy.hazardMax || !this.hazardCells.length) return;
    for (let tries = 0; tries < 8; tries++) {
      const c = this.rng.pick(this.hazardCells);
      const cx = c % w.W, cy = (c / w.W) | 0;
      const [dx, dyy] = this.rng.pick(ER.DIRS);
      const nx = cx + dx, ny = cy + dyy;
      if (!w.isFree(nx, ny)) continue;
      const n = w.idx(nx, ny);
      if (w.hazard[n] || w.isObjectCell(n)) continue;
      w.hazard[n] = 1; w.version++;
      this.hazardCells.push(n);
      if (this.hazardCells.length % 4 === 0) this.say('EVENT', `Coolant leak spreading (${this.hazardCells.length} cells). Step cost there ×${1 + ER.HAZARD_COST}`);
      return;
    }
  };

  /* ---------- Operator (user) interventions from the UI ---------- */
  P.toggleRubble = function (x, y) {
    const w = this.world, i = w.idx(x, y), a = this.agent;
    if (x <= 0 || y <= 0 || x >= w.W - 1 || y >= w.H - 1) return false;
    if (w.tiles[i] === ER.FLOOR) {
      if (w.isObjectCell(i) || (a.x === x && a.y === y)) return false;
      w.setTile(i, ER.RUBBLE); w.hazard[i] = 0;
      this.say('EVENT', `[operator] Rubble dropped at (${x},${y})`);
      this.emit({ type: 'collapse', x, y });
    } else {
      w.setTile(i, ER.FLOOR);
      this.say('EVENT', `[operator] Cleared (${x},${y})`);
    }
    return true;
  };
  P.toggleHazard = function (x, y) {
    const w = this.world, i = w.idx(x, y);
    if (!w.isFree(x, y)) return false;
    w.hazard[i] = w.hazard[i] ? 0 : 1; w.version++;
    if (w.hazard[i]) this.hazardCells.push(i); else this.hazardCells = this.hazardCells.filter((c) => c !== i);
    this.say('EVENT', `[operator] Coolant ${w.hazard[i] ? 'spilled' : 'mopped'} at (${x},${y})`);
    return true;
  };
  P.moveDrone = function (x, y) {
    if (!this.drone || !this.world.isFree(x, y)) return false;
    this.drone.x = x; this.drone.y = y; this.drone.px = x; this.drone.py = y;
    this.say('EVENT', `[operator] Drone relocated to (${x},${y})`);
    this.updateSensors();
    return true;
  };
  P.alertDrone = function () {
    if (!this.drone) return;
    this.drone.setState('CHASE', this, 'operator alarm');
    this.drone.chaseTicks = 0; this.drone.lost = 0;
    this.updateSensors();
  };

  function runEpisode(cfg) {
    const sim = new Simulation(cfg);
    const t0 = ER.now();
    while (!sim.done) sim.step();
    sim.result.wallMs = +(ER.now() - t0).toFixed(2);
    return sim.result;
  }

  Object.assign(ER, { Simulation, DYNAMICS, SIM_DEFAULTS: DEFAULTS, runEpisode });
})(typeof globalThis !== 'undefined' ? globalThis : window);
