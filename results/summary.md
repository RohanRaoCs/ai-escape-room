# Evaluation results

100 generated maps per agent (seeds 5000-5099). Completion time and path cost are averaged over successful runs.

## Static facility

| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |
|---|---|---|---|---|---|---|
| A* + behaviour tree | 100% | 142 | 139 | 396 | 0.0 | 0.00 |
| Dijkstra + behaviour tree | 100% | 142 | 139 | 860 | 0.0 | 0.00 |
| BFS + behaviour tree | 100% | 142 | 140 | 861 | 0.0 | 0.00 |
| Fixed script (no replanning) | 100% | 142 | 139 | 395 | 0.0 | 0.00 |

## Dynamic facility

| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |
|---|---|---|---|---|---|---|
| A* + behaviour tree | 99% | 223 | 214 | 2,078 | 5.0 | 0.08 |
| Dijkstra + behaviour tree | 99% | 224 | 215 | 2,953 | 4.8 | 0.09 |
| BFS + behaviour tree | 99% | 226 | 218 | 3,039 | 4.9 | 0.07 |
| Fixed script (no replanning) | 13% | 128 | 125 | 395 | 0.0 | 1.16 |

## Planner comparison (same queries, uneven step costs)

| Planner | Queries | States explored | Path cost | Optimal |
|---|---|---|---|---|
| A* | 200 | 129 | 49.9 | 100% |
| Dijkstra | 200 | 202 | 49.9 | 100% |
| Breadth-first | 200 | 204 | 53.6 | 42% |

## Lock solver comparison (100 generated locks)

| Solver | Assignments | Backtracks | Correct |
|---|---|---|---|
| Plain backtracking | 2,342.6 | 2,337.6 | 100% |
| MRV + forward checking | 13.2 | 8.2 | 100% |
