import test from 'node:test';
import assert from 'node:assert/strict';
import { defaults, calculate } from '../src/design.js';
import { drawing } from '../src/dxf.js';
import { layoutDxf } from '../src/layout.js';

const parse = text => {
  const lines = text.trimEnd().split('\n'),
    pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]]);
  return pairs;
};

for (const [name, make] of [
  ['copper', r => drawing(r, 'copper')],
  ['preform', r => drawing(r, 'preform')],
  ['layout', r => layoutDxf(r)],
]) {
  test(`${name} DXF is a complete R2010 document with unique handles and owners`, () => {
    const r = calculate(defaults),
      pairs = parse(make(r));
    const sections = pairs.filter(([c], i) => c === 2 && pairs[i - 1]?.[1] === 'SECTION').map(([, v]) => v);
    assert.deepEqual(sections, ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
    assert.deepEqual(pairs.at(-1), [0, 'EOF']);
    const seedIndex = pairs.findIndex(([, v]) => v === '$HANDSEED');
    const handles = pairs
      .filter(([c], i) => (c === 5 || c === 105) && i !== seedIndex + 1)
      .map(([, v]) => parseInt(v, 16));
    assert.equal(new Set(handles).size, handles.length, 'handles are unique');
    assert.ok(parseInt(pairs[seedIndex + 1][1], 16) > Math.max(...handles), 'HANDSEED is above every handle');
    const recordStart = pairs.findIndex(
      ([c, v], i) => c === 0 && v === 'BLOCK_RECORD' && pairs.slice(i, i + 8).some(([, x]) => x === '*Model_Space'),
    );
    const modelRecord = pairs[recordStart + 1];
    assert.equal(modelRecord[0], 5);
    const start = pairs.findIndex(([c, v], i) => v === 'ENTITIES' && pairs[i - 1][1] === 'SECTION');
    const end = pairs.findIndex(([c, v], i) => i > start && v === 'ENDSEC');
    const entities = pairs
      .slice(start + 1, end)
      .map((p, i, all) => [p, all[i + 1], all[i + 2]])
      .filter(([[c]]) => c === 0);
    assert.ok(entities.length > 10);
    for (const [, handle, owner] of entities) {
      assert.equal(handle[0], 5);
      assert.deepEqual(owner, [330, modelRecord[1]]);
    }
    for (const layer of ['0', 'DIM', name === 'layout' ? 'PA_CENTER' : 'NOTES', 'CENTER'])
      assert.ok(
        pairs.some(([c, v], i) => c === 2 && v === layer && pairs[i - 1][1] === 'AcDbLayerTableRecord'),
        layer,
      );
    assert.ok(
      !pairs.some(([, v]) => /\d\.\d{10,}/.test(String(v)) && /mm/.test(String(v))),
      'note text has no raw floating-point noise',
    );
  });
}

test('layout distances print without floating-point noise', () => {
  const d = structuredClone(defaults);
  d.boss.center_from_left = 20.3;
  assert.match(layoutDxf(calculate(d)), /\n20\.30 mm\n/);
});
