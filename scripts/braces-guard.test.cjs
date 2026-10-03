'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { verify } = require('./guard-braces.cjs');
const { evaluate } = require('./security-audit.cjs');
function report() {
  return { metadata: { vulnerabilities: { total: 2 } }, vulnerabilities: {
    braces: { nodes: ['node_modules/braces'], via: [{ name: 'braces', range: '<=3.0.3', url: 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm' }] },
    micromatch: { via: ['braces'] }
  } };
}
test('installed guard protects parse, compile, expand and stringify before recursion', () => {
  assert.equal(verify(), true);
  const result = spawnSync(process.execPath, ['--stack-size=256', '-e', `
    const assert=require('node:assert/strict'), braces=require('braces');
    const deep='{'.repeat(20000)+'x'+'}'.repeat(20000);
    for (const fn of [braces, braces.parse, braces.compile, braces.expand, require('micromatch').braces]) {
      assert.throws(()=>fn(deep), e=>e.code==='ERR_FIXNEST_BRACE_DEPTH');
      assert.throws(()=>fn('{]'.repeat(20000)+'x}'), e=>e.code==='ERR_FIXNEST_BRACE_DEPTH');
    }
    let ast={type:'text',value:'x'};
    for(let i=0;i<20000;i++) ast={type:'brace',nodes:[ast]};
    for(const kind of ['compile','expand','stringify']) assert.throws(()=>require('braces/lib/'+kind)(ast), e=>e.code==='ERR_FIXNEST_BRACE_DEPTH');
    console.log('survived');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'survived');
});
test('normal build globs remain usable and cyclic ASTs are rejected', () => {
  const braces = require('braces');
  assert.deepEqual(braces.expand('{1..3}'), ['1', '2', '3']);
  assert.deepEqual(braces.expand('src/**/*.{ts,tsx}'), ['src/**/*.ts', 'src/**/*.tsx']);
  const cycle = { type: 'brace', nodes: [] }; cycle.nodes.push(cycle);
  for (const kind of ['compile', 'expand', 'stringify']) assert.throws(() => require('braces/lib/' + kind)(cycle), error => error.code === 'ERR_FIXNEST_BRACE_DEPTH');
});
test('audit exception accepts only exact advisory scope with a verified guard', () => {
  assert.doesNotThrow(() => evaluate(report()));
  for (const mutate of [
    r => r.vulnerabilities.braces.via[0].url += '-other',
    r => r.vulnerabilities.braces.via[0].name = 'other',
    r => r.vulnerabilities.braces.via[0].range = '*',
    r => r.vulnerabilities.braces.nodes.push('node_modules/other/node_modules/braces'),
    r => r.vulnerabilities.other = { via: [{ name: 'other', url: 'https://github.com/advisories/OTHER' }] },
    r => r.error = { code: 'REGISTRY_ERROR' },
    r => r.vulnerabilities.micromatch.via = ['micromatch']
  ]) { const value = report(); mutate(value); assert.throws(() => evaluate(value)); }
  assert.throws(() => evaluate(report(), () => { throw new Error('Guard modified'); }));
});

