/* Security drone: a moving obstacle controlled by a finite state machine.
 *
 *   PATROL   --sees the agent-->              CHASE
 *   CHASE    --lost sight 6 ticks / 30-tick battery limit--> COOLDOWN
 *   any      --touches the agent-->           COOLDOWN   (agent loses 25% hull)
 *   COOLDOWN --after 12 ticks-->              PATROL
 *
 * "Sees" = within 5 cells (Manhattan) with a clear line of sight. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const DETECT = 5;

  function Drone(world) {
    this.w = world;
    this.wps = world.droneWaypoints.length ? world.droneWaypoints : [world.exit];
    this.x = this.wps[0].x; this.y = this.wps[0].y;
    this.px = this.x; this.py = this.y;
    this.wi = this.wps.length > 1 ? 1 : 0;
    this.state = 'PATROL';
    this.timer = 0; this.chaseTicks = 0; this.lost = 0;
  }
  const P = Drone.prototype;

  /* Bresenham line from the drone to (x1, y1); blocked by walls and rubble. */
  P.lineOfSight = function (x1, y1) {
    let x0 = this.x, y0 = this.y;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (!(x0 === x1 && y0 === y1)) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      if (!this.w.isFree(x0, y0)) return false;
    }
    return true;
  };
  P.sees = function (a) {
    return this.state !== 'COOLDOWN' && Math.abs(a.x - this.x) + Math.abs(a.y - this.y) <= DETECT && this.lineOfSight(a.x, a.y);
  };
  /* Move one cell along a shortest path toward (tx, ty). */
  P.stepToward = function (tx, ty) {
    const w = this.w, dist = w.bfs(w.idx(tx, ty)), here = dist[w.idx(this.x, this.y)];
    if (here <= 0) return;
    for (const [dx, dy] of ER.DIRS) {
      const nx = this.x + dx, ny = this.y + dy;
      if (w.isFree(nx, ny) && dist[w.idx(nx, ny)] === here - 1) { this.x = nx; this.y = ny; return; }
    }
  };
  P.setState = function (s, sim, why) {
    if (s === this.state) return;
    this.state = s;
    if (sim) sim.say('DRONE', `${s.charAt(0) + s.slice(1).toLowerCase()} (${why})`);
  };
  P.update = function (sim) {
    const t = sim.t, a = sim.agent;
    this.px = this.x; this.py = this.y;
    let wp = this.wps[this.wi];
    if (!this.w.isFree(wp.x, wp.y) || (this.x === wp.x && this.y === wp.y)) { this.wi = (this.wi + 1) % this.wps.length; wp = this.wps[this.wi]; }

    if (this.state === 'PATROL') {
      if (this.sees(a)) { this.setState('CHASE', sim, 'agent spotted'); this.chaseTicks = 0; this.lost = 0; }
      else if (t % 2 === 0) this.stepToward(wp.x, wp.y); // patrols at half speed
    } else if (this.state === 'CHASE') {
      this.chaseTicks++;
      if (t % 3 !== 2) this.stepToward(a.x, a.y); // chases at two-thirds speed
      this.lost = this.sees(a) ? 0 : this.lost + 1;
      if (this.lost > 5 || this.chaseTicks > 30) { this.setState('COOLDOWN', sim, this.lost > 5 ? 'lost the agent' : 'battery low'); this.timer = 12; }
    } else {
      if (t % 2 === 0) this.stepToward(wp.x, wp.y);
      if (--this.timer <= 0) this.setState('PATROL', sim, 'recharged');
    }
  };

  ER.Drone = Drone;
})(typeof globalThis !== 'undefined' ? globalThis : window);
