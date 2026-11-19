"""Security drone: a moving obstacle controlled by a finite state machine.

    PATROL   --sees the agent-->                              CHASE
    CHASE    --lost sight for 6 ticks, or 30-tick battery-->  COOLDOWN
    any      --touches the agent (agent loses 25% hull)-->    COOLDOWN
    COOLDOWN --after 12 ticks-->                              PATROL

"Sees" means within 5 cells (Manhattan distance) with a clear line of sight.
"""
from .world import DIRS

DETECT_RANGE = 5


class Drone:
    def __init__(self, world):
        self.w = world
        self.waypoints = world.drone_waypoints or [world.exit]
        self.x, self.y = self.waypoints[0]
        self.px, self.py = self.x, self.y
        self.wp = 1 % len(self.waypoints)
        self.state = "PATROL"
        self.timer = self.chase_ticks = self.lost = 0

    def line_of_sight(self, x1, y1):
        """Bresenham line from the drone to (x1, y1); walls and rubble block it."""
        x0, y0 = self.x, self.y
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while (x0, y0) != (x1, y1):
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
            if not self.w.is_free(x0, y0):
                return False
        return True

    def sees(self, agent):
        return (self.state != "COOLDOWN"
                and abs(agent.x - self.x) + abs(agent.y - self.y) <= DETECT_RANGE
                and self.line_of_sight(agent.x, agent.y))

    def step_toward(self, tx, ty):
        """Move one cell along a shortest path toward (tx, ty)."""
        dist = self.w.bfs(self.w.idx(tx, ty))
        here = dist[self.w.idx(self.x, self.y)]
        if here <= 0:
            return
        for dx, dy in DIRS:
            nx, ny = self.x + dx, self.y + dy
            if self.w.is_free(nx, ny) and dist[self.w.idx(nx, ny)] == here - 1:
                self.x, self.y = nx, ny
                return

    def set_state(self, state, sim, why):
        if state != self.state:
            self.state = state
            sim.say("DRONE", f"{state.title()} ({why})")

    def update(self, sim):
        t, agent = sim.t, sim.agent
        self.px, self.py = self.x, self.y
        wx, wy = self.waypoints[self.wp]
        if not self.w.is_free(wx, wy) or (self.x, self.y) == (wx, wy):
            self.wp = (self.wp + 1) % len(self.waypoints)
            wx, wy = self.waypoints[self.wp]

        if self.state == "PATROL":
            if self.sees(agent):
                self.set_state("CHASE", sim, "agent spotted")
                self.chase_ticks = self.lost = 0
            elif t % 2 == 0:  # patrols at half speed
                self.step_toward(wx, wy)
        elif self.state == "CHASE":
            self.chase_ticks += 1
            if t % 3 != 2:  # chases at two-thirds speed
                self.step_toward(agent.x, agent.y)
            self.lost = 0 if self.sees(agent) else self.lost + 1
            if self.lost > 5 or self.chase_ticks > 30:
                self.set_state("COOLDOWN", sim, "lost the agent" if self.lost > 5 else "battery low")
                self.timer = 12
        else:  # COOLDOWN
            if t % 2 == 0:
                self.step_toward(wx, wy)
            self.timer -= 1
            if self.timer <= 0:
                self.set_state("PATROL", sim, "recharged")
