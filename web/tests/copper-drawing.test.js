import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculate, defaults } from '../src/design.js';
import {
  copperDrawingDxf,
  drawingLayout,
  drawingTolerance,
  encodeDxf,
  DEFAULT_PART_NO,
  DRAWING_NOTES,
} from '../src/copper-drawing.js';

const template = JSON.parse(
  readFileSync(new URL('../public/drawing/copper-drawing-template.json', import.meta.url), 'utf8'),
);
const date = new Date(2026, 10, 9);
const big5 = new TextDecoder('big5');
const design = (change = () => {}) => {
  const d = structuredClone(defaults);
  change(d);
  return calculate(d);
};
const draw = (r, options = {}) => big5.decode(copperDrawingDxf(r, template, { date, ...options }));

/** DXF text → entities of the ENTITIES and BLOCKS sections, header values and table records. */
function parse(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push([Number(lines[i]), lines[i + 1]]);
  const objects = [];
  let section = null,
    current = null;
  for (const [code, value] of pairs) {
    if (code === 0) {
      current = { type: value, section, tags: [] };
      objects.push(current);
      if (value === 'ENDSEC') section = null;
    } else {
      if (code === 2 && current?.type === 'SECTION') section = value;
      current?.tags.push([code, value]);
    }
  }
  const get = (o, code) => o.tags.find(([c]) => c === code)?.[1];
  const all = (o, code) => o.tags.filter(([c]) => c === code).map(([, v]) => v);
  return { pairs, objects, get, all };
}
const texts = (dxf, filter = () => true) => {
  const { objects, get } = parse(dxf);
  return objects
    .filter(o => o.type === 'TEXT' && filter(o, get))
    .map(o => ({ text: get(o, 1), x: Number(get(o, 10)), y: Number(get(o, 20)), section: o.section }));
};
const sheetNumbers = dxf =>
  texts(dxf, (o, get) => o.section === 'ENTITIES' && Math.abs(Number(get(o, 20)) - 8) < 1e-6)
    .filter(t => t.x > 95 && t.x < 106 && /^\d$/.test(t.text))
    .map(t => t.text);

test('the drawing sheet keeps the 348001J40001 format and fills the title block', () => {
  const r = design(),
    dxf = draw(r, { cover: false });
  const values = texts(dxf).map(t => t.text.trim());
  for (const value of ['2026/11/9', '未命名專案', DEFAULT_PART_NO, 'Cu base 40*30*3.48', '00', 'SHEET'])
    assert.ok(values.includes(value), value);
  assert.deepEqual(sheetNumbers(dxf), ['1', '1']);
  for (const copied of ['NET26-2013200A', 'DMR-464X-3537A', '348001J400', '2026/2/26', 'Cu base 43*39.6*3.18', '@@'])
    assert.ok(!dxf.includes(copied), copied);
  assert.ok(!values.includes('01'), 'first release: REV 00, no revision 01');
  for (const line of DRAWING_NOTES) assert.ok(values.includes(line), line);
  assert.match(dxf, /\$DWGCODEPAGE\n {2}3\nANSI_950\n/);
  assert.match(dxf, /\$ACADVER\n {2}1\nAC1015\n/);
});

test('the cover is the first release only and is optional', () => {
  const r = design(),
    withCover = draw(r, { cover: true }),
    sheetOnly = draw(r, { cover: false });
  assert.deepEqual(sheetNumbers(withCover), ['2', '2']);
  const cover = texts(withCover).map(t => t.text);
  assert.ok(cover.includes('1.發行圖面'));
  assert.equal(cover.filter(t => t === '2026/11/09').length, 2, 'Drawn and Design dates of the 00 row');
  assert.equal(cover.filter(t => t === '未命名專案').length, 2, 'USED ON on both sheets');
  for (const removed of ['修改銅塊尺寸', '修改圖面名稱尺寸', 'Rev. 00 to 01', '2026/02/26', '2026/02/23'])
    assert.ok(!withCover.includes(removed), removed);
  assert.ok(withCover.includes('{00}') && !withCover.includes('{01}'), 'cover REV 00');
  assert.ok(withCover.includes(DEFAULT_PART_NO));
  assert.ok(!sheetOnly.includes('發行圖面') && !sheetOnly.includes('陳慶峰'));
  const extents = dxf => {
    const { pairs } = parse(dxf),
      i = pairs.findIndex(([c, v]) => c === 9 && v === '$EXTMIN');
    return [Number(pairs[i + 1][1]), Number(pairs[i + 2][1])];
  };
  assert.ok(extents(withCover)[0] < -159);
  assert.deepEqual(extents(sheetOnly), [0, 0]);
});

test('DXF structure: unique handles below the seed, and every dimension owns a block', () => {
  for (const cover of [true, false]) {
    const dxf = draw(design(), { cover }),
      { pairs, objects, get } = parse(dxf);
    const handles = objects
      .filter(o => o.type !== 'SECTION') // the header's $HANDSEED is not an object handle
      .map(o => get(o, 5))
      .filter(Boolean);
    assert.equal(new Set(handles).size, handles.length, 'unique handles');
    const seed = parseInt(pairs[pairs.findIndex(([c, v]) => c === 9 && v === '$HANDSEED') + 1][1], 16);
    assert.ok(Math.max(...handles.map(h => parseInt(h, 16))) < seed);
    const records = objects.filter(o => o.type === 'BLOCK_RECORD').map(o => get(o, 2));
    const blocks = objects.filter(o => o.type === 'BLOCK').map(o => get(o, 2));
    const table = objects.find(o => o.type === 'TABLE' && get(o, 2) === 'BLOCK_RECORD');
    assert.equal(Number(get(table, 70)), records.length);
    const dimensions = objects.filter(o => o.type === 'DIMENSION' && o.section === 'ENTITIES');
    assert.equal(dimensions.length, 16);
    for (const dim of dimensions) {
      assert.ok(records.includes(get(dim, 2)) && blocks.includes(get(dim, 2)), get(dim, 2));
      assert.equal(get(dim, 3), 'DIMSTYLE_1');
    }
    for (const name of ['_FILLED', 'SF0_BL4', 'SYM_13_BL3']) assert.ok(blocks.includes(name), name);
    assert.equal(dxf.split('\n').length % 2, 1, 'complete code/value pairs');
  }
});

