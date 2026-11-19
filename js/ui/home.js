/* Home page: a small live simulation that loops through a few facilities. */
(function () {
  'use strict';
  const cv = document.getElementById('heroCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const info = document.getElementById('heroInfo');
  const SEEDS = [5007, 5011, 5003, 5020];
  let k = 0, sim = null, last = 0, acc = 0, pause = 0;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function start() {
    sim = new ER.Simulation({ seed: SEEDS[k++ % SEEDS.length], dynamics: 'normal' });
    const w = sim.world, dpr = window.devicePixelRatio || 1, cs = 20;
    cv.width = w.W * cs * dpr; cv.height = w.H * cs * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    const w = sim.world, a = sim.agent, cs = 20;
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const i = y * w.W + x, t = w.tiles[i];
      ctx.fillStyle = t === ER.WALL ? '#2f3b48' : t === ER.RUBBLE ? '#b08559' : '#ffffff';
      ctx.fillRect(x * cs, y * cs, cs, cs);
      if (t === ER.FLOOR) {
        ctx.strokeStyle = '#eef0f3'; ctx.strokeRect(x * cs + 0.5, y * cs + 0.5, cs - 1, cs - 1);
        if (w.hazard[i]) { ctx.fillStyle = 'rgba(20,184,166,0.22)'; ctx.fillRect(x * cs, y * cs, cs, cs); }
        if (sim.drone) { const r = sim.riskAt(i); if (r > 24) { ctx.fillStyle = `rgba(220,38,38,${((r - 24) / 76) * 0.25})`; ctx.fillRect(x * cs, y * cs, cs, cs); } }
      }
    }
    for (const g of w.gates) {
      const on = w.gateOn(g.x, g.y, sim.t);
      ctx.strokeStyle = on ? '#dc2626' : '#c4c9d0'; ctx.lineWidth = on ? 2.5 : 1;
      ctx.beginPath();
      if (w.gateOrientation(g) === 'v') { ctx.moveTo(g.x * cs + cs / 2, g.y * cs + 2); ctx.lineTo(g.x * cs + cs / 2, g.y * cs + cs - 2); }
      else { ctx.moveTo(g.x * cs + 2, g.y * cs + cs / 2); ctx.lineTo(g.x * cs + cs - 2, g.y * cs + cs / 2); }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    if (w.terminal) { ctx.fillStyle = '#7c3aed'; ctx.fillRect(w.terminal.x * cs + 4, w.terminal.y * cs + 4, cs - 8, cs - 9); }
    ctx.strokeStyle = a.exitUnlocked() ? '#15803d' : '#dc2626'; ctx.lineWidth = 2;
    ctx.strokeRect(w.exit.x * cs + 3, w.exit.y * cs + 3, cs - 6, cs - 6); ctx.lineWidth = 1;
    for (const key of w.keys) if (!key.taken) { ctx.fillStyle = key.color; ctx.fillRect(key.x * cs + 4, key.y * cs + 6, cs - 8, cs - 12); }
    if (a.plan) {
      ctx.strokeStyle = '#2563eb'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.beginPath();
      a.plan.path.slice(a.plan.idx).forEach((p, j) => { const X = p.x * cs + cs / 2, Y = p.y * cs + cs / 2; if (j) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); });
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    if (sim.drone) { ctx.fillStyle = '#ea580c'; ctx.beginPath(); ctx.arc(sim.drone.x * cs + cs / 2, sim.drone.y * cs + cs / 2, cs * 0.3, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(a.x * cs + cs / 2, a.y * cs + cs / 2, cs * 0.34, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(a.x * cs + cs / 2, a.y * cs + cs / 2, cs * 0.12, 0, 7); ctx.fill();
    const status = sim.done ? (sim.result.success ? 'escaped' : 'failed') : a.mode;
    info.innerHTML = `seed ${sim.cfg.seed} · tick <b>${sim.t}</b> · ${status}`;
  }

  function frame(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    if (sim.done) { pause += dt; if (pause > 2.5) { pause = 0; start(); } }
    else { acc += dt * 12; while (acc >= 1 && !sim.done) { sim.step(); acc -= 1; } }
    draw();
    if (!reduced) requestAnimationFrame(frame);
  }
  start();
  if (reduced) { for (let i = 0; i < 60; i++) sim.step(); draw(); }
  else requestAnimationFrame(frame);
})();
