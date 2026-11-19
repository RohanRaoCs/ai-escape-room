/* Security drone, controlled by a Finite State Machine.
 *
 *   PATROL --sees agent--> ALERT --2 ticks, still visible--> CHASE
 *   ALERT  --lost sight--> PATROL
 *   CHASE  --lost for 6 ticks or 30-tick battery limit--> COOLDOWN
 *   any    --contact with agent--> COOLDOWN (agent takes damage)
 *   COOLDOWN --timer expires--> PATROL
 *
 * Detection = within Manhattan radius AND clear line of sight (Bresenham through floor). */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const ALERTNESS = { PATROL: 0.2, ALERT: 0.7, CHASE: 1.0, COOLDOWN: 0.05 };

  function Drone(world, detect) {
    this.w = world;
    const wp = world.droneWaypoints.length ? world.droneWaypoints : [world.exit];
    this.wps = wp;
    this.x = wp[0].x; this.y = wp[0].y;
    this.px = this.x; this.py = this.y;
    this.wi = wp.length > 1 ? 1 : 0;
    this.state = 'PATROL';
    this.timer = 0;
    this.chaseTicks = 0;
    this.lost = 0;
    this.detect = detect || 5;
    this.transitions = 0;
  }
  const P = Drone.prototype;
  P.alertness = function () { return ALERTNESS[this.state]; };

  P.lineOfSight = function (x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (!(x0 === this.x && y0 === this.y) && !this.w.isFree(x0, y0)) return false;
      if (x0 === x1 && y0 === y1) return true;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  P.sees = function (a) {
    if (this.state === 'COOLDOWN') return false;
    if (Math.abs(a.x - this.x) + Math.abs(a.y - this.y) > this.detect) return false;
    return this.lineOfSight(this.x, this.y, a.x, a.y);
  };
  P.stepToward = function (tx, ty) {
    const w = this.w;
    const dist = w.bfs(w.idx(tx, ty));
    const here = dist[w.idx(this.x, this.y)];
    if (here <= 0) return;
    for (const [dx, dy] of ER.DIRS) {
      const nx = this.x + dx, ny = this.y + dy;
      if (w.isFree(nx, ny) && dist[w.idx(nx, ny)] === here - 1) { this.x = nx; this.y = ny; return; }
    }
  };
  P.setState = function (s, sim, why) {
    if (s === this.state) return;
    this.state = s;
    this.transitions++;
    if (sim) sim.say('DRONE', `FSM → ${s}${why ? ' (' + why + ')' : ''}`);
  };
  P.update = function (sim) {
    const t = sim.t, a = sim.agent;
    this.px = this.x; this.py = this.y;
    // The target waypoint may have been buried by a collapse: skip it.
    const wp = this.wps[this.wi];
    if (!this.w.isFree(wp.x, wp.y) || (this.x === wp.x && this.y === wp.y)) this.wi = (this.wi + 1) % this.wps.length;
    switch (this.state) {
      case 'PATROL':
        if (this.sees(a)) { this.setState('ALERT', sim, 'agent spotted'); this.timer = 2; this.lastSeen = { x: a.x, y: a.y }; break; }
        if (t % 2 === 0) this.stepToward(this.wps[this.wi].x, this.wps[this.wi].y);
        break;
      case 'ALERT':
        // Investigate: drift toward where the agent was last seen instead of freezing.
        // ALERT lasts until the drone has reached the last-seen spot (or 8 ticks).
        if (this.sees(a)) this.lastSeen = { x: a.x, y: a.y };
        if (this.lastSeen) this.stepToward(this.lastSeen.x, this.lastSeen.y);
        this.timer--;
        if (this.timer <= 0 && this.sees(a)) { this.setState('CHASE', sim, 'target confirmed'); this.chaseTicks = 0; this.lost = 0; }
        else if (this.timer <= -6 || (this.timer <= 0 && this.lastSeen && this.x === this.lastSeen.x && this.y === this.lastSeen.y)) {
          this.setState('PATROL', sim, 'search found nothing');
        }
        break;
      case 'CHASE':
        this.chaseTicks++;
        if (t % 3 !== 2) this.stepToward(a.x, a.y);
        this.lost = this.sees(a) ? 0 : this.lost + 1;
        if (this.lost > 5 || this.chaseTicks > 30) {
          this.setState('COOLDOWN', sim, this.lost > 5 ? 'target lost' : 'battery limit');
          this.timer = 12;
        }
        break;
      case 'COOLDOWN':
        if (t % 2 === 0) this.stepToward(this.wps[this.wi].x, this.wps[this.wi].y);
        if (--this.timer <= 0) this.setState('PATROL', sim, 'recharged');
        break;
    }
  };

  ER.Drone = Drone;
  ER.DRONE_ALERTNESS = ALERTNESS;
})(typeof globalThis !== 'undefined' ? globalThis : window);
