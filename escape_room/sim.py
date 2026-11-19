"""Simulation loop and dynamic events.

Each tick:
  1. scheduled events fire: ceiling collapses (aimed at the agent's route) and a power surge
  2. the coolant leak may spread one cell
  3. the agent acts (behaviour tree, or the fixed script)
  4. the drone acts (finite state machine)
  5. collisions and win/lose checks
A mission fails if the hull reaches 0 or 600 ticks pass.
"""
import random

from .agent import Agent
from .csp import make_lock, mutate_lock
from .drone import Drone
from .world import DIRS, FLOOR, RUBBLE, generate_world

MAX_TICKS = 600


class Simulation:
    def __init__(self, seed=1, algo="astar", csp="mrv_fc", adaptive=True, dynamic=True, verbose=False):
        self.seed, self.dynamic, self.verbose = seed, dynamic, verbose
        self.world = generate_world(seed)
        self.rng = random.Random(seed * 7919 + 13)
        self.lock = make_lock(random.Random(seed * 31 + 101))
        self.drone = Drone(self.world) if dynamic else None
        self.t = 0
        self.done = False
        self.result = None
        self.logs = []
        self.last_surge = None
        self.hazard_cells = [i for i in range(self.world.N) if self.world.hazard[i]]
        # Dynamic facility: 3 collapses and 1 power surge at random (seeded) times.
        self.schedule = []
        if dynamic:
            self.schedule = [(self.rng.randint(20, 250), "collapse") for _ in range(3)]
            self.schedule.append((self.rng.randint(60, 250), "surge"))
            self.schedule.sort()
        self.update_drone_distances()
        self.agent = Agent(self, algo, csp, adaptive)
        self.say("SYS", f"Seed {seed}, {'dynamic' if dynamic else 'static'} facility. Mission: 3 keycards, then the terminal, then the exit")

    def say(self, category, message):
        if self.verbose:
            self.logs.append((self.t, category, message))
            del self.logs[:-300]

    def update_drone_distances(self):
        if self.drone:
            self.drone_dist = self.world.bfs(self.world.idx(self.drone.x, self.drone.y))

    def drone_dist_at(self, cell):
        """Corridor distance from a cell to the drone (99 if there is no drone or no path)."""
        if self.drone is None or self.drone_dist[cell] < 0:
            return 99
        return self.drone_dist[cell]

    def step(self):
        if self.done:
            return
        while self.schedule and self.schedule[0][0] <= self.t:
            _, event = self.schedule.pop(0)
            self.collapse() if event == "collapse" else self.surge()
        if self.dynamic and self.t > 0 and self.t % 14 == 0:
            self.spread_coolant()
        self.update_drone_distances()
        self.agent.update()
        if self.drone:
            self.drone.update(self)
        self.t += 1
        self.update_drone_distances()
        self.check_collision()
        self.check_end()

    def check_collision(self):
        a, d = self.agent, self.drone
        if d is None or d.state == "COOLDOWN":
            return
        same = (d.x, d.y) == (a.x, a.y)
        swapped = (d.x, d.y) == (a.px, a.py) and (d.px, d.py) == (a.x, a.y)
        if same or swapped:
            a.integrity -= 25
            a.stun = 2
            a.stats["hits"] += 1
            d.set_state("COOLDOWN", self, "hit the agent")
            d.timer = 15
            self.say("HIT", f"Drone hit UNIT-7. Hull at {a.integrity}%")

    def check_end(self):
        a, w = self.agent, self.world
        if a.integrity <= 0:
            self.end(False, "destroyed")
        elif (a.x, a.y) == w.exit and a.exit_unlocked():
            self.end(True, "escaped")
        elif self.t >= MAX_TICKS:
            self.end(False, "timeout")

    def end(self, success, reason):
        s = self.agent.stats
        self.done = True
        self.result = dict(seed=self.seed, success=int(success), reason=reason, ticks=self.t, path_cost=s["path_cost"],
                           expanded=s["expanded"], plan_calls=s["plan_calls"], replans=s["replans"], hits=s["hits"],
                           integrity=max(0, self.agent.integrity), csp_assignments=s["csp_assignments"])
        self.say("SYS", f"ESCAPED in {self.t} ticks (path cost {s['path_cost']})" if success else f"Mission failed: {reason}")

    # ---------- dynamic events ----------
    def collapse(self, by_user=False):
        """Drop rubble 2-12 steps ahead on the agent's route, never sealing off an objective."""
        w, a = self.world, self.agent
        here = w.idx(a.x, a.y)

        def ok(i):
            return w.tiles[i] == FLOOR and not w.is_object_cell(i) and i != here and w.objectives_reachable(here, i)

        ahead = [w.idx(x, y) for x, y in a.path_ahead(2, 12)]
        self.rng.shuffle(ahead)
        target = next((i for i in ahead if ok(i)), None)
        on_route = target is not None
        for _ in range(100):
            if target is not None:
                break
            i = w.idx(self.rng.randint(1, w.W - 2), self.rng.randint(1, w.H - 2))
            if ok(i):
                target = i
        if target is None:
            return
        w.set_tile(target, RUBBLE)
        w.hazard[target] = 0
        x, y = w.xy(target)
        self.say("EVENT", f"{'[you] ' if by_user else ''}Ceiling collapse at ({x},{y}){', on the planned route' if on_route else ''}")

    def surge(self, by_user=False):
        """Power surge: the lock's constraints change; any known code stops working."""
        ch = mutate_lock(self.lock, self.rng)
        self.last_surge = (self.t, ch["added"])
        self.say("EVENT", f"{'[you] ' if by_user else ''}Power surge: dials {' and '.join('D%d' % d for d in ch['changed_dials'])} rewired. "
                          f"Removed: {'; '.join(ch['removed']) or 'none'}. Added: {'; '.join(ch['added']) or 'none'}")

    def spread_coolant(self):
        w = self.world
        if not self.hazard_cells or len(self.hazard_cells) >= 14:
            return
        c = self.rng.choice(self.hazard_cells)
        dx, dy = self.rng.choice(DIRS)
        nx, ny = c % w.W + dx, c // w.W + dy
        n = w.idx(nx, ny)
        if w.is_free(nx, ny) and not w.hazard[n] and not w.is_object_cell(n):
            w.hazard[n] = 1
            w.version += 1
            self.hazard_cells.append(n)

    def toggle_rubble(self, x, y):
        """Used by the GUI: clicking a cell drops or clears rubble."""
        w = self.world
        if not (0 < x < w.W - 1 and 0 < y < w.H - 1):
            return
        i = w.idx(x, y)
        if w.tiles[i] == FLOOR and not w.is_object_cell(i) and (x, y) != (self.agent.x, self.agent.y):
            w.set_tile(i, RUBBLE)
            w.hazard[i] = 0
            self.say("EVENT", f"[you] Rubble dropped at ({x},{y})")
        elif w.tiles[i] == RUBBLE:
            w.set_tile(i, FLOOR)
            self.say("EVENT", f"[you] Rubble cleared at ({x},{y})")


def run_episode(**config):
    sim = Simulation(**config)
    while not sim.done:
        sim.step()
    return sim.result
