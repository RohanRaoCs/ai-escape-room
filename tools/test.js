// Correctness tests for the engine. Run: npm test   (or: node tools/test.js)
// The same tests run in the browser on the Testing page.
const ER = require('./load.js');

let pass = 0, fail = 0, group = '';
const ctx = {};
for (const t of ER.TESTS) {
  if (t.group !== group) { group = t.group; console.log('\n' + group); }
  let r;
  try { r = t.run(ctx); } catch (e) { r = { pass: false, detail: 'threw: ' + e.message }; }
  if (r.pass) pass++; else fail++;
  console.log(`  ${r.pass ? '✓' : '✗'} ${t.name}  (${r.detail})`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
