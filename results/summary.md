# Benchmark results

Generated 2026-11-19T06:57:09.026Z · 100 seeded facilities (seeds 5000–5099) · 31×21 grid · max 900 ticks

## Mission experiment: Static facility

| Configuration | Success | Ticks (successes) | Path cost (successes) | States explored | Replans | Drone hits | Laser zaps | Final integrity | Plan time ms |
|---|---|---|---|---|---|---|---|---|---|
| UNIT-7 full: A* + fuzzy + space-time + BT | **100%** | 129 ± 24 | 128 ± 25 | 309 ± 119 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.2 |
| A* + fuzzy, snapshot planning | **100%** | 129 ± 24 | 128 ± 25 | 309 ± 119 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.1 |
| A* + crisp avoidance (no fuzzy) | **100%** | 129 ± 24 | 128 ± 25 | 309 ± 119 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.1 |
| Dijkstra + fuzzy + space-time | **100%** | 129 ± 24 | 128 ± 25 | 884 ± 169 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.2 |
| Greedy best-first + fuzzy + space-time | **100%** | 143 ± 29 | 143 ± 30 | 192 ± 58 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.1 |
| BFS + fuzzy + space-time | **100%** | 129 ± 24 | 129 ± 25 | 883 ± 166 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.2 |
| Fixed script (plans once, never adapts) | **100%** | 129 ± 24 | 128 ± 25 | 309 ± 119 | 0.0 ± 0.0 | 0.00 | 0.00 | 99 | 0.1 |

## Mission experiment: Dynamic facility

| Configuration | Success | Ticks (successes) | Path cost (successes) | States explored | Replans | Drone hits | Laser zaps | Final integrity | Plan time ms |
|---|---|---|---|---|---|---|---|---|---|
| UNIT-7 full: A* + fuzzy + space-time + BT | **100%** | 195 ± 72 | 198 ± 74 | 14671 ± 13612 | 7.6 ± 6.2 | 0.08 | 0.01 | 93 | 4.5 |
| A* + fuzzy, snapshot planning | **91%** | 227 ± 115 | 227 ± 108 | 6766 ± 14451 | 17.8 ± 23.1 | 0.16 | 0.36 | 85 | 3.2 |
| A* + crisp avoidance (no fuzzy) | **100%** | 180 ± 78 | 176 ± 71 | 10817 ± 20140 | 3.5 ± 3.9 | 0.08 | 0.00 | 94 | 5.8 |
| Dijkstra + fuzzy + space-time | **100%** | 197 ± 74 | 199 ± 76 | 23805 ± 17131 | 7.8 ± 6.4 | 0.11 | 0.00 | 93 | 13.7 |
| Greedy best-first + fuzzy + space-time | **95%** | 197 ± 70 | 207 ± 76 | 5714 ± 15860 | 11.2 ± 18.8 | 0.38 | 0.00 | 81 | 3.6 |
| BFS + fuzzy + space-time | **97%** | 177 ± 66 | 188 ± 78 | 24181 ± 53239 | 9.5 ± 17.9 | 0.32 | 0.00 | 82 | 9.6 |
| Fixed script (plans once, never adapts) | **32%** | 122 ± 22 | 123 ± 26 | 309 ± 119 | 0.0 ± 0.0 | 1.70 | 0.19 | 54 | 0.2 |

## Mission experiment: Chaos facility

| Configuration | Success | Ticks (successes) | Path cost (successes) | States explored | Replans | Drone hits | Laser zaps | Final integrity | Plan time ms |
|---|---|---|---|---|---|---|---|---|---|
| UNIT-7 full: A* + fuzzy + space-time + BT | **95%** | 225 ± 99 | 240 ± 109 | 18619 ± 16179 | 10.7 ± 7.8 | 0.24 | 0.00 | 79 | 10.3 |
| A* + fuzzy, snapshot planning | **74%** | 251 ± 140 | 264 ± 154 | 11058 ± 17005 | 28.8 ± 30.8 | 0.38 | 0.38 | 69 | 5.7 |
| A* + crisp avoidance (no fuzzy) | **98%** | 235 ± 112 | 236 ± 104 | 23399 ± 34290 | 6.2 ± 4.6 | 0.16 | 0.07 | 81 | 12.1 |
| Dijkstra + fuzzy + space-time | **97%** | 228 ± 102 | 244 ± 112 | 29337 ± 20032 | 10.7 ± 7.6 | 0.20 | 0.00 | 80 | 17.3 |
| Greedy best-first + fuzzy + space-time | **84%** | 234 ± 93 | 258 ± 114 | 7555 ± 15545 | 14.4 ± 17.1 | 0.66 | 0.00 | 64 | 5.6 |
| BFS + fuzzy + space-time | **83%** | 213 ± 86 | 231 ± 98 | 28355 ± 29723 | 12.2 ± 13.5 | 0.55 | 0.00 | 66 | 12.6 |
| Fixed script (plans once, never adapts) | **11%** | 115 ± 14 | 128 ± 28 | 309 ± 119 | 0.0 ± 0.0 | 2.21 | 0.12 | 42 | 0.5 |

