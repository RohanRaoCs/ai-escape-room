"""UNIT-7, the escape agent.

Decisions  : a behaviour tree re-evaluated from the root every tick:
               Survive > Escape > Crack the lock > Collect keycards > Hold position
Navigation : A* (or Dijkstra / BFS). The drone and the cells next to it count as blocked.
             Every tick the rest of the route is re-checked, and a new plan is made when
             rubble blocks it, the drone moves onto it, or the agent was pushed off it.
Puzzle     : the CSP solver cracks the vault lock; a power surge invalidates the code.

With adaptive=False the agent is the "fixed script" baseline: it plans the whole mission
once at the start and follows it blindly (no replanning, no evasion).
"""
import math
from itertools import permutations

from . import bt
from .csp import CSP_MODES, solve
from .search import plan
from .world import DIRS


class Agent:
    def __init__(self, sim, algo="astar", csp="mrv_fc", adaptive=True):
        self.sim, self.w = sim, sim.world
        self.algo, self.csp_mode, self.adaptive = algo, csp, adaptive
        self.x, self.y = self.w.start
        self.px, self.py = self.x, self.y
        self.integrity = 100
        self.keys = 0
        self.code_version = -1  # lock version the agent has cracked
        self.code = None
        self.plan = None  # {"tag", "path", "idx"}
        self.last_search = None  # (expanded cells, tick) for drawing
        self.hack = None  # lock-solving progress
        self.last_hack = None
        self.target_key = None
        self.stun = 0
        self.evading = False
        self.failed_at = {}
        self.mode = "starting"
        self.stats = dict(moves=0, waits=0, path_cost=0, expanded=0, plan_calls=0, replans=0, hits=0, csp_assignments=0)
        if adaptive:
            self.tree = self.build_tree()
        else:
            self.tree = None
            self.build_script()

    # ---------- behaviour tree ----------
    def build_tree(self):
        w = self.w
        return bt.selector("Root", [
            bt.sequence("Survive", [
                bt.condition("Drone chasing nearby?", self.threatened),
                bt.action("Evade drone", self.evade),
            ]),
            bt.sequence("Escape", [
                bt.condition("Vault unlocked?", self.exit_unlocked),
                bt.action("Go to exit", lambda: self.navigate(w.exit, "exit")),
            ]),
            bt.sequence("Crack the lock", [
                bt.condition("All keycards held?", lambda: self.keys == len(w.keys)),
                bt.action("Go to terminal", lambda: self.navigate(w.terminal, "terminal")),
                bt.action("Solve lock (CSP)", self.solve_lock),
            ]),
            bt.sequence("Collect keycards", [
                bt.action("Choose next keycard", self.choose_key),
                bt.action("Go to keycard", lambda: self.navigate((self.target_key.x, self.target_key.y), "keycard " + self.target_key.name)),
            ]),
            bt.action("Hold position", self.hold),
        ])

    def update(self):
        self.px, self.py = self.x, self.y
        if self.stun > 0:
            self.stun -= 1
            self.mode = "stunned"
        elif self.adaptive:
            self.tree.run(self.sim.t)
        else:
            self.script_step()

    def exit_unlocked(self):
        return self.keys == len(self.w.keys) and self.code_version == self.sim.lock.version

    def threatened(self):
        d = self.sim.drone
        yes = d is not None and d.state == "CHASE" and self.sim.drone_dist_at(self.w.idx(self.x, self.y)) <= 3
        if yes != self.evading:
            self.sim.say("BT", "Drone is chasing and close: switching to Evade" if yes else "Drone has dropped back: resuming the mission")
        self.evading = yes
        return yes

    def hold(self):
        self.mode = "holding (no route right now)"
        self.stats["waits"] += 1
        return bt.RUNNING

    # ---------- navigation with A* and replanning ----------
    def cost_fn(self):
        w, sim = self.w, self.sim
        if sim.drone is None:
            return w.cell_cost
        return lambda i: math.inf if sim.drone_dist_at(i) <= 1 else w.cell_cost(i)  # keep clear of the drone

    def replan(self, goal, tag, why):
        r = plan(self.w, (self.x, self.y), goal, self.algo, self.cost_fn())
        self.stats["plan_calls"] += 1
        self.stats["expanded"] += r.expanded
        if why != "new goal":
            self.stats["replans"] += 1
        self.last_search = (r.order, self.sim.t)
        if not r.found:
            self.plan = None
            self.failed_at[tag] = self.sim.t
            self.sim.say("PLAN", f"No route to {tag} right now ({r.expanded} states searched), waiting")
            return False
        self.plan = {"tag": tag, "path": r.path, "idx": 0}
        label = "Plan" if why == "new goal" else f"Replan ({why})"
        self.sim.say("PLAN", f"{label} to {tag}: {len(r.path) - 1} steps, cost {r.cost}, {r.expanded} states searched")
        return True

    def check_plan(self, p):
        """Why the current plan can no longer be followed, or None if it is still fine."""
        if p["path"][p["idx"]] != (self.x, self.y):
            return "pushed off route"
        cost = self.cost_fn()
        for x, y in p["path"][p["idx"] + 1:]:
            if not self.w.is_free(x, y):
                return "route blocked"
            if cost(self.w.idx(x, y)) == math.inf:
                return "drone on route"
        return None

    def navigate(self, goal, tag):
        if (self.x, self.y) == goal:
            self.plan = None
            return bt.SUCCESS
        self.mode = "going to " + tag
        if self.plan is None or self.plan["tag"] != tag:
            if self.sim.t - self.failed_at.get(tag, -99) < 3:  # don't re-search every tick
                return bt.FAILURE
            if not self.replan(goal, tag, "new goal"):
                return bt.FAILURE
        else:
            why = self.check_plan(self.plan)
            if why and not self.replan(goal, tag, why):
                return bt.FAILURE
        p = self.plan
        self.move_to(*p["path"][p["idx"] + 1])
        p["idx"] += 1
        return bt.RUNNING

    def move_to(self, x, y):
        i = self.w.idx(x, y)
        self.x, self.y = x, y
        self.stats["moves"] += 1
        self.stats["path_cost"] += self.w.cell_cost(i)
        if self.w.hazard[i]:
            self.integrity -= 3  # coolant damages the hull
        key = self.w.key_at(x, y)
        if key:
            key.taken = True
            self.keys += 1
            if self.target_key is key:
                self.target_key = None
            self.sim.say("KEY", f"Picked up the {key.name} keycard ({self.keys}/{len(self.w.keys)})")

    def path_ahead(self, start, end):
        if self.adaptive:
            return self.plan["path"][self.plan["idx"] + start:self.plan["idx"] + end] if self.plan else []
        sc = self.script
        if sc["leg"] >= len(sc["legs"]):
            return []
        return sc["legs"][sc["leg"]]["path"][sc["i"] + start:sc["i"] + end]

    # ---------- keycard order: try every order, keep the shortest tour ----------
    def best_tour(self, remaining):
        if not remaining:
            return []
        w = self.w
        from_me = w.bfs(w.idx(self.x, self.y))
        from_key = [w.bfs(w.idx(k.x, k.y)) for k in remaining]
        terminal = w.idx(*w.terminal)
        best, best_len = None, math.inf
        for order in permutations(range(len(remaining))):
            legs = [from_me[w.idx(remaining[order[0]].x, remaining[order[0]].y)]]
            legs += [from_key[a][w.idx(remaining[b].x, remaining[b].y)] for a, b in zip(order, order[1:])]
            legs.append(from_key[order[-1]][terminal])
            if min(legs) >= 0 and sum(legs) < best_len:
                best, best_len = order, sum(legs)
        return [remaining[i] for i in best] if best else []

    def choose_key(self):
        if self.target_key and not self.target_key.taken:
            return bt.SUCCESS
        order = self.best_tour([k for k in self.w.keys if not k.taken])
        if not order:
            return bt.FAILURE
        self.target_key = order[0]
        self.sim.say("BT", "Best keycard order: " + " -> ".join(k.name for k in order) + " -> terminal")
        return bt.SUCCESS

    # ---------- crack the lock with the CSP solver ----------
    def solve_lock(self):
        lock = self.sim.lock
        if self.code_version == lock.version:
            return bt.SUCCESS
        self.mode = "cracking the lock"
        if self.hack is None or self.hack["version"] != lock.version:
            if self.hack:
                self.sim.say("CSP", "The clues changed while solving: starting again")
            r = solve(lock, self.csp_mode, trace=self.sim.verbose)
            self.stats["csp_assignments"] += r.assignments
            # Dialling in takes 1 tick per 4 solver assignments, so a smarter solver escapes sooner.
            self.hack = self.last_hack = {"version": lock.version, "result": r, "progress": 0, "need": max(2, math.ceil(r.assignments / 4))}
            self.sim.say("CSP", f"{CSP_MODES[self.csp_mode]}: {r.assignments} assignments, {r.backtracks} backtracks")
        self.hack["progress"] += 1
        if self.hack["progress"] < self.hack["need"]:
            return bt.RUNNING
        self.code_version, self.code = lock.version, self.hack["result"].solution
        self.hack = None
        self.sim.say("CSP", f"Lock cracked: {'-'.join(map(str, self.code))}. The exit is open")
        return bt.SUCCESS

    # ---------- evade: step to the neighbouring cell farthest from the drone ----------
    def evade(self):
        best, best_d = None, self.sim.drone_dist_at(self.w.idx(self.x, self.y))
        for dx, dy in DIRS:
            nx, ny = self.x + dx, self.y + dy
            if self.w.is_free(nx, ny):
                d = self.sim.drone_dist_at(self.w.idx(nx, ny))
                if d > best_d:
                    best, best_d = (nx, ny), d
        self.mode = "evading the drone"
        if best:
            self.move_to(*best)
        else:
            self.stats["waits"] += 1
        return bt.RUNNING

    # ---------- baseline: fixed script ----------
    def build_script(self):
        w = self.w
        stops = [((k.x, k.y), "key") for k in self.best_tour(w.keys)] + [(w.terminal, "terminal"), (w.exit, "exit")]
        self.script = {"legs": [], "leg": 0, "i": 0}
        here = (self.x, self.y)
        for pos, kind in stops:
            r = plan(w, here, pos, self.algo)
            self.stats["plan_calls"] += 1
            self.stats["expanded"] += r.expanded
            self.script["legs"].append({"path": r.path if r.found else [here], "kind": kind})
            here = pos
        self.sim.say("PLAN", "Fixed script planned once at the start. It will not replan")

    def script_step(self):
        sc = self.script
        while sc["leg"] < len(sc["legs"]) and sc["i"] >= len(sc["legs"][sc["leg"]]["path"]) - 1:
            kind = sc["legs"][sc["leg"]]["kind"]
            if kind == "terminal" and self.code_version != self.sim.lock.version:
                self.solve_lock()
                return
            if kind == "exit":
                self.mode = "stuck at a locked exit"
                self.stats["waits"] += 1
                return
            sc["leg"] += 1
            sc["i"] = 0
        nx, ny = sc["legs"][sc["leg"]]["path"][sc["i"] + 1]
        if not self.w.is_free(nx, ny):
            self.mode = "blocked: the script has no alternative"
            self.stats["waits"] += 1
            return
        self.move_to(nx, ny)
        sc["i"] += 1
        self.mode = "following the fixed script"
