/* Learning lab tab: Q-learning training, value map, policy playback, learning-vs-planning test. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const UI = window.UI;
  const cv = $('qCanvas'), ctx = cv.getContext('2d');
  let lab = null, show = null, anim = null, marks = [], busy = false, cs = 30;

  function newLab() {
    lab = new ER.QLab(Math.max(1, +$('qSeed').value || 1), { alpha: +$('qAlpha').value, gamma: +$('qGamma').value, epsDecay: +$('qDecay').value });
    show = null; anim = null; marks = [];
    const sel = $('qMask');
    sel.innerHTML = '';
    for (let m = 0; m < lab.M; m++) {
      const held = lab.world.keys.filter((_, i) => m & (1 << i)).map((k) => k.name.toLowerCase());
      sel.add(new Option(held.length ? 'holding ' + held.join(' + ') : 'no keycards held', m));
    }
    readout('Untrained: the Q-table is all zeros, so the policy has no preferences yet.');
    draw(); curve();
  }
  const readout = (h) => { $('qReadout').innerHTML = h; };

  function size() {
    const w = lab.world;
    const avail = cv.parentElement.clientWidth - 24;
    cs = Math.max(12, Math.min(44, Math.floor(avail / w.W)));
    const dpr = window.devicePixelRatio || 1;
    cv.width = w.W * cs * dpr; cv.height = w.H * cs * dpr;
    cv.style.width = w.W * cs + 'px'; cv.style.height = w.H * cs + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    if (!lab) return;
    size();
    const w = lab.world, mask = +$('qMask').value || 0, Q = lab.Q;
    let lo = Infinity, hi = -Infinity;
    const V = new Float32Array(w.N);
    for (let i = 0; i < w.N; i++) {
      if (!w.isFree(i % w.W, (i / w.W) | 0)) continue;
      const b = lab.sIndex(i, mask);
      V[i] = Math.max(Q[b], Q[b + 1], Q[b + 2], Q[b + 3]);
      lo = Math.min(lo, V[i]); hi = Math.max(hi, V[i]);
    }
    const trained = lab.episodes > 0 && hi > lo;
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) {
      const i = y * w.W + x, X = x * cs, Y = y * cs;
      const t = w.tiles[i];
      if (t === ER.WALL) { ctx.fillStyle = '#2f3b48'; ctx.fillRect(X, Y, cs, cs); continue; }
      if (t === ER.RUBBLE) { ctx.fillStyle = '#b08559'; ctx.fillRect(X, Y, cs, cs); continue; }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(X, Y, cs, cs);
      if (trained) {
        const f = (V[i] - lo) / (hi - lo);
        ctx.globalAlpha = 0.04 + 0.42 * f * f;
        ctx.fillStyle = '#2563eb'; ctx.fillRect(X + 1, Y + 1, cs - 2, cs - 2);
        ctx.globalAlpha = 1;
        const b = lab.sIndex(i, mask);
        if (Q[b] || Q[b + 1] || Q[b + 2] || Q[b + 3]) {
          const a = lab.argmax(b), [dx, dy] = ER.Q_ACTS[a];
          const cx = X + cs / 2, cy = Y + cs / 2, L = cs * 0.28;
          ctx.strokeStyle = 'rgba(31,41,51,0.55)'; ctx.lineWidth = 1.3;
          ctx.beginPath(); ctx.moveTo(cx - dx * L, cy - dy * L); ctx.lineTo(cx + dx * L, cy + dy * L);
          ctx.lineTo(cx + dx * L - (dx * 0.4 + dy * 0.35) * L, cy + dy * L - (dy * 0.4 - dx * 0.35) * L);
          ctx.moveTo(cx + dx * L, cy + dy * L);
          ctx.lineTo(cx + dx * L - (dx * 0.4 - dy * 0.35) * L, cy + dy * L - (dy * 0.4 + dx * 0.35) * L);
          ctx.stroke();
        }
      }
      ctx.strokeStyle = '#eef0f3'; ctx.lineWidth = 1; ctx.strokeRect(X + 0.5, Y + 0.5, cs - 1, cs - 1);
    }
    w.keys.forEach((k, i) => {
      const held = mask & (1 << i);
      ctx.globalAlpha = held ? 0.25 : 1;
      ctx.fillStyle = k.color; ctx.fillRect(k.x * cs + cs * 0.22, k.y * cs + cs * 0.3, cs * 0.56, cs * 0.4);
      ctx.globalAlpha = 1;
    });
    ctx.strokeStyle = '#15803d'; ctx.lineWidth = 2; ctx.strokeRect(w.exit.x * cs + 3, w.exit.y * cs + 3, cs - 6, cs - 6);
    ctx.strokeStyle = '#9aa3ae'; ctx.lineWidth = 1; ctx.strokeRect(w.start.x * cs + 4.5, w.start.y * cs + 4.5, cs - 9, cs - 9);
    if (show && show.path.length > 1) {
      ctx.strokeStyle = show.color; ctx.lineWidth = 2.5; ctx.globalAlpha = 0.9;
      ctx.beginPath();
      const upto = anim ? Math.min(show.path.length, anim.k + 1) : show.path.length;
      for (let k = 0; k < upto; k++) { const p = show.path[k], X = p.x * cs + cs / 2, Y = p.y * cs + cs / 2; if (k) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      const p = show.path[upto - 1];
      ctx.fillStyle = show.color; ctx.beginPath(); ctx.arc(p.x * cs + cs / 2, p.y * cs + cs / 2, cs * 0.28, 0, 7); ctx.fill();
    }
  }

  function movingAvg(xs, k) {
    const out = []; let s = 0;
    for (let i = 0; i < xs.length; i++) { s += xs[i]; if (i >= k) s -= xs[i - k]; out.push(s / Math.min(i + 1, k)); }
    return out;
  }
  function curve() {
    const c = lab.curve;
    const steps = c.map((r) => r.steps), succ = c.map((r) => r.success * 100);
    const opt = lab.optimal().steps;
    UI.lineChart($('qCurve'), {
      title: 'Learning curve: steps per episode', h: 240, xlabel: c.length ? `episode (1–${c.length})` : 'episode',
      ymax: lab.maxSteps,
      series: [
        { data: steps, color: '#9aa3ae', alpha: 0.5, width: 1, label: 'raw' },
        { data: movingAvg(steps, 50), color: '#2563eb', width: 2, label: '50-episode mean' },
        { data: movingAvg(succ, 50).map((v) => (v / 100) * lab.maxSteps), color: '#15803d', width: 1.5, label: 'success rate (scaled)' },
        { data: c.length ? c.map(() => opt) : [], color: '#7c3aed', width: 1, label: 'A* optimum' },
      ],
      marks: marks.map((m) => ({ i: m, color: '#ea580c', label: 'collapse' })),
    });
  }

  async function train(n) {
    if (busy) return;
    busy = true; anim = null; show = null;
    $('qTrain').disabled = true;
    for (let done = 0; done < n; done += 50) {
      lab.train(50);
      draw(); curve();
      const last = lab.curve.slice(-50);
      readout(`Episode <b>${lab.episodes}</b>, ε = ${lab.eps.toFixed(3)}. Last 50 episodes: ${(last.reduce((s, r) => s + r.success, 0) * 2)}% reached the exit, mean ${Math.round(last.reduce((s, r) => s + r.steps, 0) / last.length)} steps.`);
      await new Promise((r) => setTimeout(r, 0));
    }
    busy = false; $('qTrain').disabled = false;
  }

  function play(path, color, done) {
    show = { path, color };
    anim = { k: 0 };
    const stepMs = 70;
    const go = () => {
      if (!anim) return;
      draw();
      if (anim.k >= path.length - 1) { anim = null; draw(); if (done) done(); return; }
      anim.k++;
      setTimeout(go, stepMs);
    };
    go();
  }

  $('qTrain').onclick = () => train(500);
  $('qNew').onclick = () => newLab();
  $('qMask').onchange = () => draw();
  for (const id of ['qSeed', 'qAlpha', 'qGamma', 'qDecay']) $(id).onchange = () => newLab();
  $('qPlay').onclick = () => {
    const g = lab.greedy(), opt = lab.optimal();
    play(g.path, g.success ? '#2563eb' : '#dc2626', () => readout(g.success
      ? `<span class="good">Learned policy escapes in <b>${g.steps}</b> steps</span> (A* optimum: ${opt.steps}). No search at run time, just a table lookup per step.`
      : `<span class="bad">Learned policy fails: ${g.reason}</span> after ${g.steps} steps. ${lab.episodes ? 'It needs more training, or the map has changed under it.' : 'Train it first.'}`));
  };
  $('qAstar').onclick = () => {
    const t0 = performance.now(), opt = lab.optimal(), ms = performance.now() - t0;
    play(opt.path, '#7c3aed', () => readout(`A* (trying every keycard order) finds a <b>${opt.steps}</b>-step escape, exploring ${opt.expanded} states in ${ms.toFixed(2)} ms. It needs no training, but it has to search every time.`));
  };
  $('qMutate').onclick = () => {
    if (!lab.episodes) { readout('Train the policy first, so it has a learned route to collapse.'); return; }
    const before = lab.greedy();
    if (!before.success) { readout('The policy does not reach the exit yet. Train more before testing it against a change.'); return; }
    const cell = lab.mutate();
    if (!cell) { readout('No cell on the learned route can collapse without sealing off the exit.'); return; }
    marks.push(lab.episodes);
    const after = lab.greedy();
    const t0 = performance.now(), opt = lab.optimal(), ms = performance.now() - t0;
    curve();
    play(after.path, after.success ? '#2563eb' : '#dc2626', () => readout(
      `Rubble fell at (${cell.x}, ${cell.y}). ${after.success ? '<span class="good">The policy still escapes</span>' : `<span class="bad">The learned policy now fails: ${after.reason}.</span>`} ` +
      `A* replanned around it immediately: <b>${opt.steps}</b> steps in ${ms.toFixed(2)} ms. Train again to watch the policy re-learn.`));
  };

  newLab();
  let rt = 0;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { draw(); curve(); }, 120); });
})();
