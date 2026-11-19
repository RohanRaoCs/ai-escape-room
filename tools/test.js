// Correctness tests. Run: npm test
const ER = require('./load.js');

let pass = 0;
for (const t of ER.TESTS) {
  let r;
  try { r = t.run(); } catch (e) { r = { pass: false, detail: 'error: ' + e.message }; }
  if (r.pass) pass++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${t.name}  (${r.detail})`);
}
console.log(`\n${pass} of ${ER.TESTS.length} tests passed`);
process.exit(pass === ER.TESTS.length ? 0 : 1);
