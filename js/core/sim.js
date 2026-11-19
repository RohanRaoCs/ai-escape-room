/* Simulation loop and dynamic events.
 *
 * Each tick:
 *   1. scheduled events fire: ceiling collapses (aimed at the agent's route), power surges
 *   2. the coolant leak may spread one cell
 *   3. the agent acts (behaviour tree, or fixed script)
 *   4. the drone acts (finite state machine)
 *   5. collisions and win/lose checks
 * A mission fails if the hull reaches 0 or 600 ticks pass. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const DEFAULTS = { seed: 1, algo: 'astar', csp: 'mrv_fc', adaptive: true, dynamic: true, maxTicks: 600, verbose: false };

  function Simulation(cfg) {
    const c = (this.cfg = Object.assign({}, DEFAULTS, cfg));
    this.world = ER.generateWorld(c.seed);
    this.rng = ER.RNG(c.seed * 7919 + 13);
    this.lock = ER.makeLock(ER.RNG(c.seed * 31 + 101));
    this.drone = c.dynamic ? new ER.Drone(this.world) : null;
    this.t = 0; this.done = false; this.result = null;
    this.logs = []; this.fx = [];
    this.collapses = 0; this.surges = 0;
    this.hazardCells = [];
    for (let i = 0; i < this.world.N; i++) if (this.world.hazard[i]) this.hazardCells.push(i);
    // Dynamic facility: 3 collapses and 1 power surge at random (seeded) times.
    this.schedule = [];
    if (c.dynamic) {
      for (let k = 0; k < 3; k++) this.schedule.push({ t: this.rng.int(20, 250), type: 'collapse' });
      this.schedule.push({ t: this.rng.int(60, 250), type: 'surge' });
      this.schedule.sort((a, b) => a.t - b.t);
    }
    this.updateDroneDistances();
    this.agent = new ER.Agent(this, c);
    this.say('SYS', `Seed ${c.seed}, ${c.dynamic ? 'dynamic' : 'static'} facility. Mission: 3 keycards, then the terminal, then the exit`);
  }
  const P = Simulation.prototype;

  P.say = function (cat, msg) {
    if (!this.cfg.verbose) return;
    this.logs.push({ t: this.t, cat, msg });
    if (this.logs.length > 400) this.logs.shift();
  };
  P.emit = function (fx) {
    if (!this.cfg.verbose) return;
    fx.born = typeof performance !== 'undefined' ? performance.now() : 0;
    this.fx.push(fx);
  };

  P.updateDroneDistances = function () {
    if (this.drone) this.droneDist = this.world.bfs(this.world.idx(this.drone.x, this.drone.y));
  };
  /* Corridor distance from a cell to the drone (99 if there is no drone or no path). */
  P.droneDistAt = function (i) {
    if (!this.drone) return 99;
    const d = this.droneDist[i];
    return d < 0 ? 99 : d;
  };

  P.step = function () {
    if (this.done) return;
    while (this.schedule.length && this.schedule[0].t <= this.t) {
      if (this.schedule.shift().type === 'collapse') this.collapse(false); else this.surge(false);
    }
    if (this.cfg.dynamic && this.t > 0 && this.t % 14 === 0) this.spreadCoolant();
    this.updateDroneDistances();
    this.agent.update();
    if (this.drone) this.drone.update(this);
    this.t++;
    this.updateDroneDistances();
    this.checkCollision();
    this.checkEnd();
  };

  P.checkCollision = function () {
    const a = this.agent, d = this.drone;
    if (!d || d.state === 'COOLDOWN') return;
    const same = d.x === a.x && d.y === a.y;
    const swapped = d.x === a.px && d.y === a.py && d.px === a.x && d.py === a.y;
    if (!same && !swapped) return;
    a.integrity -= 25; a.stun = 2; a.stats.hits++;
    d.setState('COOLDOWN', this, 'hit the agent');
    d.timer = 15;
    this.say('HIT', `Drone hit UNIT-7. Hull at ${a.integrity}%`);
    this.emit({ type: 'hit', x: a.x, y: a.y });
  };

  P.checkEnd = function () {
    const a = this.agent, w = this.world;
    if (a.integrity <= 0) this.end(false, 'destroyed');
    else if (a.x === w.exit.x && a.y === w.exit.y && a.exitUnlocked()) this.end(true, 'escaped');
    else if (this.t >= this.cfg.maxTicks) this.end(false, 'timeout');
  };
  P.end = function (success, reason) {
    const s = this.agent.stats;
    this.done = true;
    this.result = {
      seed: this.cfg.seed, success: success ? 1 : 0, reason, ticks: this.t, pathCost: s.pathCost,
      expanded: s.expanded, planCalls: s.planCalls, replans: s.replans, hits: s.hits,
      integrity: Math.max(0, this.agent.integrity), cspAssign: s.cspAssign, hackTicks: s.hackTicks,
    };
    this.say('SYS', success ? `ESCAPED in ${this.t} ticks (path cost ${s.pathCost})` : `Mission failed: ${reason}`);
  };

  /* ---------- Dynamic events ---------- */
  /* Drop rubble 2-12 steps ahead on the agent's route, never sealing off an objective. */
  P.collapse = function (manual) {
    const w = this.world, a = this.agent, here = w.idx(a.x, a.y);
    const ok = (i) => w.tiles[i] === ER.FLOOR && !w.isObjectCell(i) && i !== here && w.objectivesReachable(here, i);
    let target = this.rng.shuffle(a.pathAhead(2, 12).map((c) => w.idx(c.x, c.y))).find(ok);
    const onRoute = target != null;
    for (let k = 0; target == null && k < 100; k++) {
      const i = w.idx(this.rng.int(1, w.W - 2), this.rng.int(1, w.H - 2));
      if (ok(i)) target = i;
    }
    if (target == null) return false;
    w.setTile(target, ER.RUBBLE);
    w.hazard[target] = 0;
    this.collapses++;
    const { x, y } = w.xy(target);
    this.say('EVENT', `${manual ? '[you] ' : ''}Ceiling collapse at (${x},${y})${onRoute ? ', on the planned route' : ''}`);
    this.emit({ type: 'collapse', x, y });
    return true;
  };

  /* Power surge: the lock's constraints change; any known code stops working. */
  P.surge = function (manual) {
    const ch = ER.mutateLock(this.lock, this.rng);
    this.surges++;
    this.lastSurge = Object.assign({ t: this.t }, ch);
    this.say('EVENT', `${manual ? '[you] ' : ''}Power surge: dials ${ch.changedDials.map((d) => 'D' + d).join(' and ')} rewired. Removed: ${ch.removed.join('; ') || 'none'}. Added: ${ch.added.join('; ') || 'none'}`);
  };

  P.spreadCoolant = function () {
    const w = this.world;
    if (!this.hazardCells.length || this.hazardCells.length >= 14) return;
    const c = this.rng.pick(this.hazardCells), [dx, dy] = this.rng.pick(ER.DIRS);
    const nx = (c % w.W) + dx, ny = ((c / w.W) | 0) + dy, n = w.idx(nx, ny);
    if (!w.isFree(nx, ny) || w.hazard[n] || w.isObjectCell(n)) return;
    w.hazard[n] = 1; w.version++;
    this.hazardCells.push(n);
  };

  /* Clicking the map in the UI toggles rubble. */
  P.toggleRubble = function (x, y) {
    const w = this.world, i = w.idx(x, y);
    if (x <= 0 || y <= 0 || x >= w.W - 1 || y >= w.H - 1) return;
    if (w.tiles[i] === ER.FLOOR) {
      if (w.isObjectCell(i) || (this.agent.x === x && this.agent.y === y)) return;
      w.setTile(i, ER.RUBBLE); w.hazard[i] = 0;
      this.say('EVENT', `[you] Rubble dropped at (${x},${y})`);
    } else if (w.tiles[i] === ER.RUBBLE) {
      w.setTile(i, ER.FLOOR);
      this.say('EVENT', `[you] Rubble cleared at (${x},${y})`);
    }
  };

  function runEpisode(cfg) {
    const sim = new Simulation(cfg);
    while (!sim.done) sim.step();
    return sim.result;
  }

  Object.assign(ER, { Simulation, runEpisode, SIM_DEFAULTS: DEFAULTS });
})(typeof globalThis !== 'undefined' ? globalThis : window);
