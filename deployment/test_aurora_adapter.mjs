import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mapSnapshot, inertText } from '../app/imports/api/aurora/adapter.mjs';
const file = name => ({ name, data: fs.readFileSync(new URL('../importer/fixtures/' + name, import.meta.url)).toString('base64') });
for (const name of ['martial','caster','multiclass','equipment']) test(name + ' uses fresh native snapshots without library effects', () => {
  const request = { schemaVersion: 1, operation: 'character', character: file(name + '.dnd5e'), files: [file('content.xml')] };
  const run = spawnSync('python3', ['-I', '-B', fileURLToPath(new URL('../importer/worker.py', import.meta.url))], { input: JSON.stringify(request), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout); assert.equal(result.ok,true);
  let counter=0;
  const mapped = mapSnapshot(result.result,'creature','owner',() => 'fresh' + ++counter);
  assert.equal(mapped.creature.public,false);
  assert.deepEqual(mapped.creature.allowedLibraries,[]);
  assert.equal(new Set(mapped.props.map(p => p._id)).size, mapped.props.length);
  assert(mapped.props.every(p => p.root.id === 'creature'));
  assert(mapped.props.filter(p => p.type === 'skill').every(p => !p.ability && !p.baseProficiency));
  assert(mapped.props.some(p => p.type === 'note' && p.name === 'Aurora import record' && p.description.text.includes('aurora-core-2014')));
  assert(!mapped.props.some(p => ['propertySlot','toggle'].includes(p.type)));
});
test('untrusted descriptions cannot become expressions, HTML or Markdown links', () => {
  const result=inertText('<img src=x onerror=bad()>{1d20} [click](https://example.com)');
  assert(!result.includes('<img')); assert(!result.includes('{')); assert(!result.includes('[click]('));
});
