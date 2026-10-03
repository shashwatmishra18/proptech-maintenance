'use strict';
const fs = require('node:fs');
const path = require('node:path');
const directory = path.dirname(require.resolve('braces/package.json'));
const source = String.raw`'use strict';
function reject() {
  const error = new RangeError('Brace pattern exceeds safe depth');
  error.code = 'ERR_FIXNEST_BRACE_DEPTH';
  throw error;
}
function input(value) {
  if (typeof value !== 'string') return;
  const opens = [];
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '\\') { index++; continue; }
    if (char === '{' || char === '(' || char === '[') { opens.push(char); if (opens.length > 64) reject(); }
    else if ((char === '}' && opens.at(-1) === '{') || (char === ')' && opens.at(-1) === '(') || (char === ']' && opens.at(-1) === '[')) opens.pop();
  }
}
function ast(root) {
  const stack = [[root, 0]], seen = new WeakSet();
  let count = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (depth > 64 || ++count > 65536 || seen.has(node)) reject();
    seen.add(node);
    if (Array.isArray(node.nodes)) for (const child of node.nodes) stack.push([child, depth + 1]);
  }
}
module.exports = { input, ast };
`;
const kinds = ['parse', 'compile', 'expand', 'stringify'];
const marker = '// FixNest brace depth guard v1';
function wrapper(kind) {
  return `\n${marker}\nconst fixnestGuard = require('./fixnest-depth-guard.cjs');\nconst fixnestOriginal = module.exports;\nmodule.exports = function(...args) {\n${kind === 'parse' ? "  fixnestGuard.input(args[0]);\n  const result = fixnestOriginal(...args);\n  fixnestGuard.ast(result);\n  return result;" : "  fixnestGuard.ast(args[0]);\n  return fixnestOriginal(...args);"}\n};\n`;
}
function verify() {
  if (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version !== '3.0.3') throw new Error('Review/remove the braces mitigation for the installed version.');
  if (fs.readFileSync(path.join(directory, 'lib/fixnest-depth-guard.cjs'), 'utf8') !== source) throw new Error('Braces depth guard is missing or modified.');
  for (const kind of kinds) {
    if (!fs.readFileSync(path.join(directory, 'lib', kind + '.js'), 'utf8').endsWith(wrapper(kind))) throw new Error('Braces entry point is not guarded: ' + kind);
    const fn = require(path.join(directory, 'lib', kind + '.js'));
    let value = '{'.repeat(1000) + 'x' + '}'.repeat(1000);
    if (kind !== 'parse') { value = { type: 'text', value: 'x' }; for (let i = 0; i < 1000; i++) value = { type: 'brace', nodes: [value] }; }
    let rejected = false;
    try { fn(value); } catch (error) { if (error.code === 'ERR_FIXNEST_BRACE_DEPTH') rejected = true; else throw error; }
    if (!rejected) throw new Error('Braces depth guard failed: ' + kind);
  }
  return true;
}
function install() {
  if (JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version !== '3.0.3') throw new Error('Review/remove the braces mitigation for the installed version.');
  fs.writeFileSync(path.join(directory, 'lib/fixnest-depth-guard.cjs'), source);
  for (const kind of kinds) {
    const file = path.join(directory, 'lib', kind + '.js');
    const current = fs.readFileSync(file, 'utf8');
    if (!current.includes(marker)) fs.appendFileSync(file, wrapper(kind));
    else if (!current.endsWith(wrapper(kind))) throw new Error('Unexpected braces guard modification.');
  }
  verify();
  console.log('Verified braces 3.0.3 depth guard (maximum depth 64).');
}
module.exports = { install, verify, directory };
if (require.main === module) install();
