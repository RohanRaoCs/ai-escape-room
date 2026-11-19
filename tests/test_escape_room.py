"""Correctness tests. Run from the project folder:  python -m unittest -v"""
import random
import unittest

from escape_room import bt
from escape_room.csp import CSP_MODES, count_solutions, make_lock, mutate_lock, solve
from escape_room.search import plan
from escape_room.sim import run_episode
from escape_room.world import generate_world


def coolant_world(seed):
    """A map with extra coolant, so the cheapest path is not always the shortest."""
    w, rng = generate_world(seed), random.Random(seed)
    for _ in range(40):
        x, y = rng.randint(1, w.W - 2), rng.randint(1, w.H - 2)
        if w.is_free(x, y):
            w.hazard[w.idx(x, y)] = 1
    return w


def queries(n_maps=20):
    for seed in range(1, n_maps + 1):
        w = coolant_world(seed)
        for goal in [w.exit, w.terminal] + [(k.x, k.y) for k in w.keys]:
            yield w, goal


class SearchTests(unittest.TestCase):
    def test_astar_is_optimal_and_paths_are_valid(self):
        for w, goal in queries():
            a, d = plan(w, w.start, goal, "astar"), plan(w, w.start, goal, "dijkstra")
            self.assertEqual(a.cost, d.cost)
            for (x1, y1), (x2, y2) in zip(a.path, a.path[1:]):
                self.assertEqual(abs(x1 - x2) + abs(y1 - y2), 1)  # one step at a time
                self.assertTrue(w.is_free(x2, y2))  # never through a wall

    def test_astar_explores_no_more_states_than_dijkstra(self):
        for w, goal in queries():
            self.assertLessEqual(plan(w, w.start, goal, "astar").expanded, plan(w, w.start, goal, "dijkstra").expanded)


class CSPTests(unittest.TestCase):
    def test_locks_have_one_solution_and_both_solvers_find_it(self):
        for k in range(20):
            lock = make_lock(random.Random(900 + k))
            self.assertEqual(count_solutions(lock, 3), 1)
            for mode in CSP_MODES:
                self.assertEqual(solve(lock, mode).solution, lock.secret)

    def test_mrv_forward_checking_needs_fewer_assignments(self):
        locks = [make_lock(random.Random(900 + k)) for k in range(20)]
        smart = sum(solve(l, "mrv_fc").assignments for l in locks)
        plain = sum(solve(l, "bt").assignments for l in locks)
        self.assertLess(smart, plain)

    def test_power_surge_gives_a_new_valid_puzzle(self):
        for k in range(20):
            rng = random.Random(900 + k)
            lock = make_lock(rng)
            mutate_lock(lock, rng)
            self.assertEqual(count_solutions(lock, 3), 1)
            self.assertEqual(solve(lock, "mrv_fc").solution, lock.secret)
            self.assertEqual(lock.version, 1)


class BehaviourTreeTests(unittest.TestCase):
    def test_survive_interrupts_and_task_resumes(self):
        log, danger = [], [False]
        tree = bt.selector("root", [
            bt.sequence("survive", [bt.condition("danger", lambda: danger[0]), bt.action("evade", lambda: log.append("evade") or bt.RUNNING)]),
            bt.action("work", lambda: log.append("work") or bt.RUNNING),
        ])
        tree.run(0)
        danger[0] = True
        tree.run(1)
        danger[0] = False
        tree.run(2)
        self.assertEqual(log, ["work", "evade", "work"])


class SimulationTests(unittest.TestCase):
    def test_runs_are_reproducible(self):
        self.assertEqual(run_episode(seed=7), run_episode(seed=7))

    def test_agent_escapes_every_static_map(self):
        self.assertTrue(all(run_episode(seed=s, dynamic=False)["success"] for s in range(1, 16)))

    def test_adaptive_agent_beats_fixed_script_on_dynamic_maps(self):
        seeds = range(1, 16)
        adaptive = sum(run_episode(seed=s)["success"] for s in seeds)
        script = sum(run_episode(seed=s, adaptive=False)["success"] for s in seeds)
        self.assertGreaterEqual(adaptive, 13)
        self.assertGreater(adaptive, script + 5)


if __name__ == "__main__":
    unittest.main()
