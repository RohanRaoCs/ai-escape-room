/* Seeded pseudo-random number generator (mulberry32).
 * Every map, event schedule and benchmark run is reproducible from its seed. */
(function (G) {
  'use strict';
  const ER = (G.ER = G.ER || {});

  function RNG(seed) {
    let s = (seed >>> 0) || 1;
    const r = {
      next() {
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(a, b) { return a + Math.floor(r.next() * (b - a + 1)); },
      pick(arr) { return arr[Math.floor(r.next() * arr.length)]; },
      chance(p) { return r.next() < p; },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(r.next() * (i + 1));
          const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
        }
        return arr;
      },
    };
    return r;
  }

  ER.RNG = RNG;
  ER.now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
})(typeof globalThis !== 'undefined' ? globalThis : window);
