"""World model: a seeded grid facility with walls, rubble, keycards, a terminal, an exit and coolant.

Coolant cells cost more to cross, so "path cost" is different from "number of steps".
"""
import random
from collections import deque
from dataclasses import dataclass

FLOOR, WALL, RUBBLE = 0, 1, 2
DIRS = [(1, 0), (-1, 0), (0, 1), (0, -1)]
HAZARD_COST = 5  # a coolant cell costs 1 + 5
KEY_DEFS = [("ROSE", "#db2777"), ("GOLD", "#ca8a04"), ("GREEN", "#059669")]


@dataclass
class Key:
    id: int
    x: int
    y: int
    name: str
    color: str
    taken: bool = False


class World:
    def __init__(self, width, height):
        self.W, self.H, self.N = width, height, width * height
        self.tiles = [WALL] * self.N
        self.hazard = [0] * self.N
        self.keys = []
        self.start = (1, 1)
        self.exit = None
        self.terminal = None
        self.drone_waypoints = []
        self.version = 0  # increases whenever the map changes

    def idx(self, x, y):
        return y * self.W + x

    def xy(self, i):
        return i % self.W, i // self.W

    def is_free(self, x, y):
        return 0 <= x < self.W and 0 <= y < self.H and self.tiles[y * self.W + x] == FLOOR

    def cell_cost(self, i):
        return 1 + (HAZARD_COST if self.hazard[i] else 0)

    def bfs(self, start, blocked=-1):
        """Distance in steps from cell index `start` to every cell (-1 = unreachable)."""
        dist = [-1] * self.N
        dist[start] = 0
        queue = deque([start])
        while queue:
            c = queue.popleft()
            cx, cy = c % self.W, c // self.W
            for dx, dy in DIRS:
                nx, ny = cx + dx, cy + dy
                if not self.is_free(nx, ny):
                    continue
                n = ny * self.W + nx
                if dist[n] < 0 and n != blocked:
                    dist[n] = dist[c] + 1
                    queue.append(n)
        return dist

    def objectives(self):
        """Cells the agent still needs: untaken keycards, the terminal and the exit."""
        cells = [self.idx(k.x, k.y) for k in self.keys if not k.taken]
        return cells + [self.idx(*self.terminal), self.idx(*self.exit)]

    def objectives_reachable(self, from_cell, blocked_cell):
        dist = self.bfs(from_cell, blocked_cell)
        return all(dist[i] >= 0 for i in self.objectives())

    def is_object_cell(self, i):
        pos = self.xy(i)
        return pos in (self.start, self.exit, self.terminal) or any((k.x, k.y) == pos for k in self.keys)

    def key_at(self, x, y):
        return next((k for k in self.keys if not k.taken and k.x == x and k.y == y), None)

    def set_tile(self, i, value):
        if self.tiles[i] != value:
            self.tiles[i] = value
            self.version += 1


def generate_world(seed, width=31, height=21):
    rng = random.Random(seed)
    w = World(width, height)
    w.seed = seed
    T, idx = w.tiles, w.idx

    # 1. Maze by randomised depth-first carving.
    stack = [(1, 1)]
    T[idx(1, 1)] = FLOOR
    while stack:
        cx, cy = stack[-1]
        options = [(cx + 2 * dx, cy + 2 * dy, dx, dy) for dx, dy in DIRS
                   if 0 < cx + 2 * dx < width - 1 and 0 < cy + 2 * dy < height - 1 and T[idx(cx + 2 * dx, cy + 2 * dy)] == WALL]
        if not options:
            stack.pop()
            continue
        nx, ny, dx, dy = rng.choice(options)
        T[idx(cx + dx, cy + dy)] = FLOOR
        T[idx(nx, ny)] = FLOOR
        stack.append((nx, ny))

    # 2. Remove some walls to create loops, so a blocked route usually has an alternative.
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            if T[idx(x, y)] != WALL:
                continue
            horizontal = T[idx(x - 1, y)] == FLOOR and T[idx(x + 1, y)] == FLOOR
            vertical = T[idx(x, y - 1)] == FLOOR and T[idx(x, y + 1)] == FLOOR
            if horizontal != vertical and rng.random() < 0.16:
                T[idx(x, y)] = FLOOR

    # 3. Objects: exit at the farthest reachable cell; keycards and terminal spread far apart.
    start = idx(1, 1)
    dist = w.bfs(start)
    far = max(range(w.N), key=lambda i: dist[i])
    w.exit = w.xy(far)
    candidates = [i for i in range(w.N) if dist[i] >= dist[far] / 4 and i != far]

    def manhattan(a, b):
        return abs(a % width - b % width) + abs(a // width - b // width)

    anchors = [start, far]

    def pick_spread():
        ranked = sorted(candidates, key=lambda c: -min(manhattan(a, c) for a in anchors))[:5]
        cell = rng.choice(ranked)
        candidates.remove(cell)
        anchors.append(cell)
        return cell

    for k, (name, color) in enumerate(KEY_DEFS):
        x, y = w.xy(pick_spread())
        w.keys.append(Key(k, x, y, name, color))
    w.terminal = w.xy(pick_spread())

    # 4. Coolant leak source and drone patrol waypoints, away from the start.
    far_cells = [i for i in candidates if dist[i] >= 8]
    rng.shuffle(far_cells)
    if far_cells:
        w.hazard[far_cells[0]] = 1
    w.drone_waypoints = [w.xy(i) for i in far_cells[1:5]]
    return w