### Why UNIT-7 replanned (Dynamic facility, mean per episode)

| Route blocked by collapse | Laser gate conflict | Threat drift / drone | Deviated (after evasion or zap) |
|---|---|---|---|
| 1.33 | 0.00 | 5.66 | 0.63 |

## Planner micro-benchmark

Same start→goal queries (exit, keycards, terminal) on 40 maps with 40 coolant cells (step cost 6). Optimal = cost equals Dijkstra's.

| Planner | Queries | States explored | Path cost | Optimal | Mean cost gap | Time ms |
|---|---|---|---|---|---|---|
| A* | 200 | 118 ± 87 | 45.5 ± 16.8 | 100% | 0.0% | 0.061 |
| Dijkstra | 200 | 209 ± 98 | 45.5 ± 16.8 | 100% | 0.0% | 0.077 |
| Greedy best-first | 200 | 53 ± 30 | 54.2 ± 23.1 | 36% | 19.0% | 0.034 |
| BFS | 200 | 210 ± 98 | 49.4 ± 19.6 | 48% | 8.0% | 0.066 |
| A* snapshot (gates frozen at t=0) | 200 | 121 ± 88 | 46.6 ± 17.7 | n/a | n/a | 0.062 |
| A* space-time (gate schedule) | 200 | 830 ± 786 | 45.8 ± 17.0 | n/a | n/a | 0.465 |

## CSP solver comparison

100 generated vault locks (5 dials, minimal clue sets, mean 6.2 clues).

| Solver | Assignments | Backtracks | Constraint checks | Time ms | Correct |
|---|---|---|---|---|---|
| Plain backtracking | 1396.7 ± 1916.9 | 1391.7 ± 1916.9 | 3088 ± 4177 | 0.276 | 100% |
| Backtracking + forward checking | 61.8 ± 90.6 | 56.8 ± 90.6 | 1927 ± 2544 | 0.143 | 100% |
| MRV + forward checking | 25.0 ± 41.8 | 20.0 ± 41.8 | 1253 ± 1978 | 0.093 | 100% |
| MRV + FC + AC-3 | 8.4 ± 5.5 | 3.5 ± 5.5 | 896 ± 360 | 0.185 | 100% |

## Learning vs planning (Q-learning lab)

17×11 facility, 2 keycards. Policy trained for 2500 episodes, then a collapse is dropped on the learned route.

| Seed | Episodes to first greedy success | Learned steps | A* optimal steps | Policy after collapse | A* after collapse | Episodes to recover |
|---|---|---|---|---|---|---|
| 1 | 150 | 36 | 34 | fails (walks into a wall) | 36 (replanned instantly) | 50 |
| 2 | 150 | 49 | 45 | fails (walks into a wall) | 45 (replanned instantly) | 250 |
| 3 | 100 | 38 | 38 | fails (walks into a wall) | 42 (replanned instantly) | 150 |
| 4 | 50 | 34 | 34 | fails (walks into a wall) | 48 (replanned instantly) | 250 |
| 5 | 100 | 36 | 36 | fails (walks into a wall) | 36 (replanned instantly) | 50 |
| 6 | 100 | 38 | 38 | fails (walks into a wall) | 38 (replanned instantly) | 100 |
| 7 | 100 | 35 | 35 | fails (walks into a wall) | 39 (replanned instantly) | 150 |
| 8 | 100 | 48 | 48 | fails (walks into a wall) | 50 (replanned instantly) | 100 |

