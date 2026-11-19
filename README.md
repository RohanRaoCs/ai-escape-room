# UNIT-7 Escape Protocol

**CSCI218 Group Project (Topic 10: AI Escape Room).** Made for Dr. Abdullah and Dr. Milan by Group 2, Abdullah Wed 10:30–12:30 lab.

| Member | Student ID |
|---|---|
| Rohan | to be added |
| Ibraam | to be added |
| Vidhi | to be added |
| Ziya | to be added |
| Yousef | to be added |

An AI agent escapes a grid facility. It collects three keycards, solves a lock puzzle at a terminal, and reaches the exit, while a drone patrols, ceilings collapse onto its route and the lock's rules change mid-run.

- **A\* search** plans the routes and replans when the route is blocked.
- **Constraint satisfaction** solves the lock (backtracking with MRV and forward checking).
- **A behaviour tree** decides what to do each tick.
- **A finite state machine** controls the drone.

**Live demo: https://ai-escape-room-self.vercel.app** (the same Python code, running in the browser through Pyodide)

![Screenshot](docs/screenshot.png)

## Requirements

Python 3.9 or later. Only the standard library is used (Tkinter for the window), so there is nothing to install.

## Run it

Run these from the project folder:

```bash
python main.py              # interactive demo window (desktop)
python -m http.server       # or: the web version at http://localhost:8000
python -m unittest -v       # 9 correctness tests
python evaluate.py          # evaluation on 100 maps per agent -> results/summary.md, results/missions.csv
python evaluate.py --maps 20   # quicker evaluation
```

**In the demo window:**

- **Run / Step / Restart / New map** control the simulation.
- **Path planner** switches between A*, Dijkstra and breadth-first search.
- **Lock solver** switches between plain backtracking and MRV + forward checking.
- Untick **Replanning** to see the fixed-script baseline, which plans once and never adapts.
- **Collapse the route** and **Change the lock** trigger dynamic events. Clicking a floor cell drops rubble.
- The **Decisions**, **Lock** and **Log** tabs show the behaviour tree, the CSP and every decision as it happens.

## Results

100 maps per agent, dynamic events on (from `python evaluate.py`):

| Agent | Success rate | Ticks | Path cost | States explored |
|---|---|---|---|---|
| A* + behaviour tree | 99% | 223 | 214 | 2,078 |
| Dijkstra + behaviour tree | 99% | 224 | 215 | 2,953 |
| BFS + behaviour tree | 99% | 226 | 218 | 3,039 |
| Fixed script (no replanning) | 13% | 128 | 125 | 395 |

The design, implementation and full results are in [REPORT.md](REPORT.md).

## Files

```
main.py                  desktop demo window (Tkinter)
index.html, web/         web demo: loads escape_room/ into the browser with Pyodide
evaluate.py              evaluation script
escape_room/
  world.py               map generation (seeded), tiles, keycards, coolant
  search.py              A*, Dijkstra, breadth-first search
  csp.py                 lock puzzle: generation, two solvers, power-surge changes
  bt.py                  behaviour tree nodes
  agent.py               the agent: behaviour tree, navigation, replanning, lock solving, fixed-script baseline
  drone.py               drone finite state machine
  sim.py                 simulation loop and dynamic events
  evaluation.py          evaluation helpers
  view.py                what the panels show (shared by desktop and web)
  web.py                 bridge between the web page and the simulation
tests/test_escape_room.py
results/                 evaluation output used in the report
```

## Web version and deployment

The website runs the **same Python package** in the browser through [Pyodide](https://pyodide.org), which is Python compiled to WebAssembly. There is no separate JavaScript implementation of the AI: `web/app.js` only draws the state returned by `escape_room/web.py`. The site is static, so Vercel serves it with no build step (`vercel.json`). To deploy your own copy, import the repository at vercel.com/new and press Deploy.
