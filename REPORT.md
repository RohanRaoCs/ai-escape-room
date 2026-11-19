# UNIT-7 Escape Protocol: Design and Implementation Report

**CSCI218 Foundations of Artificial Intelligence, Group Project (Topic 10: AI Escape Room)**
Group 2, Abdullah Wed 10:30–12:30 lab. Submitted to Dr. Abdullah and Dr. Milan.

| Member | Student ID |
|---|---|
| Rohan | to be added |
| Ibraam | to be added |
| Vidhi | to be added |
| Ziya | to be added |
| Yousef | to be added |

## 1. Problem

The task is to build an escape room in which an intelligent agent navigates an environment, overcomes obstacles, solves a challenge and reaches a goal. The environment must change during execution, and the agent must respond rather than follow a fixed sequence of actions. The solution is evaluated with measures such as completion time, path cost, states explored and success rate.

**Our escape room.** The environment is a 31 × 21 grid facility generated from a seed (a maze with some loops). The agent, UNIT-7, starts in the top-left corner and must:

1. collect **three keycards**, in an order it chooses;
2. go to the **terminal** and solve the **vault lock**, a logic puzzle;
3. reach the **exit**, which only opens once the lock is solved.

**What changes during a run** (the "Dynamic events" setting):

| Dynamic element | What happens |
|---|---|
| Moving obstacle | A security drone patrols the facility and chases the agent when it sees it. Contact costs 25% hull and a 2-tick stun. |
| Route becomes unavailable | Three ceiling collapses per run drop rubble 2–12 steps ahead on the agent's **current planned route**. |
| Constraint changes | One power surge per run rewires two lock dials: some clues are removed and new ones added, so a code the agent already found stops working. |
| Changing costs | A coolant leak spreads slowly. Coolant cells cost 6 to cross instead of 1. |

A mission fails if the hull reaches 0% or 600 ticks pass.

![Screenshot](docs/screenshot.png)

## 2. AI techniques

We use three techniques covered in the subject, plus a small finite state machine for the adversary.

### 2.1 A* search for navigation (`js/core/search.js`)

- **States and moves:** each state is a grid cell, and the agent moves up, down, left or right.
- **Step cost:** 1, or 6 on coolant.
- **Heuristic:** the Manhattan distance to the goal. It never overestimates, because every step costs at least 1, so A* always returns a cheapest path.
- **Avoiding the drone:** the drone's cell and the cells next to it are treated as blocked, so routes keep clear of it.
- **Comparison:** the same function also runs Dijkstra (no heuristic) and breadth-first search (ignores costs), so the three can be compared on identical problems.

**Responding to change.** Every tick, the agent checks the rest of its route. It plans a new route when:

- a cell on the route has become rubble;
- the drone has moved onto or next to the route;
- the agent is no longer on the route, for example after evading.

**Keycard order.** The agent tries all 3! = 6 orders, measuring each with breadth-first distances, and picks the shortest tour that ends at the terminal.

### 2.2 Constraint satisfaction for the lock (`js/core/csp.js`)

- **Variables:** five dials, D1 to D5.
- **Domain:** each dial is a digit from 0 to 9.
- **Constraints:** all dials differ, plus clues such as *D1 is odd*, *D3 > 4*, *D2 + D4 = 11*, *D3 > D5* and *|D1 − D2| = 3*.

**Generating the puzzle.** The generator picks a secret code, adds true clues until exactly one code fits, then removes every clue that is not needed. Each puzzle is therefore fair (exactly one answer) and minimal.

**Two solvers:**

- **Plain backtracking:** assign the dials in order and undo when a clue is broken.
- **MRV + forward checking:** always fill the dial with the fewest remaining options, and after each assignment remove values from the other dials that can no longer work.

In the simulation, dialling in the code takes one tick per four solver assignments. A better solver therefore makes the agent escape sooner. When a power surge changes the clues, the solver runs again on the new constraint set.

### 2.3 Behaviour tree for decisions (`js/core/bt.js`, `js/core/agent.js`)

```
? Root (try children in order until one succeeds or is running)
├─ → Survive          ◇ Drone chasing nearby?   ▸ Evade drone
├─ → Escape           ◇ Vault unlocked?         ▸ Go to exit
├─ → Crack the lock   ◇ All keycards held?      ▸ Go to terminal   ▸ Solve lock (CSP)
├─ → Collect keycards ▸ Choose next keycard     ▸ Go to keycard (A*)
└─ ▸ Hold position    (when no route exists right now)
```

The tree is evaluated **from the root every tick**, so higher branches interrupt lower ones:

- When the drone gets close, *Survive* takes over at once, and the agent returns to its task when the danger has passed.
- After a power surge, *Vault unlocked?* becomes false and the tree falls through to *Crack the lock*. No special code is needed for this case.

### 2.4 Finite state machine for the drone (`js/core/drone.js`)

The drone has three states:

- **Patrol** between waypoints at half speed. It switches to Chase when it sees the agent, meaning within 5 cells with a clear line of sight.
- **Chase** at two-thirds speed. It switches to Cooldown after losing sight for 6 ticks, or after 30 ticks (battery).
- **Cooldown** for 12 ticks, during which it cannot detect the agent, then back to Patrol.

