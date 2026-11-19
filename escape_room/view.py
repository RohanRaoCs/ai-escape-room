"""What the panels show, shared by the desktop demo (main.py) and the website (web.py)."""

GLYPH = {"selector": "?", "sequence": "→", "condition": "◇", "action": "▸"}


def tree_view(sim):
    """Behaviour tree rows: (name, kind glyph, depth, status) where status is the result of
    the last tick ("running" / "success" / "failure") or None if the node was not reached."""
    tree = sim.agent.tree
    if tree is None:
        return None
    return [dict(name=n.name, glyph=GLYPH[n.kind], depth=d, status=n.status if n.stamp == sim.t - 1 else None)
            for n, d in tree.walk()]


def lock_view(sim):
    """Dials, clues and a one-line explanation of the lock puzzle's current state."""
    a, lock = sim.agent, sim.lock
    dials, state = [None] * 5, "idle"
    if a.hack and a.hack["result"].trace:
        # Replay the solver's search in step with the dialling progress.
        trace = a.hack["result"].trace
        for dial, value in trace[:int(a.hack["progress"] / a.hack["need"] * len(trace))]:
            dials[dial] = None if value < 0 else value
        state = "solving"
        r = a.hack["result"]
        info = f"Solving: {r.assignments} assignments, {r.backtracks} backtracks."
    elif a.code_version == lock.version:
        dials, state = list(a.code), "solved"
        info = f"Cracked with {a.last_hack['result'].assignments} assignments."
    elif a.code_version >= 0:
        info = "The clues changed, so the old code no longer works. The agent must solve it again."
    else:
        info = "The agent solves this once it holds all three keycards."
    fresh = sim.last_surge[1] if sim.last_surge and sim.t - sim.last_surge[0] < 60 else []
    clues = [dict(text=c.text, new=c.text in fresh) for c in lock.constraints]
    if fresh:
        info += " New clues are shown in purple."
    return dict(dials=dials, state=state, clues=clues, info=info)


def route_view(sim):
    """The route the agent intends to follow, as a list of (x, y)."""
    a = sim.agent
    if a.adaptive:
        return a.plan["path"][a.plan["idx"]:] if a.plan else []
    return a.path_ahead(0, 999)
