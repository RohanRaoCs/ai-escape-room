/* Website front end. The simulation itself is the Python package in /escape_room, running in
 * the browser through Pyodide. This file only loads it, draws the state it returns, and sends
 * button presses back to it (see escape_room/web.py). */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PY_FILES = ['__init__', 'world', 'search', 'csp', 'bt', 'drone', 'agent', 'sim', 'view', 'web'];
  const COL = {
    floor: '#ffffff', grid: '#eef0f3', wall: '#2f3b48', rubble: '#b08559', coolant: '#14b8a6',
    agent: '#2563eb', PATROL: '#ea580c', CHASE: '#dc2626', COOLDOWN: '#9ca3af', terminal: '#7c3aed', ok: '#15803d', alarm: '#dc2626',
  };
  const WALL = 1, RUBBLE = 2;

  let web = null, S = null, running = false, acc = 0, last = 0, speed = 8, cs = 24;
  const canvas = $('world'), ctx = canvas.getContext('2d');

  /* ---------- load Python ---------- */
  async function boot() {
    const pyodide = await loadPyodide();
    pyodide.FS.mkdirTree('/home/pyodide/escape_room');
    await Promise.all(PY_FILES.map(async (f) => {
      const res = await fetch(`escape_room/${f}.py`);
      if (!res.ok) throw new Error(`Could not load escape_room/${f}.py`);
      pyodide.FS.writeFile(`/home/pyodide/escape_room/${f}.py`, await res.text());
    }));
    web = pyodide.pyimport('escape_room.web');
    $('loading').hidden = true;
    newSim();
    setRunning(true);
    requestAnimationFrame(frame);
  }
  const call = (fn, ...args) => { S = JSON.parse(web[fn](...args)); return S; };

  /* ---------- simulation control ---------- */
  function newSim() {
    call('new_sim', JSON.stringify({
      seed: Math.max(1, +$('seed').value || 1), algo: $('cfgAlgo').value, csp: $('cfgCsp').value,
      adaptive: $('cfgAdaptive').checked, dynamic: $('cfgDynamic').checked,
    }));
    acc = 0;
    $('banner').hidden = true;
    resize();
    refresh();
  }
  function setRunning(v) { running = v && !S.done; $('btnRun').textContent = running ? 'Pause' : 'Run'; }
  function afterStep() {
    refresh();
    if (S.done) { setRunning(false); showBanner(); }
  }

  function resize() {
    const avail = canvas.parentElement.clientWidth - 20;
    cs = Math.max(10, Math.min(32, Math.floor(avail / S.W)));
    const dpr = window.devicePixelRatio || 1;
    canvas.width = S.W * cs * dpr; canvas.height = S.H * cs * dpr;
    canvas.style.width = S.W * cs + 'px'; canvas.style.height = S.H * cs + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => S && resize());

  /* ---------- drawing ---------- */
  function draw(frac) {
    const cell = (x, y, color, pad = 0) => { ctx.fillStyle = color; ctx.fillRect(x * cs + pad, y * cs + pad, cs - 2 * pad, cs - 2 * pad); };
    for (let y = 0; y < S.H; y++) for (let x = 0; x < S.W; x++) {
      const i = y * S.W + x, t = S.tiles[i];
      cell(x, y, t === WALL ? COL.wall : t === RUBBLE ? COL.rubble : COL.floor);
      if (t === WALL || t === RUBBLE) continue;
      ctx.strokeStyle = COL.grid; ctx.strokeRect(x * cs + 0.5, y * cs + 0.5, cs - 1, cs - 1);
      if (S.hazard[i]) { ctx.globalAlpha = 0.25; cell(x, y, COL.coolant, 1); ctx.globalAlpha = 1; }
    }
    ctx.globalAlpha = 0.18;
    for (const c of S.searched) cell(c % S.W, Math.floor(c / S.W), '#3b82f6', cs * 0.22); // cells the last search expanded
    ctx.globalAlpha = 1;
    cell(S.terminal[0], S.terminal[1], COL.terminal, cs * 0.18);
    ctx.strokeStyle = S.exit_open ? COL.ok : COL.alarm; ctx.lineWidth = 2;
    ctx.strokeRect(S.exit[0] * cs + 3, S.exit[1] * cs + 3, cs - 6, cs - 6); ctx.lineWidth = 1;
    for (const k of S.keys) if (!k.taken) { ctx.fillStyle = k.color; ctx.fillRect(k.x * cs + cs * 0.2, k.y * cs + cs * 0.3, cs * 0.6, cs * 0.4); }
    if (S.route.length > 1) {
      ctx.strokeStyle = S.agent.adaptive ? COL.agent : '#6b7280'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      S.route.forEach(([x, y], k) => ctx[k ? 'lineTo' : 'moveTo'](x * cs + cs / 2, y * cs + cs / 2));
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    const lerp = (p, q) => p + (q - p) * frac;
    if (S.drone) {
      const d = S.drone;
      ctx.fillStyle = COL[d.state]; ctx.beginPath(); ctx.arc(lerp(d.px, d.x) * cs + cs / 2, lerp(d.py, d.y) * cs + cs / 2, cs * 0.3, 0, 7); ctx.fill();
    }
    const a = S.agent, ax = lerp(a.px, a.x) * cs + cs / 2, ay = lerp(a.py, a.y) * cs + cs / 2;
    ctx.fillStyle = COL.agent; ctx.beginPath(); ctx.arc(ax, ay, cs * 0.33, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ax, ay, cs * 0.12, 0, 7); ctx.fill();
  }

  /* ---------- side panels ---------- */
  function refresh() {
    const a = S.agent, st = S.stats;
    $('stTick').innerHTML = `${S.t} <small>/ 600 ticks</small>`;
    $('stMode').textContent = S.done ? (S.result.success ? 'Escaped' : 'Failed: ' + S.result.reason) : a.mode + (S.drone ? ` · drone: ${S.drone.state.toLowerCase()}` : '');
    $('stHull').style.width = a.hull + '%';
    $('stHull').style.background = a.hull > 50 ? 'var(--ok)' : 'var(--alarm)';
    $('stKeys').innerHTML = 'Keycards ' + S.keys.map((k) => `<span class="kc${k.taken ? ' held' : ''}" style="border-color:${k.color};background:${k.taken ? k.color : 'transparent'}"></span>`).join('') + `<span style="margin-left:auto">Hull ${a.hull}%</span>`;
    $('stMetrics').innerHTML = [[st.path_cost, 'path cost'], [st.expanded, 'states explored'], [st.replans, 'replans'], [st.plan_calls, 'plans made'], [st.hits, 'drone hits'], [st.csp_assignments, 'CSP assignments']]
      .map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');

    // Behaviour tree: indent by depth, colour by the status of the last tick.
    $('btTree').innerHTML = S.tree === null
      ? '<p class="hint">Replanning is off, so there is no behaviour tree: the agent follows a fixed plan made at tick 0.</p>'
      : S.tree.map((n) => `<div style="padding-left:${n.depth * 16}px"><span class="node ${n.status || ''}">${n.glyph} ${esc(n.name)}</span></div>`).join('');

    const L = S.lock;
    $('dials').innerHTML = L.dials.map((v, i) => `<div class="dial ${v === null ? '' : L.state === 'solved' ? 'solved' : 'set'}">${v === null ? '–' : v}<small>D${i + 1}</small></div>`).join('');
    $('clues').innerHTML = L.clues.map((c) => `<li class="${c.new ? 'new' : ''}">${esc(c.text)}</li>`).join('');
    $('lockInfo').textContent = L.info;

    $('log').innerHTML = S.logs.slice().reverse().map(([t, cat, msg]) => `<li><span class="t">${t}</span><span class="c c-${cat}">${cat}</span><span>${esc(msg)}</span></li>`).join('');
  }

  function showBanner() {
    const r = S.result, b = $('banner');
    b.className = 'banner ' + (r.success ? 'win' : 'lose');
    b.innerHTML = (r.success
      ? `<h2>Escaped</h2><p>${r.ticks} ticks, path cost ${r.path_cost}, ${r.replans} replans</p>`
      : `<h2>Mission failed</h2><p>${r.reason === 'timeout' ? 'Ran out of time.' : 'The hull was destroyed.'}</p>`) +
      '<button class="btn primary" id="again">Run again</button>';
    b.hidden = false;
    $('again').onclick = () => { newSim(); setRunning(true); };
  }

  /* ---------- loop ---------- */
  function frame(ts) {
    const dt = Math.min(0.1, (ts - last) / 1000 || 0);
    last = ts;
    if (running) {
      acc += dt * speed;
      const n = Math.min(20, Math.floor(acc));
      if (n > 0) { acc -= n; call('step', n); afterStep(); }
    }
    draw(running ? Math.min(1, acc) : 1);
    requestAnimationFrame(frame);
  }

  /* ---------- controls ---------- */
  $('btnRun').onclick = () => web && setRunning(!running);
  $('btnStep').onclick = () => { if (!web) return; setRunning(false); call('step', 1); afterStep(); };
  $('btnReset').onclick = () => { if (web) { newSim(); setRunning(true); } };
  $('btnNew').onclick = () => { if (!web) return; $('seed').value = 1 + Math.floor(Math.random() * 9999); newSim(); setRunning(true); };
  $('speed').oninput = (e) => { speed = +e.target.value; };
  for (const id of ['seed', 'cfgAlgo', 'cfgCsp', 'cfgAdaptive', 'cfgDynamic']) $(id).onchange = () => { if (web) { newSim(); setRunning(true); } };
  $('evCollapse').onclick = () => { if (web) { call('collapse'); refresh(); } };
  $('evSurge').onclick = () => { if (web) { call('surge'); refresh(); } };
  canvas.addEventListener('click', (e) => {
    if (!web) return;
    const r = canvas.getBoundingClientRect();
    call('click', Math.floor((e.clientX - r.left) / cs), Math.floor((e.clientY - r.top) / cs));
    refresh();
  });
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      document.querySelectorAll('.tabpanel').forEach((p) => { p.hidden = p.dataset.tab !== b.dataset.tab; });
    };
  });

  boot().catch((err) => {
    $('loading').innerHTML = `Could not start Python: ${esc(err.message)}.<br><small class="hint">If you opened index.html as a file, run <code>python -m http.server</code> in the project folder and visit http://localhost:8000 instead.</small>`;
  });
})();
