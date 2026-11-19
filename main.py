"""UNIT-7 Escape Protocol: interactive demo (Tkinter, part of the Python standard library).

Run:  python main.py

The window shows the facility, the agent's behaviour tree, the lock puzzle and a log.
Click any floor cell to drop rubble and watch the agent replan.
"""
import random
import tkinter as tk
from tkinter import ttk

from escape_room.csp import CSP_MODES
from escape_room.search import ALGOS
from escape_room.sim import MAX_TICKS, Simulation
from escape_room.world import FLOOR, RUBBLE, WALL

CELL = 24
COLORS = dict(floor="#ffffff", grid="#eef0f3", wall="#2f3b48", rubble="#b08559", coolant="#a7ece2",
              searched="#dbe7fd", agent="#2563eb", patrol="#ea580c", chase="#dc2626", cooldown="#9ca3af",
              terminal="#7c3aed", exit_open="#15803d", exit_locked="#dc2626", route="#2563eb", script_route="#6b7280")
TEAM = ["Rohan", "Ibraam", "Vidhi", "Ziya", "Yousef"]
STUDENT_IDS = ["ID to be added"] * 5  # replace with the real student IDs


class App:
    def __init__(self, root):
        self.root = root
        root.title("UNIT-7 Escape Protocol · CSCI218 Group 2")
        root.configure(bg="#f3f4f6")
        self.running = False
        self.sim = None
        self.cells = []
        style = ttk.Style()
        style.configure("TFrame", background="#f3f4f6")
        style.configure("TLabel", background="#f3f4f6")
        style.configure("Card.TFrame", background="#ffffff")
        style.configure("Card.TLabel", background="#ffffff")

        self.build_header()
        body = ttk.Frame(root, padding=(12, 0, 12, 12))
        body.pack(fill="both", expand=True)
        left = ttk.Frame(body)
        left.pack(side="left", fill="y")
        right = ttk.Frame(body, width=380)
        right.pack(side="left", fill="both", expand=True, padx=(12, 0))
        self.build_toolbar(left)
        self.canvas = tk.Canvas(left, width=31 * CELL, height=21 * CELL, bg="white", highlightthickness=1, highlightbackground="#dde1e6")
        self.canvas.pack()
        self.canvas.bind("<Button-1>", self.on_click)
        ttk.Label(left, text="Blue: agent · Orange/red/grey: drone (patrol/chase/cooldown) · Pink, gold, green: keycards · "
                             "Purple: terminal · Square: exit (red = locked) · Teal: coolant · Brown: rubble · "
                             "Light blue: cells the last search explored", wraplength=31 * CELL, foreground="#4b5563").pack(anchor="w", pady=(6, 0))
        self.build_options(left)
        self.build_side(right)
        self.new_sim()
        self.loop()

    # ---------- layout ----------
    def build_header(self):
        top = ttk.Frame(self.root, padding=12)
        top.pack(fill="x")
        text = ttk.Frame(top)
        text.pack(side="left", fill="x", expand=True)
        ttk.Label(text, text="UNIT-7 Escape Protocol", font=("Segoe UI", 16, "bold")).pack(anchor="w")
        ttk.Label(text, wraplength=640, foreground="#4b5563", text=(
            "The agent collects three keycards, cracks the lock at the terminal and reaches the exit, while a drone "
            "patrols, ceilings collapse onto its route and the lock's rules change. It plans routes with A* search, "
            "solves the lock as a constraint satisfaction problem and decides what to do with a behaviour tree. "
            "The drone is a finite state machine.")).pack(anchor="w")
        card = ttk.Frame(top, style="Card.TFrame", padding=10, relief="solid", borderwidth=1)
        card.pack(side="right")
        ttk.Label(card, text="CSCI218 Group Project", style="Card.TLabel", font=("Segoe UI", 10, "bold")).grid(row=0, column=0, columnspan=5, sticky="w")
        ttk.Label(card, text="Made for Dr. Abdullah and Dr. Milan by Group 2, Abdullah Wed 10:30–12:30 lab",
                  style="Card.TLabel", foreground="#4b5563").grid(row=1, column=0, columnspan=5, sticky="w", pady=(0, 6))
        for col, (name, sid) in enumerate(zip(TEAM, STUDENT_IDS)):
            ttk.Label(card, text=name, style="Card.TLabel", font=("Segoe UI", 9, "bold")).grid(row=2, column=col, sticky="w", padx=(0, 14))
            ttk.Label(card, text=sid, style="Card.TLabel", foreground="#7b8591").grid(row=3, column=col, sticky="w", padx=(0, 14))

    def build_toolbar(self, parent):
        bar = ttk.Frame(parent)
        bar.pack(fill="x", pady=(0, 8))
        self.run_btn = ttk.Button(bar, text="Run", command=self.toggle_run)
        self.run_btn.pack(side="left")
        ttk.Button(bar, text="Step", command=self.step_once).pack(side="left", padx=4)
        ttk.Button(bar, text="Restart", command=lambda: self.new_sim(run=True)).pack(side="left")
        ttk.Button(bar, text="New map", command=self.new_map).pack(side="left", padx=4)
        ttk.Label(bar, text="  Speed").pack(side="left")
        self.speed = tk.IntVar(value=8)
        ttk.Scale(bar, from_=1, to=40, variable=self.speed, orient="horizontal", length=120).pack(side="left", padx=4)
        ttk.Label(bar, text="  Seed").pack(side="left")
        self.seed = tk.IntVar(value=5007)
        seed_box = ttk.Spinbox(bar, from_=1, to=99999, textvariable=self.seed, width=7, command=lambda: self.new_sim(run=True))
        seed_box.pack(side="left", padx=4)
        seed_box.bind("<Return>", lambda e: self.new_sim(run=True))

    def build_options(self, parent):
        box = ttk.Frame(parent)
        box.pack(fill="x", pady=(8, 0))
        ttk.Label(box, text="Path planner").pack(side="left")
        self.algo = tk.StringVar(value="A*")
        ttk.Combobox(box, textvariable=self.algo, values=list(ALGOS.values()), state="readonly", width=13).pack(side="left", padx=(4, 12))
        ttk.Label(box, text="Lock solver").pack(side="left")
        self.csp = tk.StringVar(value=CSP_MODES["mrv_fc"])
        ttk.Combobox(box, textvariable=self.csp, values=list(CSP_MODES.values()), state="readonly", width=22).pack(side="left", padx=(4, 12))
        self.adaptive = tk.BooleanVar(value=True)
        ttk.Checkbutton(box, text="Replanning (off = fixed script)", variable=self.adaptive, command=lambda: self.new_sim(run=True)).pack(side="left")
        self.dynamic = tk.BooleanVar(value=True)
        ttk.Checkbutton(box, text="Dynamic events", variable=self.dynamic, command=lambda: self.new_sim(run=True)).pack(side="left", padx=8)
        for var in (self.algo, self.csp):
            var.trace_add("write", lambda *_: self.new_sim(run=True))
        events = ttk.Frame(parent)
        events.pack(fill="x", pady=(6, 0))
        ttk.Button(events, text="Collapse the route", command=lambda: self.event("collapse")).pack(side="left")
        ttk.Button(events, text="Change the lock", command=lambda: self.event("surge")).pack(side="left", padx=4)
        ttk.Label(events, text="Tip: click a floor cell to drop rubble.", foreground="#7b8591").pack(side="left", padx=8)

    def build_side(self, parent):
        status = ttk.Frame(parent, style="Card.TFrame", padding=10, relief="solid", borderwidth=1)
        status.pack(fill="x")
        self.tick_label = ttk.Label(status, style="Card.TLabel", font=("Segoe UI", 13, "bold"))
        self.tick_label.pack(anchor="w")
        self.mode_label = ttk.Label(status, style="Card.TLabel", foreground="#4b5563", wraplength=340)
        self.mode_label.pack(anchor="w")
        self.hull = ttk.Progressbar(status, maximum=100, length=340)
        self.hull.pack(anchor="w", pady=6)
        self.stats_label = ttk.Label(status, style="Card.TLabel", justify="left", font=("Consolas", 9))
        self.stats_label.pack(anchor="w")

        tabs = ttk.Notebook(parent)
        tabs.pack(fill="both", expand=True, pady=(10, 0))
        self.tree_text = self.text_tab(tabs, "Decisions", "The behaviour tree is checked from the top every tick. "
                                       "Blue = running now, green = succeeded, red = failed this tick.")
        self.lock_text = self.text_tab(tabs, "Lock", "The lock is a CSP: five different digits that satisfy every clue. "
                                       "While cracking, the dials replay the solver's search.")
        self.log_text = self.text_tab(tabs, "Log", "What the agent decided and what happened, newest first.")
        for t in (self.tree_text, self.lock_text):
            t.tag_configure("running", foreground="#2563eb", font=("Consolas", 10, "bold"))
            t.tag_configure("success", foreground="#15803d")
            t.tag_configure("failure", foreground="#be123c")
            t.tag_configure("idle", foreground="#9aa3ae")
            t.tag_configure("dials", font=("Consolas", 20, "bold"), foreground="#2563eb")
            t.tag_configure("solved", font=("Consolas", 20, "bold"), foreground="#15803d")
            t.tag_configure("new", foreground="#7c3aed")

    def text_tab(self, notebook, title, intro):
        frame = ttk.Frame(notebook, padding=8)
        notebook.add(frame, text=title)
        ttk.Label(frame, text=intro, wraplength=340, foreground="#4b5563").pack(anchor="w", pady=(0, 6))
        text = tk.Text(frame, width=46, height=22, font=("Consolas", 10), relief="flat", wrap="word")
        text.pack(fill="both", expand=True)
        return text

    # ---------- simulation control ----------
    def new_sim(self, run=False):
        algo = next(k for k, v in ALGOS.items() if v == self.algo.get())
        csp = next(k for k, v in CSP_MODES.items() if v == self.csp.get())
        try:
            seed = max(1, int(self.seed.get()))
        except (tk.TclError, ValueError):
            seed = 5007
        self.sim = Simulation(seed=seed, algo=algo, csp=csp, adaptive=self.adaptive.get(), dynamic=self.dynamic.get(), verbose=True)
        self.draw_static()
        self.refresh()
        self.set_running(run)

    def new_map(self):
        self.seed.set(random.randint(1, 9999))
        self.new_sim(run=True)

    def set_running(self, value):
        self.running = value and not self.sim.done
        self.run_btn.configure(text="Pause" if self.running else "Run")

    def toggle_run(self):
        self.set_running(not self.running)

    def step_once(self):
        self.set_running(False)
        self.sim.step()
        self.refresh()

    def event(self, kind):
        if not self.sim.done:
            self.sim.collapse(by_user=True) if kind == "collapse" else self.sim.surge(by_user=True)
            self.refresh()

    def on_click(self, e):
        if not self.sim.done:
            self.sim.toggle_rubble(e.x // CELL, e.y // CELL)
            self.refresh()

    def loop(self):
        if self.running and not self.sim.done:
            self.sim.step()
            self.refresh()
            if self.sim.done:
                self.set_running(False)
        self.root.after(max(20, 1000 // max(1, int(self.speed.get()))), self.loop)

    # ---------- drawing ----------
    def draw_static(self):
        """Create one rectangle per cell; refresh() only changes their colours."""
        c, w = self.canvas, self.sim.world
        c.delete("all")
        self.cells = [c.create_rectangle(x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL, outline=COLORS["grid"])
                      for y in range(w.H) for x in range(w.W)]

    def refresh(self):
        s, w, a, c = self.sim, self.sim.world, self.sim.agent, self.canvas
        searched = set()
        if a.last_search and s.t - a.last_search[1] < 15:
            searched = set(a.last_search[0])
        for i, rect in enumerate(self.cells):
            tile = w.tiles[i]
            color = COLORS["wall"] if tile == WALL else COLORS["rubble"] if tile == RUBBLE else \
                COLORS["coolant"] if w.hazard[i] else COLORS["searched"] if i in searched else COLORS["floor"]
            c.itemconfigure(rect, fill=color, outline=COLORS["grid"] if tile == FLOOR else color)

        c.delete("dyn")
        def box(x, y, pad, **kw):
            return c.create_rectangle(x * CELL + pad, y * CELL + pad, (x + 1) * CELL - pad, (y + 1) * CELL - pad, tags="dyn", **kw)
        def dot(x, y, r, color):
            cx, cy = x * CELL + CELL / 2, y * CELL + CELL / 2
            c.create_oval(cx - r, cy - r, cx + r, cy + r, fill=color, outline="", tags="dyn")

        box(*w.terminal, 4, fill=COLORS["terminal"], outline="")
        box(*w.exit, 3, outline=COLORS["exit_open"] if a.exit_unlocked() else COLORS["exit_locked"], width=2)
        for k in w.keys:
            if not k.taken:
                box(k.x, k.y, 6, fill=k.color, outline="")
        route = (a.plan["path"][a.plan["idx"]:] if a.plan else []) if a.adaptive else a.path_ahead(0, 999)
        if len(route) > 1:
            pts = [v for x, y in route for v in (x * CELL + CELL / 2, y * CELL + CELL / 2)]
            c.create_line(*pts, fill=COLORS["route" if a.adaptive else "script_route"], width=2, dash=(5, 3), tags="dyn")
        if s.drone:
            dot(s.drone.x, s.drone.y, CELL * 0.32, COLORS[s.drone.state.lower()])
        dot(a.x, a.y, CELL * 0.36, COLORS["agent"])
        dot(a.x, a.y, CELL * 0.12, "white")
        if s.done:
            msg = f"Escaped in {s.t} ticks" if s.result["success"] else f"Mission failed ({s.result['reason']})"
            c.create_rectangle(31 * CELL / 2 - 150, 21 * CELL / 2 - 24, 31 * CELL / 2 + 150, 21 * CELL / 2 + 24, fill="white", outline="#dde1e6", tags="dyn")
            c.create_text(31 * CELL / 2, 21 * CELL / 2, text=msg, font=("Segoe UI", 14, "bold"),
                          fill="#15803d" if s.result["success"] else "#dc2626", tags="dyn")
        self.update_side()

    def update_side(self):
        s, a = self.sim, self.sim.agent
        st = a.stats
        self.tick_label.configure(text=f"Tick {s.t} / {MAX_TICKS}")
        drone = f" · drone: {s.drone.state.lower()}" if s.drone else ""
        self.mode_label.configure(text=("Escaped" if s.result["success"] else "Failed: " + s.result["reason"]) if s.done else a.mode + drone)
        self.hull["value"] = max(0, a.integrity)
        keys = " ".join(("■" if k.taken else "□") + k.name for k in s.world.keys)
        self.stats_label.configure(text=(
            f"Keycards     {keys}\nHull         {max(0, a.integrity)}%\n"
            f"Path cost    {st['path_cost']:<6} States explored {st['expanded']}\n"
            f"Replans      {st['replans']:<6} Plans made      {st['plan_calls']}\n"
            f"Drone hits   {st['hits']:<6} CSP assignments {st['csp_assignments']}"))

        t = self.tree_text
        t.delete("1.0", "end")
        if a.tree is None:
            t.insert("end", "Replanning is off, so there is no behaviour tree.\nThe agent follows a fixed plan made at tick 0.", "idle")
        else:
            glyph = {"selector": "?", "sequence": "→", "condition": "◇", "action": "▸"}
            for node, depth in a.tree.walk():
                tag = node.status if node.stamp == s.t - 1 and node.status else "idle"
                t.insert("end", "    " * depth + f"{glyph[node.kind]} {node.name}\n", tag)

        t = self.lock_text
        t.delete("1.0", "end")
        dials, tag = ["–"] * 5, "dials"
        if a.hack and a.hack["result"].trace:
            trace = a.hack["result"].trace
            for dial, value in trace[:int(a.hack["progress"] / a.hack["need"] * len(trace))]:
                dials[dial] = "–" if value < 0 else str(value)
            info = f"Solving... ({a.hack['result'].assignments} assignments, {a.hack['result'].backtracks} backtracks)"
        elif a.code_version == s.lock.version:
            dials, tag = [str(v) for v in a.code], "solved"
            info = f"Cracked with {a.last_hack['result'].assignments} assignments."
        elif a.code_version >= 0:
            info = "The clues changed, so the old code no longer works. The agent must solve it again."
        else:
            info = "The agent solves this once it holds all three keycards."
        t.insert("end", "  ".join(dials) + "\n", tag)
        t.insert("end", "  ".join(f"D{i + 1}" for i in range(5)) + "\n\nClues:\n", "idle")
        fresh = s.last_surge[1] if s.last_surge and s.t - s.last_surge[0] < 60 else []
        for con in s.lock.constraints:
            t.insert("end", f"  {con.text}\n", "new" if con.text in fresh else "")
        t.insert("end", "\n" + info + (" New clues are in purple." if fresh else ""))

        t = self.log_text
        t.delete("1.0", "end")
        for tick, cat, msg in reversed(s.logs[-80:]):
            t.insert("end", f"{tick:>4} {cat:<6} {msg}\n")


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
