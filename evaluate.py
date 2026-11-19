"""Run the evaluation and write results/summary.md and results/missions.csv.

Usage:  python evaluate.py            (100 maps per agent, a few minutes)
        python evaluate.py --maps 20  (quicker)
"""
import argparse
import csv
import os
import time

from escape_room.csp import CSP_MODES
from escape_room.evaluation import csp_compare, missions, planner_compare
from escape_room.search import ALGOS


def fmt(x, digits=0):
    return "-" if x != x else f"{x:,.{digits}f}"  # x != x is True only for NaN


def main():
    parser = argparse.ArgumentParser(description="Evaluate the escape-room agents.")
    parser.add_argument("--maps", type=int, default=100, help="maps per agent (default 100)")
    args = parser.parse_args()
    seeds = list(range(5000, 5000 + args.maps))
    os.makedirs("results", exist_ok=True)
    started = time.time()

    md = [f"# Evaluation results\n\n{args.maps} generated maps per agent (seeds {seeds[0]}-{seeds[-1]}). "
          "Completion time and path cost are averaged over successful runs.\n"]
    all_rows = []
    for dynamic in (False, True):
        print(f"Running {'dynamic' if dynamic else 'static'} missions...", flush=True)
        rows, summaries = missions(seeds, dynamic)
        all_rows += rows
        md.append(f"\n## {'Dynamic' if dynamic else 'Static'} facility\n\n"
                  "| Agent | Success rate | Completion time (ticks) | Path cost | States explored | Replans | Drone hits |\n"
                  "|---|---|---|---|---|---|---|\n")
        for label, s in summaries:
            md.append(f"| {label} | {fmt(s['success'] * 100)}% | {fmt(s['ticks'])} | {fmt(s['path_cost'])} | "
                      f"{fmt(s['expanded'])} | {fmt(s['replans'], 1)} | {fmt(s['hits'], 2)} |\n")

    print("Comparing planners and lock solvers...", flush=True)
    planners = planner_compare(seeds[:40])
    md.append("\n## Planner comparison (same queries, uneven step costs)\n\n| Planner | Queries | States explored | Path cost | Optimal |\n|---|---|---|---|---|\n")
    for algo, s in planners.items():
        md.append(f"| {ALGOS[algo]} | {s['queries']} | {fmt(s['expanded'])} | {fmt(s['cost'], 1)} | {fmt(s['optimal'] * 100)}% |\n")

    solvers = csp_compare(100)
    md.append("\n## Lock solver comparison (100 generated locks)\n\n| Solver | Assignments | Backtracks | Correct |\n|---|---|---|---|\n")
    for mode, s in solvers.items():
        md.append(f"| {CSP_MODES[mode]} | {fmt(s['assignments'], 1)} | {fmt(s['backtracks'], 1)} | {fmt(s['correct'] * 100)}% |\n")

    with open("results/summary.md", "w", encoding="utf-8") as f:
        f.write("".join(md))
    with open("results/missions.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(all_rows[0].keys()))
        writer.writeheader()
        writer.writerows(all_rows)
    print("".join(md))
    print(f"Wrote results/summary.md and results/missions.csv in {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
