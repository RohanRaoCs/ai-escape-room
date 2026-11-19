/* World model: a seeded grid facility with walls, rubble, keycards, a terminal, an exit
 * and a coolant leak. Coolant cells cost more to cross, so "path cost" differs from "steps". */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  const FLOOR = 0, WALL = 1, RUBBLE = 2;
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const HAZARD_COST = 5; // a coolant cell costs 1 + 5
  const KEY_DEFS = [
    { name: 'ROSE', color: '#db2777' },
    { name: 'GOLD', color: '#ca8a04' },
    { name: 'GREEN', color: '#059669' },
  ];

  function World(W, H) {
    this.W = W; this.H = H; this.N = W * H;
    this.tiles = new Uint8Array(this.N).fill(WALL);
    this.hazard = new Uint8Array(this.N);
    this.keys = [];
    this.terminal = null;
    this.version = 0; // bumped whenever the map changes
  }
  const P = World.prototype;

  P.idx = function (x, y) { return y * this.W + x; };
  P.xy = function (i) { return { x: i % this.W, y: (i / this.W) | 0 }; };
  P.inb = function (x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; };
  P.isFree = function (x, y) { return this.inb(x, y) && this.tiles[y * this.W + x] === FLOOR; };
  P.cellCost = function (i) { return 1 + (this.hazard[i] ? HAZARD_COST : 0); };

  /* Breadth-first distances (in steps) from cell `from`. Optionally treat one cell as blocked. */
  P.bfs = function (from, blocked) {
    const W = this.W, dist = new Int32Array(this.N).fill(-1), q = [from];
    dist[from] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.isFree(nx, ny)) continue;
        const n = ny * W + nx;
        if (dist[n] >= 0 || n === blocked) continue;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
    return dist;
  };

  /* Cells the agent still needs to reach: untaken keycards, the terminal and the exit. */
  P.objectives = function () {
    const out = this.keys.filter((k) => !k.taken).map((k) => this.idx(k.x, k.y));
    out.push(this.idx(this.terminal.x, this.terminal.y), this.idx(this.exit.x, this.exit.y));
    return out;
  };
  P.objectivesReachable = function (fromIdx, blockedIdx) {
    const d = this.bfs(fromIdx, blockedIdx);
    return this.objectives().every((i) => d[i] >= 0);
  };
  P.isObjectCell = function (i) {
    const { x, y } = this.xy(i);
    const at = (p) => p && p.x === x && p.y === y;
    return at(this.start) || at(this.exit) || at(this.terminal) || this.keys.some(at);
  };
  P.keyAt = function (x, y) { return this.keys.find((k) => !k.taken && k.x === x && k.y === y) || null; };
  P.setTile = function (i, v) { if (this.tiles[i] !== v) { this.tiles[i] = v; this.version++; } };

  function generateWorld(seed, o) {
    o = o || {};
    const W = o.w || 31, H = o.h || 21;
    const rng = ER.RNG(seed * 2654435761 + 7);
    const w = new World(W, H);
    const T = w.tiles, id = (x, y) => y * W + x;
    w.seed = seed;

    // 1. Maze by randomised depth-first carving.
    const stack = [[1, 1]];
    T[id(1, 1)] = FLOOR;
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const opts = DIRS.map(([dx, dy]) => [cx + dx * 2, cy + dy * 2, dx, dy])
        .filter(([nx, ny]) => nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && T[id(nx, ny)] === WALL);
      if (!opts.length) { stack.pop(); continue; }
      const [nx, ny, dx, dy] = rng.pick(opts);
      T[id(cx + dx, cy + dy)] = FLOOR;
      T[id(nx, ny)] = FLOOR;
      stack.push([nx, ny]);
    }
    // 2. Remove some walls to create loops, so a blocked route usually has an alternative.
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      if (T[id(x, y)] !== WALL) continue;
      const hz = T[id(x - 1, y)] === FLOOR && T[id(x + 1, y)] === FLOOR;
      const vt = T[id(x, y - 1)] === FLOOR && T[id(x, y + 1)] === FLOOR;
      if ((hz !== vt) && rng.chance(0.16)) T[id(x, y)] = FLOOR;
    }

    // 3. Place objects. Start top-left; exit at the farthest reachable cell.
    w.start = { x: 1, y: 1 };
    const s0 = id(1, 1), ds = w.bfs(s0);
    let farI = s0;
    for (let i = 0; i < w.N; i++) if (ds[i] > ds[farI]) farI = i;
    w.exit = w.xy(farI);
    let cand = [];
    for (let i = 0; i < w.N; i++) if (ds[i] >= ds[farI] / 4 && i !== farI) cand.push(i);
    const man = (a, b) => Math.abs((a % W) - (b % W)) + Math.abs(((a / W) | 0) - ((b / W) | 0));
    // Pick cells spread far apart from what is already placed.
    const anchors = [s0, farI];
    const pickSpread = () => {
      const top = cand.map((c) => ({ c, s: Math.min(...anchors.map((a) => man(a, c))) })).sort((a, b) => b.s - a.s).slice(0, 5);
      const c = rng.pick(top).c;
      cand = cand.filter((x) => x !== c);
      anchors.push(c);
      return c;
    };
    for (let k = 0; k < 3; k++) w.keys.push(Object.assign({ id: k, taken: false }, w.xy(pickSpread()), KEY_DEFS[k]));
    w.terminal = w.xy(pickSpread());

    // 4. Coolant leak source, and drone patrol waypoints away from the start.
    const far = rng.shuffle(cand.filter((i) => ds[i] >= 8));
    if (far.length) w.hazard[far[0]] = 1;
    w.droneWaypoints = far.slice(1, 5).map((i) => w.xy(i));
    return w;
  }

  Object.assign(ER, { FLOOR, WALL, RUBBLE, DIRS, HAZARD_COST, World, generateWorld });
})(typeof globalThis !== 'undefined' ? globalThis : window);
