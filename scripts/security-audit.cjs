'use strict';
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const guard = require('./guard-braces.cjs');
const advisory = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
function evaluate(report, verify = guard.verify) {
  if (report.error || !report.vulnerabilities || !report.metadata?.vulnerabilities) throw new Error('Audit report unavailable or invalid.');
  const findings = report.vulnerabilities;
  const names = Object.keys(findings);
  if (!names.length) {
    if (report.metadata.vulnerabilities.total !== 0) throw new Error('Inconsistent audit report.');
    return;
  }
  const braces = findings.braces;
  if (!braces || !braces.nodes?.length || braces.nodes.some(node => path.resolve(node) !== guard.directory)) throw new Error('Audit includes unguarded dependency copies.');
  verify();
  function allowed(name, parents = new Set()) {
    const finding = findings[name];
    if (!finding || parents.has(name) || !finding.via?.length) return false;
    const next = new Set(parents); next.add(name);
    return finding.via.every(via => typeof via === 'string' ? allowed(via, next) :
      name === 'braces' && via.name === 'braces' && via.url === advisory && via.range === '<=3.0.3');
  }
  if (!names.every(name => allowed(name))) throw new Error('Unexcepted vulnerability: dependency security gate failed.');
}
function main() {
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['audit', '--json'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 8 * 1024 * 1024 });
  if (result.error || ![0, 1].includes(result.status)) throw new Error('npm audit did not complete successfully.');
  const report = JSON.parse(result.stdout);
  evaluate(report);
  console.log(report.metadata.vulnerabilities.total ? 'npm audit completed: only GHSA-vfj7-8cjw-p6xm and its transitive findings excepted; installed braces 3.0.3 guard verified. All other advisories remain blocking.' : 'npm audit completed: no vulnerabilities.');
}
module.exports = { evaluate };
if (require.main === module) { try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
