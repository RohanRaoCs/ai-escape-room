/* Web page: draws the simulation, updates the side panels, and runs the evaluation. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const COL = {
    floor: '#ffffff', grid: '#eef0f3', wall: '#2f3b48', rubble: '#b08559', coolant: '#14b8a6',
    agent: '#2563eb', drone: '#ea580c', chase: '#dc2626', cooldown: '#9ca3af', terminal: '#7c3aed', ok: '#15803d', alarm: '#dc2626',
  };

  let sim = null, running = false, acc = 0, last = 0, speed = 8, cs = 24;
  const canvas = $('world'), ctx = canvas.getContext('2d');

  /* ---------- simulation setup ---------- */
  function newSim() {
    sim = new ER.Simulation({
      seed: Math.max(1, +$('seed').value || 1), algo: $('cfgAlgo').value, csp: $('cfgCsp').value,
      adaptive: $('cfgAdaptive').checked, dynamic: $('cfgDynamic').checked, verbose: true,
    });
    acc = 0;
    $('banner').hidden = true;
    buildTree();
    resize();
    refresh();
  }
  function setRunning(v) { running = v && !sim.done; $('btnRun').textContent = running ? 'Pause' : 'Run'; }

  function resize() {
    const w = sim.world, avail = canvas.parentElement.clientWidth - 20;
    cs = Math.max(10, Math.min(32, Math.floor(avail / w.W)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w.W * cs * dpr; canvas.height = w.H * cs * dpr;
    canvas.style.width = w.W * cs + 'px'; canvas.style.height = w.H * cs + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => sim && resize());

  /* ---------- drawing ---------- */
  function draw(frac) {
    const w = sim.world, a = sim.agent, now = performance.now();
    const cell = (x, y, color, pad = 0) => { ctx.fillStyle = color; ctx.fillRect(x * cs + pad, y * cs + pad, cs - 2 * pad, cs - 2 * pad); };
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const i = w.idx(x, y), t = w.tiles[i];
      cell(x, y, t === ER.WALL ? COL.wall : t === ER.RUBBLE ? COL.rubble : COL.floor);
      if (t !== ER.FLOOR) continue;
      ctx.strokeStyle = COL.grid; ctx.strokeRect(x * cs + 0.5, y * cs + 0.5, cs - 1, cs - 1);
      if (w.hazard[i]) { ctx.globalAlpha = 0.25; cell(x, y, COL.coolant, 1); ctx.globalAlpha = 1; }
    }
    // Cells searched by the most recent plan (fade out over 15 ticks).
    const ls = a.lastSearch;
    if (ls && sim.t - ls.t < 15) {
      ctx.globalAlpha = 0.2 * (1 - (sim.t - ls.t) / 15);
      for (const c of ls.order) cell(c % w.W, (c / w.W) | 0, '#3b82f6', cs * 0.22);
      ctx.globalAlpha = 1;
    }
    // Terminal, exit, keycards.
    cell(w.terminal.x, w.terminal.y, COL.terminal, cs * 0.18);
    ctx.strokeStyle = a.exitUnlocked() ? COL.ok : COL.alarm; ctx.lineWidth = 2;
    ctx.strokeRect(w.exit.x * cs + 3, w.exit.y * cs + 3, cs - 6, cs - 6); ctx.lineWidth = 1;
    for (const k of w.keys) if (!k.taken) { ctx.fillStyle = k.color; ctx.fillRect(k.x * cs + cs * 0.2, k.y * cs + cs * 0.3, cs * 0.6, cs * 0.4); }
    // Planned route.
    const route = a.cfg.adaptive ? (a.plan ? a.plan.path.slice(a.plan.idx) : []) : a.pathAhead(0, 999);
    if (route.length > 1) {
      ctx.strokeStyle = a.cfg.adaptive ? COL.agent : '#6b7280'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      route.forEach((p, k) => ctx[k ? 'lineTo' : 'moveTo'](p.x * cs + cs / 2, p.y * cs + cs / 2));
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    // Drone (colour shows its FSM state) and agent, interpolated between ticks.
    const lerp = (p, q) => p + (q - p) * frac;
    if (sim.drone) {
      const d = sim.drone, c = d.state === 'CHASE' ? COL.chase : d.state === 'COOLDOWN' ? COL.cooldown : COL.drone;
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(lerp(d.px, d.x) * cs + cs / 2, lerp(d.py, d.y) * cs + cs / 2, cs * 0.3, 0, 7); ctx.fill();
    }
    const ax = lerp(a.px, a.x) * cs + cs / 2, ay = lerp(a.py, a.y) * cs + cs / 2;
    ctx.fillStyle = COL.agent; ctx.beginPath(); ctx.arc(ax, ay, cs * 0.33, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ax, ay, cs * 0.12, 0, 7); ctx.fill();
    // Short flashes for events (collapse, hit, key pickup, replan).
    sim.fx = sim.fx.filter((f) => now - f.born < 900);
    for (const f of sim.fx) {
      const age = (now - f.born) / 900;
      ctx.globalAlpha = 1 - age; ctx.lineWidth = 2;
      ctx.strokeStyle = f.type === 'hit' ? COL.alarm : f.type === 'collapse' ? COL.rubble : f.color || COL.agent;
      ctx.beginPath(); ctx.arc(f.x * cs + cs / 2, f.y * cs + cs / 2, cs * (0.4 + age), 0, 7); ctx.stroke();
      ctx.globalAlpha = 1; ctx.lineWidth = 1;
    }
  }

  /* ---------- side panels ---------- */
  function refresh() {
    const a = sim.agent, st = a.stats;
    $('stTick').innerHTML = `${sim.t} <small>/ ${sim.cfg.maxTicks} ticks</small>`;
    $('stMode').textContent = sim.done ? (sim.result.success ? 'Escaped' : 'Failed: ' + sim.result.reason) : a.mode + (sim.drone ? ` · drone: ${sim.drone.state.toLowerCase()}` : '');
    const hull = Math.max(0, a.integrity);
    $('stHull').style.width = hull + '%';
    $('stHull').style.background = hull > 50 ? 'var(--ok)' : 'var(--alarm)';
    $('stKeys').innerHTML = 'Keycards ' + sim.world.keys.map((k) => `<span class="kc${k.taken ? ' held' : ''}" style="border-color:${k.color};background:${k.taken ? k.color : 'transparent'}"></span>`).join('') + `<span style="margin-left:auto">Hull ${hull}%</span>`;
    $('stMetrics').innerHTML = [[st.pathCost, 'path cost'], [st.expanded, 'states explored'], [st.replans, 'replans'], [st.planCalls, 'plans made'], [st.hits, 'drone hits'], [st.cspAssign, 'CSP assignments']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    updateTree(); updateLock(); updateLog();
  }

  let treeNodes = [];
  function buildTree() {
    treeNodes = [];
    const host = $('btTree');
    if (!sim.agent.tree) { host.innerHTML = '<p class="hint">Replanning is off, so there is no behaviour tree: the agent follows a fixed plan made at tick 0.</p>'; return; }
    const glyph = { selector: '?', sequence: '→', condition: '◇', action: '▸' };
    const mk = (n) => {
      const kids = n.children.length ? `<ul>${n.children.map(mk).join('')}</ul>` : '';
      treeNodes.push(n);
      return `<li><span class="node" data-id="${n.id}">${glyph[n.kind]} ${esc(n.name)}</span>${kids}</li>`;
    };
    host.innerHTML = `<ul>${mk(sim.agent.tree)}</ul>`;
  }
  function updateTree() {
    for (const n of treeNodes) {
      const el = document.querySelector(`.node[data-id="${n.id}"]`);
      if (el) el.className = 'node' + (n.stamp === sim.t - 1 && n.status ? ' ' + n.status : '');
    }
  }

  function updateLock() {
    const a = sim.agent, lock = sim.lock;
    let dials = new Array(5).fill(-1), cls = '', info;
    if (a.hack && a.hack.result.trace) {
      const tr = a.hack.result.trace, upto = Math.floor((a.hack.progress / a.hack.need) * tr.length);
      for (let k = 0; k < upto; k++) dials[tr[k].v] = tr[k].val;
      cls = 'set';
      info = `Solving: step ${upto} of ${tr.length} in the search (${a.hack.result.stats.assignments} assignments, ${a.hack.result.stats.backtracks} backtracks).`;
    } else if (a.codeVersion === lock.version) {
      dials = a.code.slice(); cls = 'solved';
      info = `Cracked with ${a.lastHack.result.stats.assignments} assignments.`;
    } else {
      info = a.codeVersion >= 0 ? 'The clues changed, so the old code no longer works. The agent must solve it again.' : 'The agent solves this once it holds all three keycards.';
    }
    $('dials').innerHTML = dials.map((v, i) => `<div class="dial ${v >= 0 ? cls : ''}">${v >= 0 ? v : '–'}<small>D${i + 1}</small></div>`).join('');
    const fresh = sim.lastSurge && sim.t - sim.lastSurge.t < 60 ? sim.lastSurge.added : [];
    $('clues').innerHTML = lock.constraints.map((c) => `<li class="${fresh.includes(c.text) ? 'new' : ''}">${esc(c.text)}</li>`).join('');
    $('lockInfo').textContent = info + (fresh.length ? ' New clues are in purple.' : '');
  }

  let logLen = -1;
  function updateLog() {
    if (sim.logs.length === logLen && !sim.done) return;
    logLen = sim.logs.length;
    $('log').innerHTML = sim.logs.slice(-80).reverse().map((e) => `<li><span class="t">${e.t}</span><span class="c c-${e.cat}">${e.cat}</span><span>${esc(e.msg)}</span></li>`).join('');
  }

  function showBanner() {
    const r = sim.result, b = $('banner');
    b.className = 'banner ' + (r.success ? 'win' : 'lose');
    b.innerHTML = (r.success
      ? `<h2>Escaped</h2><p>${r.ticks} ticks, path cost ${r.pathCost}, ${r.replans} replans</p>`
      : `<h2>Mission failed</h2><p>${r.reason === 'timeout' ? 'Ran out of time.' : 'The hull was destroyed.'}</p>`) +
      '<button class="btn primary" id="again">Run again</button>';
    b.hidden = false;
    $('again').onclick = () => { newSim(); setRunning(true); };
  }

  /* ---------- loop ---------- */
  function tick() {
    sim.step();
    if (sim.done) { setRunning(false); showBanner(); }
  }
  function frame(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts;
    if (running) {
      acc += dt * speed;
      let n = 0;
      while (acc >= 1 && !sim.done && n++ < 20) { tick(); acc -= 1; }
      if (n) refresh();
    }
    draw(running ? Math.min(1, acc) : 1);
    requestAnimationFrame(frame);
  }

  /* ---------- controls ---------- */
  $('btnRun').onclick = () => setRunning(!running);
  $('btnStep').onclick = () => { setRunning(false); if (!sim.done) { tick(); refresh(); } };
  $('btnReset').onclick = () => { newSim(); setRunning(true); };
  $('btnNew').onclick = () => { $('seed').value = 1 + Math.floor(Math.random() * 9999); newSim(); setRunning(true); };
  $('speed').oninput = (e) => { speed = +e.target.value; };
  for (const id of ['seed', 'cfgAlgo', 'cfgCsp', 'cfgAdaptive', 'cfgDynamic']) $(id).onchange = () => { newSim(); setRunning(true); };
  $('evCollapse').onclick = () => { if (!sim.done) { sim.collapse(true); refresh(); } };
  $('evSurge').onclick = () => { if (!sim.done) { sim.surge(true); refresh(); } };
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cs), y = Math.floor((e.clientY - r.top) / cs);
    if (!sim.done) { sim.toggleRubble(x, y); refresh(); }
  });
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.tab !== b.dataset.tab; });
    };
  });

  /* ---------- evaluation ---------- */
  $('evalRun').onclick = async () => {
    const n = Math.max(5, Math.min(200, +$('evalN').value || 30));
    const btn = $('evalRun');
    btn.disabled = true;
    const results = [];
    let done = 0;
    const total = n * ER.AGENTS.length * 2;
    for (const dynamic of [false, true]) {
      for (const a of ER.AGENTS) {
        const rows = [];
        for (let k = 0; k < n; k++) {
          rows.push(ER.runEpisode({ seed: 5000 + k, dynamic, algo: a.algo, adaptive: a.adaptive }));
          if (++done % 20 === 0) { $('evalStatus').textContent = `${done} of ${total} missions…`; await new Promise((r) => setTimeout(r, 0)); }
        }
        results.push({ dynamic, label: a.label, s: ER.summarize(rows) });
      }
    }
    const f = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '–');
    let html = '<table><thead><tr><th>Agent</th><th>Success rate</th><th>Completion time (ticks)</th><th>Path cost</th><th>States explored</th><th>Replans</th></tr></thead><tbody>';
    for (const dynamic of [false, true]) {
      html += `<tr><td class="group" colspan="6">${dynamic ? 'Dynamic' : 'Static'} facility</td></tr>`;
      for (const r of results.filter((x) => x.dynamic === dynamic)) {
        html += `<tr><td>${r.label}</td><td>${f(r.s.success * 100)}%</td><td>${f(r.s.ticks)}</td><td>${f(r.s.pathCost)}</td><td>${f(r.s.expanded)}</td><td>${f(r.s.replans, 1)}</td></tr>`;
      }
    }
    $('evalOut').innerHTML = html + '</tbody></table>';
    $('evalStatus').textContent = `Done: ${total} missions on seeds 5000–${5000 + n - 1}.`;
    btn.disabled = false;
  };

  newSim();
  setRunning(true);
  requestAnimationFrame(frame);
})();