test('dimension texts follow the tolerance settings of the tool', () => {
  const blockTexts = dxf => texts(dxf, (o, get) => o.section === 'BLOCKS' && get(o, 8) === '12_COIN_DXF_DIMENSION');
  const defaultsDxf = draw(design(), { cover: false }),
    labels = blockTexts(defaultsDxf).map(t => t.text);
  for (const label of [
    '40.00%%p0.20',
    '30.00%%p0.20',
    '*20.60%%p0.05',
    '*9.80%%p0.05',
    '4.00%%p0.10',
    '4-R3.00',
    '%%c',
  ])
    assert.ok(labels.includes(label), label);
  // G +0/−0.1 and L +0/−0.1 as stacked deviations; the boss position has no tolerance yet
  for (const label of ['*3.00', '*0.48', ' 0', '-0.10', '*9.70', '*10.10', '(3.48)'])
    assert.ok(labels.includes(label), label);
  const changed = design(d => {
    d.tolerances['copper.base_length'] = { minus: 0.1, plus: 0.3 };
    d.tolerances['boss.center_from_left'] = { minus: 0.1, plus: 0.1 };
    d.tolerances['boss.total_height'] = { minus: 0, plus: 0.1 };
  });
  const changedLabels = blockTexts(draw(changed, { cover: false })).map(t => t.text);
  for (const label of ['40.00', '+0.30', '-0.10', '*9.70%%p0.10', '+0.10'])
    assert.ok(changedLabels.includes(label), label);
  assert.ok(!changedLabels.includes('40.00%%p0.20'));
  assert.deepEqual(drawingTolerance(changed.design, 'boss.total_height'), { deviations: ['+0.10', ' 0'] });
  assert.equal(drawingTolerance(changed.design, 'copper.corner_radius'), null, 'zero: general tolerance');
  assert.deepEqual(drawingTolerance(changed.design, 'copper.pad_size'), { symmetric: '%%p0.05' });
});

test('the view scale and position adapt to the part size', () => {
  const standard = drawingLayout(design());
  assert.equal(standard.label, '3:2');
  assert.deepEqual(standard.center, [62.354, 57.882], 'the reference position');
  assert.equal(standard.detail.label, '4:1');
  const large = design(d => {
    d.copper.base_length = 70;
    d.copper.base_width = 55;
  });
  assert.equal(drawingLayout(large).label, '1:1');
  const dxf = draw(large, { cover: false }),
    { objects, get } = parse(dxf);
  const overrides = objects.filter(o => o.type === 'DIMENSION' && o.section === 'ENTITIES').map(o => get(o, 1));
  assert.ok(
    overrides.includes('70.00') && !overrides.includes('<>'),
    'values are written out when the view is not 3:2',
  );
  assert.ok(texts(dxf).some(t => t.text === '1:1'));
  assert.ok(texts(dxf).some(t => t.text.startsWith('Cu base 70*55*')));
  const standard32 = parse(draw(design(), { cover: false }));
  const standardOverrides = standard32.objects
    .filter(o => o.type === 'DIMENSION' && o.section === 'ENTITIES')
    .map(o => standard32.get(o, 1));
  assert.ok(
    standardOverrides.includes('<>') && standardOverrides.includes('*<>'),
    '3:2 measures the part, as the reference',
  );
  const r = design();
  assert.throws(
    () => drawingLayout({ ...r, design: { ...r.design, copper: { ...r.design.copper, base_length: 900 } } }),
    /A4/,
  );
});

test('hole callouts follow the selected mounting-hole corners', () => {
  const corners = ['top_right', 'top_left', 'bottom_right', 'bottom_left'];
  for (let mask = 1; mask < 16; mask++) {
    const selected = corners.filter((_, i) => mask & (1 << i)),
      r = design(d => (d.copper.hole_corners = selected));
    const dxf = draw(r, { cover: false }),
      labels = texts(dxf).map(t => t.text);
    assert.ok(labels.includes(`${selected.length}-`), `${selected} count`);
    assert.ok(labels.includes('4-R3.00'));
    const { objects, get } = parse(dxf);
    assert.equal(
      objects.filter(o => o.type === 'CIRCLE' && o.section === 'ENTITIES' && get(o, 8) === 'COIN_DXF_CONTINUOUS_LINE')
        .length,
      selected.length,
    );
  }
});

test('text is written in the reference code page, with escapes outside Big5', () => {
  assert.deepEqual([...encodeDxf('A未')], [0x41, 0xa5, 0xbc]);
  assert.deepEqual([...encodeDxf('十')], [0xa4, 0x51], 'numeral in the CJK range, as cp950');
  assert.equal(new TextDecoder('latin1').decode(encodeDxf('Å')), '\\U+00C5');
  const named = design(d => (d.project = { ...d.project, name: 'RRU 基地台 PA' }));
  assert.ok(texts(draw(named, { cover: true })).filter(t => t.text === 'RRU 基地台 PA').length === 2);
});
