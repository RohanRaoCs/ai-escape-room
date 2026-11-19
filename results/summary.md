# Evaluation results

100 generated facilities per row (seeds 5000-5099). Ticks and path cost are averaged over successful runs.

## Static facility

| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |
|---|---|---|---|---|---|---|
| A* + behaviour tree | 100% | 142 | 139 | 379 | 0.0 | 0.00 |
| Dijkstra + behaviour tree | 100% | 142 | 139 | 858 | 0.0 | 0.00 |
| BFS + behaviour tree | 100% | 142 | 140 | 862 | 0.0 | 0.00 |
| Fixed script (no replanning) | 100% | 142 | 139 | 378 | 0.0 | 0.00 |

## Dynamic facility

| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |
|---|---|---|---|---|---|---|
| A* + behaviour tree | 97% | 232 | 218 | 2661 | 5.4 | 0.18 |
| Dijkstra + behaviour tree | 97% | 230 | 215 | 3586 | 5.1 | 0.19 |
| BFS + behaviour tree | 97% | 228 | 219 | 3598 | 5.1 | 0.18 |
| Fixed script (no replanning) | 20% | 133 | 130 | 378 | 0.0 | 1.31 |

## Planner comparison (same queries, uneven step costs)

| Planner | Queries | States explored | Path cost | Optimal |
|---|---|---|---|---|
| A* | 200 | 125 | 48.9 | 100% |
| Dijkstra | 200 | 199 | 48.9 | 100% |
| Breadth-first | 200 | 203 | 52.1 | 55% |

## Lock solver comparison (100 generated locks)

| Solver | Assignments | Backtracks | Correct |
|---|---|---|---|
| Plain backtracking | 1064.2 | 1059.2 | 100% |
| MRV + forward checking | 15.2 | 10.2 | 100% |