## 3. Implementation

- **Language and structure:** JavaScript, with no libraries. The same engine files run in the browser (`index.html`) and in Node.js for the tests and the evaluation.
- **Reproducibility:** all randomness comes from a seeded generator, so a seed reproduces the same map, events and results.

| File | Purpose |
|---|---|
| `js/core/world.js` | Map generation, tiles, keycards, coolant |
| `js/core/search.js` | A*, Dijkstra, BFS |
| `js/core/csp.js` | Lock generation, two CSP solvers, power-surge mutation |
| `js/core/bt.js` | Behaviour tree nodes (selector, sequence, condition, action) |
| `js/core/agent.js` | The agent: behaviour tree, navigation, replanning, lock solving, fixed-script baseline |
| `js/core/drone.js` | Drone finite state machine |
| `js/core/sim.js` | Simulation loop, dynamic events, collisions, win/lose |
| `js/core/bench.js`, `tools/bench.js` | Evaluation |
| `js/core/tests.js`, `tools/test.js` | Correctness tests |
| `index.html`, `js/ui/app.js` | Web page: live simulation, panels, evaluation table |

**Running it**

- Open `index.html` in a browser, or run `npm start` and visit http://localhost:3000.
- `npm test` runs 9 correctness tests.
- `npm run bench` regenerates the results below into `results/`.

## 4. Evaluation

**Method.** Each agent ran 100 missions on the same 100 maps (seeds 5000–5099), once with dynamic events off and once with them on. Completion time and path cost are averaged over successful runs.

The **fixed script** is a baseline. It plans the whole mission once with A* at the start and never replans or evades. This is the "fixed sequence of actions" the brief warns against.

### 4.1 Missions

**Static facility** (nothing changes)

| Agent | Success rate | Completion time (ticks) | Path cost | States explored |
|---|---|---|---|---|
| A* + behaviour tree | 100% | 142 | 139 | 379 |
| Dijkstra + behaviour tree | 100% | 142 | 139 | 858 |
| BFS + behaviour tree | 100% | 142 | 140 | 862 |
| Fixed script | 100% | 142 | 139 | 378 |

**Dynamic facility** (drone, collapses, coolant, lock change)

| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |
|---|---|---|---|---|---|---|
| A* + behaviour tree | **97%** | 232 | 218 | 2,661 | 5.4 | 0.18 |
| Dijkstra + behaviour tree | 97% | 230 | 215 | 3,586 | 5.1 | 0.19 |
| BFS + behaviour tree | 97% | 228 | 219 | 3,598 | 5.1 | 0.18 |
| Fixed script | **20%** | 133 | 130 | 378 | 0 | 1.31 |

### 4.2 Planners on identical queries

These are 200 start-to-goal queries on maps with 40 extra coolant cells, so the cheapest path is not always the shortest one.

| Planner | States explored | Path cost | Optimal |
|---|---|---|---|
| A* | **125** | 48.9 | 100% |
| Dijkstra | 199 | 48.9 | 100% |
| Breadth-first | 203 | 52.1 | 55% |

### 4.3 Lock solvers (100 generated locks)

| Solver | Assignments | Backtracks | Correct |
|---|---|---|---|
| Plain backtracking | 1,064 | 1,059 | 100% |
| MRV + forward checking | **15** | **10** | 100% |

### 4.4 Discussion

- **Adapting is what makes the agent succeed.** With nothing changing, the fixed script does as well as the adaptive agent (100%). With dynamic events it drops to 20%. It timed out in 61 runs, stuck behind rubble or at an exit whose code had changed, and was destroyed in 19 runs by drone hits. The adaptive agent escaped 97 of 100 (2 timeouts, 1 destroyed). The fixed script's short completion time is misleading: it only finishes on the maps where nothing went wrong.
- **A\* is the most efficient planner.** It finds the same optimal paths as Dijkstra while exploring 37% fewer states on identical queries, and 26% fewer over a whole dynamic mission. BFS explores as much as Dijkstra and is optimal on only 55% of queries, because it ignores the extra cost of coolant.
- **Constraint propagation matters.** MRV with forward checking needs about 70 times fewer assignments than plain backtracking. That is the difference between about 4 ticks and about 266 ticks at the terminal.
- **Limitations.** The agent knows the whole map, while a real robot would have to explore. The drone avoidance is a simple rule (never step next to it), which can occasionally leave the agent with no route until the drone moves. A predictive model of the drone could do better.

## 5. Testing

`npm test` checks:

- A* returns optimal, valid paths (150 queries compared against Dijkstra);
- A* explores fewer states than Dijkstra;
- every lock has exactly one solution, and both solvers find it;
- MRV + forward checking needs fewer assignments than plain backtracking;
- every power surge produces a valid new puzzle;
- the behaviour tree interrupts and resumes correctly;
- runs are reproducible from the seed;
- the agent escapes every static map;
- the adaptive agent clearly beats the fixed script on dynamic maps.

All 9 tests pass.

## References

Russell, S. and Norvig, P. (2021) *Artificial Intelligence: A Modern Approach*, 4th edn. Pearson. Chapters 3 (search) and 6 (constraint satisfaction problems).
