/* Minimal reactive Behaviour Tree.
 * Composites re-evaluate from the first child every tick (no memory), so a higher-priority
 * branch such as "Survive" can pre-empt a running navigation the moment its condition holds.
 * Each node remembers the status and tick of its last execution for live visualisation. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});
  const S = { SUCCESS: 'success', FAILURE: 'failure', RUNNING: 'running' };
  let nextId = 0;

  function Node(kind, name, children, fn) {
    this.id = nextId++;
    this.kind = kind; // selector | sequence | condition | action
    this.name = name;
    this.children = children || [];
    this.fn = fn;
    this.status = null;
    this.stamp = -1;
  }
  Node.prototype.run = function (ctx) {
    let s;
    if (this.kind === 'selector') {
      s = S.FAILURE;
      for (const c of this.children) { const r = c.run(ctx); if (r !== S.FAILURE) { s = r; break; } }
    } else if (this.kind === 'sequence') {
      s = S.SUCCESS;
      for (const c of this.children) { const r = c.run(ctx); if (r !== S.SUCCESS) { s = r; break; } }
    } else if (this.kind === 'condition') {
      s = this.fn(ctx) ? S.SUCCESS : S.FAILURE;
    } else {
      s = this.fn(ctx);
    }
    this.status = s;
    this.stamp = ctx.t;
    return s;
  };

  const BT = {
    S,
    selector: (name, children) => new Node('selector', name, children),
    sequence: (name, children) => new Node('sequence', name, children),
    condition: (name, fn) => new Node('condition', name, null, fn),
    action: (name, fn) => new Node('action', name, null, fn),
  };
  ER.BT = BT;
})(typeof globalThis !== 'undefined' ? globalThis : window);
