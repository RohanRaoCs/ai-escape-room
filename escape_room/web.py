"""Bridge between the website and the Python simulation.

On the website the Python code runs in the browser through Pyodide (Python compiled to
WebAssembly). The page calls these functions and receives the current state as JSON.
"""
import json

from .sim import Simulation
from .view import lock_view, route_view, tree_view

_sim = None


def new_sim(config_json):
    """Start a new simulation. config: seed, algo, csp, adaptive, dynamic."""
    global _sim
    _sim = Simulation(verbose=True, **json.loads(config_json))
    return snapshot()


def step(n=1):
    for _ in range(int(n)):
        if _sim.done:
            break
        _sim.step()
    return snapshot()


def collapse():
    if not _sim.done:
        _sim.collapse(by_user=True)
    return snapshot()


def surge():
    if not _sim.done:
        _sim.surge(by_user=True)
    return snapshot()


def click(x, y):
    if not _sim.done:
        _sim.toggle_rubble(int(x), int(y))
    return snapshot()


def snapshot():
    s, w, a = _sim, _sim.world, _sim.agent
    searched = a.last_search[0] if a.last_search and s.t - a.last_search[1] < 15 else []
    state = dict(
        t=s.t, done=s.done, result=s.result, W=w.W, H=w.H,
        tiles=w.tiles, hazard=w.hazard, searched=searched,
        agent=dict(x=a.x, y=a.y, px=a.px, py=a.py, hull=max(0, a.integrity), mode=a.mode, adaptive=a.adaptive),
        drone=dict(x=s.drone.x, y=s.drone.y, px=s.drone.px, py=s.drone.py, state=s.drone.state) if s.drone else None,
        keys=[dict(x=k.x, y=k.y, name=k.name, color=k.color, taken=k.taken) for k in w.keys],
        terminal=w.terminal, exit=w.exit, exit_open=a.exit_unlocked(),
        route=route_view(s), tree=tree_view(s), lock=lock_view(s), stats=a.stats,
        logs=s.logs[-80:],
    )
    return json.dumps(state)
