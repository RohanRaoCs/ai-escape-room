"""Evaluation using the measures from the brief: success rate, completion time (ticks),
path cost and states explored."""
import random
from statistics import mean

from .csp import CSP_MODES, make_lock, solve
from .search import ALGOS, plan
from .sim import run_episode
from .world import generate_world

AGENTS = [
    ("A* + behaviour tree", dict(algo="astar", adaptive=True)),
    ("Dijkstra + behaviour tree", dict(algo="dijkstra", adaptive=True)),
    ("BFS + behaviour tree", dict(algo="bfs", adaptive=True)),
    ("Fixed script (no replanning)", dict(algo="astar", adaptive=False)),
]


def avg(values):
    return mean(values) if values else float("nan")


def summarize(rows):
    """Ticks and path cost are averaged over successful runs only."""
    ok = [r for r in rows if r["success"]]
    return dict(
        success=avg([r["success"] for r in rows]),
        ticks=avg([r["ticks"] for r in ok]),
        path_cost=avg([r["path_cost"] for r in ok]),
        expanded=avg([r["expanded"] for r in rows]),
        replans=avg([r["replans"] for r in rows]),
        hits=avg([r["hits"] for r in rows]),
    )


def missions(seeds, dynamic):
    """Run every agent on every seed. Returns (per-run rows, per-agent summaries)."""
    rows, summaries = [], []
    for label, cfg in AGENTS:
        runs = [run_episode(seed=s, dynamic=dynamic, **cfg) for s in seeds]
        rows += [dict(agent=label, dynamic=int(dynamic), **r) for r in runs]
        summaries.append((label, summarize(runs)))
    return rows, summaries


def planner_compare(seeds):
    """Same start -> goal queries for every planner, on maps with extra coolant (uneven costs)."""
    stats = {a: dict(expanded=[], cost=[], optimal=[]) for a in ALGOS}
    for seed in seeds:
        w = generate_world(seed)
        rng = random.Random(seed + 555)
        for _ in range(40):
            x, y = rng.randint(1, w.W - 2), rng.randint(1, w.H - 2)
            if w.is_free(x, y) and not w.is_object_cell(w.idx(x, y)):
                w.hazard[w.idx(x, y)] = 1
        for goal in [w.exit, w.terminal] + [(k.x, k.y) for k in w.keys]:
            best = plan(w, w.start, goal, "dijkstra").cost
            for algo in ALGOS:
                r = plan(w, w.start, goal, algo)
                stats[algo]["expanded"].append(r.expanded)
                stats[algo]["cost"].append(r.cost)
                stats[algo]["optimal"].append(int(r.cost == best))
    return {a: dict(queries=len(s["cost"]), expanded=avg(s["expanded"]), cost=avg(s["cost"]), optimal=avg(s["optimal"])) for a, s in stats.items()}


def csp_compare(n_locks):
    """Both lock solvers on the same generated locks."""
    stats = {m: dict(assignments=[], backtracks=[], correct=[]) for m in CSP_MODES}
    for k in range(n_locks):
        lock = make_lock(random.Random(7000 + k))
        for mode in CSP_MODES:
            r = solve(lock, mode)
            stats[mode]["assignments"].append(r.assignments)
            stats[mode]["backtracks"].append(r.backtracks)
            stats[mode]["correct"].append(int(r.solution == lock.secret))
    return {m: dict(locks=n_locks, assignments=avg(s["assignments"]), backtracks=avg(s["backtracks"]), correct=avg(s["correct"])) for m, s in stats.items()}
