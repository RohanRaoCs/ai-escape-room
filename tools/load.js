// Loads the browser engine files into Node (they attach to globalThis.ER).
const path = require('path');
const FILES = ['rng', 'world', 'search', 'fuzzy', 'csp', 'bt', 'drone', 'agent', 'sim', 'qlearn', 'bench', 'tests'];
for (const f of FILES) require(path.join(__dirname, '..', 'js', 'core', f + '.js'));
module.exports = globalThis.ER;
