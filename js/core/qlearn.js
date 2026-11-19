/* Reinforcement Learning lab: tabular Q-learning on a smaller facility.
 *
 * State  = (cell, bitmask of keycards held)       Actions = N/E/S/W
 * Reward = -1 per step, -5 for bumping a wall, +30 per new keycard, +100 for exiting with all cards
 * Q(s,a) += α [ r + γ max_a' Q(s',a') − Q(s,a) ]   with ε-greedy exploration and ε decay.
 *
 * Used to contrast learning with planning: the learned policy is excellent on the map it was
 * trained on, but when a collapse blocks its route it fails until it is retrained, whereas the
 * A* planner adapts immediately. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const ACTS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

  function QLab(seed, o) {
    o = o || {};
    this.seed = seed;
    this.world = ER.generateWorld(seed, { w: o.w || 17, h: o.h || 11, keys: o.keys || 2, terminal: false, gates: 0, rooms: 1, loops: 0.22, hazard: false });
    this.world.gatesActive = false;
    const w = this.world;
    this.K = w.keys.length;
    this.M = 1 << this.K;
    this.full = this.M - 1;
    this.keyBit = new Int8Array(w.N).fill(-1);
    w.keys.forEach((k, i) => { this.keyBit[w.idx(k.x, k.y)] = i; });
    this.startI = w.idx(w.start.x, w.start.y);
    this.exitI = w.idx(w.exit.x, w.exit.y);
    this.alpha = o.alpha || 0.2;
    this.gamma = o.gamma || 0.97;
    this.eps = 1;
    this.epsMin = 0.05;
    this.epsDecay = o.epsDecay || 0.993;
    this.maxSteps = o.maxSteps || 400;
    this.rng = ER.RNG(seed * 97 + 3);
    this.reset();
  }
  const P = QLab.prototype;
  P.reset = function () {
    this.Q = new Float32Array(this.world.N * this.M * 4);
    this.episodes = 0;
    this.eps = 1;
    this.curve = []; // {ep, steps, ret, success, eps}
    this.visits = new Uint32Array(this.world.N);
  };
  P.sIndex = function (cell, mask) { return (cell * this.M + mask) * 4; };
  P.envStep = function (cell, mask, a) {
    const w = this.world, W = w.W;
    const x = (cell % W) + ACTS[a][0], y = ((cell / W) | 0) + ACTS[a][1];
    if (!w.isFree(x, y)) return { cell, mask, r: -5, done: false };
    const n = y * W + x;
    let r = -1;
    const b = this.keyBit[n];
    if (b >= 0 && !(mask & (1 << b))) { mask |= 1 << b; r += 30; }
    const done = n === this.exitI && mask === this.full;
    if (done) r += 100;
    return { cell: n, mask, r, done };
  };
  P.argmax = function (base) {
    const Q = this.Q;
    let best = 0;
    for (let a = 1; a < 4; a++) if (Q[base + a] > Q[base + best]) best = a;
    return best;
  };
  P.trainEpisode = function () {
    let cell = this.startI, mask = 0, ret = 0, steps = 0, done = false;
    const Q = this.Q;
    while (!done && steps < this.maxSteps) {
      const base = this.sIndex(cell, mask);
      const a = this.rng.next() < this.eps ? this.rng.int(0, 3) : this.argmax(base);
      const s2 = this.envStep(cell, mask, a);
      const nb = this.sIndex(s2.cell, s2.mask);
      const target = s2.r + (s2.done ? 0 : this.gamma * Q[nb + this.argmax(nb)]);
      Q[base + a] += this.alpha * (target - Q[base + a]);
      cell = s2.cell; mask = s2.mask; ret += s2.r; steps++; done = s2.done;
      this.visits[cell]++;
    }
    this.episodes++;
    this.eps = Math.max(this.epsMin, this.eps * this.epsDecay);
    const rec = { ep: this.episodes, steps, ret, success: done ? 1 : 0, eps: this.eps };
    this.curve.push(rec);
    return rec;
  };
  P.train = function (n) { let last; for (let i = 0; i < n; i++) last = this.trainEpisode(); return last; };

  /* Greedy rollout of the learned policy (no exploration). Detects loops. */
  P.greedy = function () {
    let cell = this.startI, mask = 0, steps = 0;
    const path = [this.world.xy(cell)];
    const seen = new Set();
    while (steps < this.maxSteps) {
      const key = cell * this.M + mask;
      if (seen.has(key)) return { success: false, steps, path, reason: 'policy loops' };
      seen.add(key);
      const a = this.argmax(this.sIndex(cell, mask));
      const s2 = this.envStep(cell, mask, a);
      steps++;
      if (s2.cell === cell) return { success: false, steps, path, reason: 'walks into a wall' };
      cell = s2.cell; mask = s2.mask;
      path.push(this.world.xy(cell));
      if (s2.done) return { success: true, steps, path };
    }
    return { success: false, steps, path, reason: 'step limit' };
  };

  /* Optimal reference: A* over every keycard order. */
  P.optimal = function () {
    const w = this.world;
    let best = null;
    let expanded = 0;
    for (const perm of ER.permutations(w.keys.map((_, i) => i))) {
      const pts = [w.start].concat(perm.map((i) => w.keys[i]), [w.exit]);
      let steps = 0, ok = true;
      const path = [w.start];
      for (let k = 1; k < pts.length && ok; k++) {
        const r = ER.plan(w, pts[k - 1].x, pts[k - 1].y, pts[k].x, pts[k].y, { algo: 'astar' });
        expanded += r.expanded;
        if (!r.found) ok = false; else { steps += r.path.length - 1; path.push(...r.path.slice(1)); }
      }
      if (ok && (!best || steps < best.steps)) best = { steps, path };
    }
    return best ? Object.assign(best, { expanded }) : { steps: Infinity, path: [], expanded };
  };

  /* Drop rubble on the learned route at a cell whose removal keeps the goal reachable. */
  P.mutate = function () {
    const w = this.world, g = this.greedy();
    const route = g.path.slice(2, -2).map((p) => w.idx(p.x, p.y));
    const keep = (i) => {
      if (this.keyBit[i] >= 0 || i === this.exitI || i === this.startI) return false;
      const d = w.bfs(this.startI, { blocked: i });
      return d[this.exitI] >= 0 && w.keys.every((k) => d[w.idx(k.x, k.y)] >= 0);
    };
    const cands = this.rng.shuffle(route.slice()).filter(keep);
    if (!cands.length) return null;
    w.setTile(cands[0], ER.RUBBLE);
    return w.xy(cands[0]);
  };

  ER.QLab = QLab;
  ER.Q_ACTS = ACTS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
