/* World model: procedural facility generator, tiles, laser gates, coolant hazard.
 *
 * Tiles: FLOOR / WALL / RUBBLE (rubble = a wall that appeared during the run).
 * Laser gates sit in corridors and cycle ON for GATE_ON of every GATE_PERIOD ticks.
 * The schedule is known to the agent, which is what makes space-time planning possible. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const FLOOR = 0, WALL = 1, RUBBLE = 2;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const GATE_PERIOD = 10, GATE_ON = 4;
  const HAZARD_COST = 5;
  const KEY_DEFS = [
    { name: 'ROSE', color: '#db2777' },
    { name: 'GOLD', color: '#ca8a04' },
    { name: 'GREEN', color: '#059669' },
    { name: 'SKY', color: '#0284c7' },
  ];

  function World(W, H) {
    this.W = W; this.H = H; this.N = W * H;
    this.tiles = new Uint8Array(this.N).fill(WALL);
    this.hazard = new Uint8Array(this.N);
    this.gateIdx = new Int16Array(this.N).fill(-1);
    this.gates = [];
    this.keys = [];
    this.terminal = null;
    this.gatesActive = true;
    this.version = 0; // bumped on every structural change; planners/UI watch it
  }
  const P = World.prototype;

  P.idx = function (x, y) { return y * this.W + x; };
  P.xy = function (i) { return { x: i % this.W, y: (i / this.W) | 0 }; };
  P.inb = function (x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; };
  P.isFree = function (x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H && this.tiles[y * this.W + x] === FLOOR; };
  P.gateOn = function (x, y, t) {
    if (!this.gatesActive) return false;
    const g = this.gateIdx[y * this.W + x];
    if (g < 0) return false;
    return ((t + this.gates[g].phase) % GATE_PERIOD) < GATE_ON;
  };
  P.passable = function (x, y, t) { return this.isFree(x, y) && !this.gateOn(x, y, t); };
  P.cellCost = function (i) { return 1 + (this.hazard[i] ? HAZARD_COST : 0); };

  /* Breadth-first distances from `from` (cell index). Gates are ignored unless opts.t is given. */
  P.bfs = function (from, opts) {
    opts = opts || {};
    const W = this.W, N = this.N, tiles = this.tiles;
    const dist = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    let h = 0, tl = 0;
    const blocked = opts.blocked == null ? -1 : opts.blocked;
    const maxDepth = opts.maxDepth == null ? Infinity : opts.maxDepth;
    const t = opts.t;
    dist[from] = 0; q[tl++] = from;
    while (h < tl) {
      const c = q[h++], d = dist[c];
      if (d >= maxDepth) continue;
      const cx = c % W, cy = (c / W) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cx + DIRS[k][0], ny = cy + DIRS[k][1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= this.H) continue;
        const n = ny * W + nx;
        if (dist[n] >= 0 || n === blocked || tiles[n] !== FLOOR) continue;
        if (t != null && this.gateOn(nx, ny, t)) continue;
        dist[n] = d + 1; q[tl++] = n;
      }
    }
    return dist;
  };

  /* Cells that must stay reachable: untaken keycards, terminal, exit. */
  P.objectives = function () {
    const out = [];
    for (const k of this.keys) if (!k.taken) out.push(this.idx(k.x, k.y));
    if (this.terminal) out.push(this.idx(this.terminal.x, this.terminal.y));
    out.push(this.idx(this.exit.x, this.exit.y));
    return out;
  };
  P.objectivesReachable = function (fromIdx, blockedIdx) {
    const d = this.bfs(fromIdx, { blocked: blockedIdx });
    return this.objectives().every((i) => d[i] >= 0);
  };
  P.isObjectCell = function (i) {
    const { x, y } = this.xy(i);
    if (x === this.start.x && y === this.start.y) return true;
    if (x === this.exit.x && y === this.exit.y) return true;
    if (this.terminal && x === this.terminal.x && y === this.terminal.y) return true;
    for (const k of this.keys) if (k.x === x && k.y === y) return true;
    return this.gateIdx[i] >= 0;
  };
  P.keyAt = function (x, y) {
    for (const k of this.keys) if (!k.taken && k.x === x && k.y === y) return k;
    return null;
  };
  P.setTile = function (i, v) { if (this.tiles[i] !== v) { this.tiles[i] = v; this.version++; } };
  P.gateOrientation = function (g) {
    // 'v' = beam is vertical (corridor runs left-right), 'h' otherwise
    return this.isFree(g.x - 1, g.y) || this.isFree(g.x + 1, g.y) ? 'v' : 'h';
  };

  function generateWorld(seed, o) {
    o = o || {};
    const W = o.w || 31, H = o.h || 21;
    const rng = ER.RNG(seed * 2654435761 + 7);
    const w = new World(W, H);
    w.seed = seed;
    const id = (x, y) => y * W + x;
    const T = w.tiles;

    // 1. Perfect maze by randomized depth-first carving on odd coordinates.
    const stack = [[1, 1]];
    T[id(1, 1)] = FLOOR;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = [];
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx * 2, ny = cy + dy * 2;
        if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && T[id(nx, ny)] === WALL) opts.push([nx, ny, dx, dy]);
      }
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = rng.pick(opts);
      T[id(cx + dx, cy + dy)] = FLOOR;
      T[id(nx, ny)] = FLOOR;
      stack.push([nx, ny]);
    }
    // 2. Knock out extra walls to create loops (so alternative routes exist when one is blocked).
    const loops = o.loops == null ? 0.16 : o.loops;
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (T[id(x, y)] !== WALL) continue;
      const hz = T[id(x - 1, y)] === FLOOR && T[id(x + 1, y)] === FLOOR && T[id(x, y - 1)] === WALL && T[id(x, y + 1)] === WALL;
      const vt = T[id(x, y - 1)] === FLOOR && T[id(x, y + 1)] === FLOOR && T[id(x - 1, y)] === WALL && T[id(x + 1, y)] === WALL;
      if ((hz || vt) && rng.chance(loops)) T[id(x, y)] = FLOOR;
    }
    // 3. A few open labs (rooms).
    const rooms = o.rooms == null ? 3 : o.rooms;
    for (let r = 0; r < rooms; r++) {
      const rw = rng.int(3, 5), rh = rng.int(3, 4);
      const rx = rng.int(1, W - 1 - rw), ry = rng.int(1, H - 1 - rh);
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) T[id(x, y)] = FLOOR;
    }

    // 4. Objects. Start top-left, exit at the farthest reachable cell.
    w.start = { x: 1, y: 1 };
    const s0 = id(1, 1);
    const ds = w.bfs(s0);
    let far = 0, farI = s0;
    for (let i = 0; i < w.N; i++) if (ds[i] > far) { far = ds[i]; farI = i; }
    w.exit = w.xy(farI);
    const used = new Set([s0, farI]);
    let cand = [];
    for (let i = 0; i < w.N; i++) if (ds[i] >= Math.floor(far * 0.25) && !used.has(i)) cand.push(i);

    const man = (a, b) => Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0));
    const pickSpread = (anchors) => {
      const scored = cand.map((c) => ({ c, s: Math.min(...anchors.map((a) => man(a, c))) }));
      scored.sort((a, b) => b.s - a.s);
      const top = scored.slice(0, Math.min(5, scored.length));
      const c = rng.pick(top).c;
      cand = cand.filter((x) => x !== c);
      used.add(c);
      return c;
    };
    const anchors = [s0, farI];
    const nKeys = o.keys == null ? 3 : o.keys;
    for (let k = 0; k < nKeys; k++) {
      const c = pickSpread(anchors); anchors.push(c);
      w.keys.push(Object.assign({ id: k, taken: false }, w.xy(c), KEY_DEFS[k % KEY_DEFS.length]));
    }
    if (o.terminal !== false) {
      const c = pickSpread(anchors); anchors.push(c);
      w.terminal = w.xy(c);
    }

    // 5. Laser gates in corridors; never on a cut-cell, so a detour always exists.
    const nGates = o.gates == null ? 4 : o.gates;
    const gateCands = rng.shuffle(cand.slice()).filter((i) => {
      const { x, y } = w.xy(i);
      if (ds[i] < 4) return false;
      const lr = w.isFree(x - 1, y) && w.isFree(x + 1, y) && !w.isFree(x, y - 1) && !w.isFree(x, y + 1);
      const ud = w.isFree(x, y - 1) && w.isFree(x, y + 1) && !w.isFree(x - 1, y) && !w.isFree(x + 1, y);
      return lr || ud;
    });
    for (const i of gateCands) {
      if (w.gates.length >= nGates) break;
      if (w.gates.some((g) => man(w.idx(g.x, g.y), i) < 5)) continue;
      if (!w.objectivesReachable(s0, i)) continue;
      const g = Object.assign({ phase: rng.int(0, GATE_PERIOD - 1) }, w.xy(i));
      w.gateIdx[i] = w.gates.length;
      w.gates.push(g);
      used.add(i);
    }

    // 6. Coolant leak source.
    const hz = rng.shuffle(cand.filter((i) => !used.has(i) && ds[i] >= 8));
    if (hz.length && o.hazard !== false) { w.hazard[hz[0]] = 1; w.hazardSrc = w.xy(hz[0]); }

    // 7. Drone patrol waypoints (far from start).
    const wpCand = cand.filter((i) => ds[i] >= 8 && w.gateIdx[i] < 0);
    w.droneWaypoints = [];
    const wpAnch = [s0];
    for (let k = 0; k < 4 && wpCand.length; k++) {
      const scored = wpCand.map((c) => ({ c, s: Math.min(...wpAnch.map((a) => man(a, c))) })).sort((a, b) => b.s - a.s);
      const c = rng.pick(scored.slice(0, 6)).c;
      wpAnch.push(c);
      w.droneWaypoints.push(w.xy(c));
    }
    return w;
  }

  Object.assign(ER, { FLOOR, WALL, RUBBLE, DIRS, GATE_PERIOD, GATE_ON, HAZARD_COST, KEY_DEFS, World, generateWorld });
})(typeof globalThis !== 'undefined' ? globalThis : window);
