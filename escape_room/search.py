"""Path planning: A*, Dijkstra and breadth-first search behind one function.

- A*       : priority = g + h, with h = Manhattan distance (admissible, since every step costs >= 1)
- Dijkstra : priority = g (uniform-cost search, no heuristic)
- BFS      : first-in first-out queue; ignores step costs (fewest steps, not cheapest path)
"""
import heapq
import math
import time
from collections import deque
from dataclasses import dataclass, field

from .world import DIRS

ALGOS = {"astar": "A*", "dijkstra": "Dijkstra", "bfs": "Breadth-first"}


@dataclass
class PlanResult:
    found: bool
    path: list = field(default_factory=list)  # list of (x, y), start first
    cost: float = math.inf
    expanded: int = 0  # states taken off the frontier and expanded
    order: list = field(default_factory=list)  # cells in the order they were expanded
    ms: float = 0.0


def plan(world, start, goal, algo="astar", cost_fn=None):
    """Plan from start (x, y) to goal (x, y). cost_fn(cell) gives the cost of entering a cell;
    returning math.inf means "never enter this cell"."""
    t0 = time.perf_counter()
    cost_fn = cost_fn or world.cell_cost
    W = world.W
    s, g_cell = world.idx(*start), world.idx(*goal)
    gx, gy = goal

    def h(c):
        return abs(c % W - gx) + abs(c // W - gy)

    g = {s: 0}
    parent = {s: None}
    closed = set()
    order = []
    frontier = deque([s]) if algo == "bfs" else [(h(s) if algo == "astar" else 0, 0, s)]
    tie = 0  # tie-breaker so the heap never compares cells of equal priority

    while frontier:
        c = frontier.popleft() if algo == "bfs" else heapq.heappop(frontier)[2]
        if c in closed:
            continue
        closed.add(c)
        order.append(c)
        if c == g_cell:
            break
        cx, cy = c % W, c // W
        for dx, dy in DIRS:
            nx, ny = cx + dx, cy + dy
            if not world.is_free(nx, ny):
                continue
            n = ny * W + nx
            step = cost_fn(n)
            if n in closed or step == math.inf:
                continue
            new_g = g[c] + step
            if algo == "bfs":
                if n not in g:  # first discovery wins
                    g[n], parent[n] = new_g, c
                    frontier.append(n)
            elif new_g < g.get(n, math.inf):
                g[n], parent[n] = new_g, c
                tie += 1
                heapq.heappush(frontier, (new_g + (h(n) if algo == "astar" else 0), tie, n))

    result = PlanResult(found=g_cell in closed, expanded=len(closed), order=order)
    if result.found:
        c = g_cell
        while c is not None:
            result.path.append(world.xy(c))
            c = parent[c]
        result.path.reverse()
        result.cost = g[g_cell]
    result.ms = (time.perf_counter() - t0) * 1000
    return result
