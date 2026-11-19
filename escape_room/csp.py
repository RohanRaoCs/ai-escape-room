"""Constraint Satisfaction: the vault lock.

Variables  : D1..D5 (lock dials), each with domain {0..9}
Constraints: "all dials differ" plus clues such as "D1 is odd", "D3 > 4", "D2 + D4 = 11",
             "D3 > D5", "|D1 - D2| = 3".
The generator adds true clues until exactly one code fits, then removes every clue it can
without losing uniqueness, so each puzzle is fair and minimal.

Two solvers are compared:
  bt      plain backtracking (assign dials in order, undo on conflict)
  mrv_fc  backtracking + MRV variable ordering + forward checking
A power surge (mutate_lock) changes two dials and their clues while the agent is running.
"""
import time
from dataclasses import dataclass, field

PRIMES = {2, 3, 5, 7}
CSP_MODES = {"bt": "Plain backtracking", "mrv_fc": "MRV + forward checking"}
UNSET = -1


@dataclass
class Constraint:
    vars: tuple
    text: str
    test: callable  # called only when every variable in `vars` is assigned

    def ok(self, a):
        """False only if the assigned values already break this clue."""
        if self.text == "All dials differ":
            values = [v for v in a if v != UNSET]
            return len(values) == len(set(values))
        if any(a[v] == UNSET for v in self.vars):
            return True
        return self.test(*(a[v] for v in self.vars))


def D(i):
    return f"D{i + 1}"


def all_diff(n):
    return Constraint(tuple(range(n)), "All dials differ", None)


def random_clue(rng, s):
    """A random clue that is true for the secret code s, or None."""
    i, j = rng.sample(range(len(s)), 2)
    lo, hi = min(i, j), max(i, j)
    r = rng.random()
    if r < 0.10:
        p = s[i] % 2
        return Constraint((i,), f"{D(i)} is {'odd' if p else 'even'}", lambda x, p=p: x % 2 == p)
    if r < 0.18:
        yes = s[i] in PRIMES
        return Constraint((i,), f"{D(i)} is {'' if yes else 'not '}prime", lambda x, yes=yes: (x in PRIMES) == yes)
    if r < 0.26:
        if s[i] == 0:
            return None
        k = rng.randint(max(0, s[i] - 4), s[i] - 1)
        return Constraint((i,), f"{D(i)} > {k}", lambda x, k=k: x > k)
    if r < 0.34:
        if s[i] == 9:
            return None
        k = rng.randint(s[i] + 1, min(9, s[i] + 4))
        return Constraint((i,), f"{D(i)} < {k}", lambda x, k=k: x < k)
    if r < 0.62:
        k = s[i] + s[j]
        return Constraint((lo, hi), f"{D(lo)} + {D(hi)} = {k}", lambda x, y, k=k: x + y == k)
    if r < 0.82:
        a, b = (i, j) if s[i] > s[j] else (j, i)
        return Constraint((a, b), f"{D(a)} > {D(b)}", lambda x, y: x > y)
    k = abs(s[i] - s[j])
    return Constraint((lo, hi), f"|{D(lo)} - {D(hi)}| = {k}", lambda x, y, k=k: abs(x - y) == k)


def equals(i, v):
    return Constraint((i,), f"{D(i)} = {v}", lambda x, v=v: x == v)


@dataclass
class Lock:
    secret: list
    constraints: list
    n: int = 5
    version: int = 0


@dataclass
class SolveResult:
    solution: list
    solutions: list
    assignments: int = 0
    backtracks: int = 0
    trace: list = field(default_factory=list)  # (dial, value) steps, value -1 = undo; used by the GUI
    ms: float = 0.0


def solve(lock, mode="mrv_fc", limit=1, trace=False):
    t0 = time.perf_counter()
    smart = mode == "mrv_fc"
    n = lock.n
    by_var = [[c for c in lock.constraints if v in c.vars] for v in range(n)]
    a = [UNSET] * n
    res = SolveResult(None, [])
    state = {"domains": [list(range(10)) for _ in range(n)]}

    def consistent(v):
        return all(c.ok(a) for c in by_var[v])

    def select_var():
        unassigned = [v for v in range(n) if a[v] == UNSET]
        if not unassigned:
            return None
        if not smart:
            return unassigned[0]  # next dial in order
        return min(unassigned, key=lambda v: len(state["domains"][v]))  # MRV

    def forward_check():
        """Remove values from unassigned dials that would now break a clue."""
        domains = state["domains"]
        for u in range(n):
            if a[u] != UNSET:
                continue
            keep = []
            for x in domains[u]:
                a[u] = x
                if consistent(u):
                    keep.append(x)
            a[u] = UNSET
            domains[u] = keep
            if not keep:
                return False
        return True

    def backtrack():
        v = select_var()
        if v is None:
            res.solutions.append(a.copy())
            return len(res.solutions) >= limit
        for val in list(state["domains"][v]):
            a[v] = val
            res.assignments += 1
            if trace:
                res.trace.append((v, val))
            if consistent(v):
                saved = state["domains"]
                if smart:
                    state["domains"] = [d.copy() for d in saved]
                if (not smart or forward_check()) and backtrack():
                    return True
                state["domains"] = saved
            a[v] = UNSET
            res.backtracks += 1
            if trace:
                res.trace.append((v, UNSET))
        return False

    backtrack()
    res.solution = res.solutions[0] if res.solutions else None
    res.ms = (time.perf_counter() - t0) * 1000
    return res


def count_solutions(lock, limit=2):
    return len(solve(lock, "mrv_fc", limit=limit).solutions)


def make_unique(lock, rng):
    texts = {c.text for c in lock.constraints}
    for _ in range(80):
        if count_solutions(lock) == 1:
            break
        c = random_clue(rng, lock.secret)
        if c and c.text not in texts:
            texts.add(c.text)
            lock.constraints.append(c)
    i = 0
    while count_solutions(lock) != 1:
        lock.constraints.append(equals(i, lock.secret[i]))
        i += 1
    # Drop every clue (except "all differ") that is not needed for a unique answer.
    for k in range(len(lock.constraints) - 1, 0, -1):
        c = lock.constraints.pop(k)
        if count_solutions(lock) != 1:
            lock.constraints.insert(k, c)


def make_lock(rng):
    secret = rng.sample(range(10), 5)
    lock = Lock(secret, [all_diff(5)])
    make_unique(lock, rng)
    return lock


def mutate_lock(lock, rng):
    """Power surge: rewire two dials, drop clues that no longer hold, add new ones."""
    s = lock.secret.copy()
    positions = rng.sample(range(5), 2)
    unused = rng.sample([d for d in range(10) if d not in s], 2)
    for p, d in zip(positions, unused):
        s[p] = d
    before = [c.text for c in lock.constraints]
    lock.secret = s
    lock.constraints = [c for c in lock.constraints if c.ok(s)]
    removed = [t for t in before if t not in {c.text for c in lock.constraints}]
    make_unique(lock, rng)
    added = [c.text for c in lock.constraints if c.text not in before]
    lock.version += 1
    return {"changed_dials": [p + 1 for p in positions], "removed": removed, "added": added}
