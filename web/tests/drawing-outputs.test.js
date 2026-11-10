import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { calculate, defaults } from '../src/design.js';
import { copperDrawingDxf, copperDrawingText } from '../src/copper-drawing.js';
import { preformDrawingText, preformDrawingLayout, PREFORM_NOTES, drawnThickness } from '../src/preform-drawing.js';
import {
  normalizePartNumbers,
  titleBlockPartNumber,
  fullPartNumber,
  cleanPartNo,
  emptyPartNumbers,
  REVISIONS,
} from '../src/part-numbers.js';
import { outputFileName, safeFileStem, fileDate } from '../src/file-names.js';
import {
  drawingPdf,
  loadWatermark,
  parseDxf,
  splinePoints,
  watermarkPlacement,
  mtextPlain,
  dxfString,
} from '../src/dxf-pdf.js';
import { dimensionFor, mirroredEdge } from '../src/dimensions.js';

const template = JSON.parse(
  readFileSync(new URL('../public/drawing/copper-drawing-template.json', import.meta.url), 'utf8'),
);
const watermarkPdf = readFileSync(new URL('../../浮水印.pdf', import.meta.url));
const date = new Date(2026, 10, 10);
const design = (change = () => {}) => {
  const d = structuredClone(defaults);
  change(d);
  return calculate(d);
};
const texts = dxf =>
  parseDxf(dxf)
    .entities.filter(e => e.type === 'TEXT')
    .map(e => e.codes.find(([c]) => c === 1)[1]);

// ───────── part numbers ─────────
test('part numbers: 10-character base + 2-digit REV, validated and lockable', () => {
  assert.deepEqual(normalizePartNumbers(undefined), emptyPartNumbers());
  const n = normalizePartNumbers({ copper: { part_no: ' 348001j400 ', rev: '01', locked: true } });
  assert.equal(n.copper.part_no, '348001J400');
  assert.equal(fullPartNumber(n.copper), '348001J40001');
  assert.equal(fullPartNumber(n.preform), '');
  assert.equal(REVISIONS[0], '00');
  assert.equal(REVISIONS.at(-1), '99');
  assert.equal(cleanPartNo('348-001 j4000123'), '348001J400');
  for (const bad of [
    { copper: { part_no: '348-001' } },
    { copper: { rev: '1' } },
    { copper: { part_no: '348001', locked: true } },
    { copper: { locked: 'yes' } },
    { anvil: {} },
    { copper: { extra: 1 } },
  ])
    assert.throws(() => normalizePartNumbers(bad), /料號|零件/);
  // the design keeps them; an incomplete base cannot be drawn
  const r = design(d => (d.part_numbers = { copper: { part_no: '348001J4', rev: '00', locked: false } }));
  assert.equal(r.design.part_numbers.copper.part_no, '348001J4');
  assert.throws(() => titleBlockPartNumber(r.design, 'copper'), /尚未填完/);
  assert.deepEqual(titleBlockPartNumber(design().design, 'preform'), { partNo: 'XXXXXXXXXX', rev: '00', full: '' });
});

test('copper drawing: PART NO. and REV come from the part number', () => {
  const r = design(d => (d.part_numbers = { copper: { part_no: '348001J400', rev: '03', locked: true } }));
  const sheet = copperDrawingText(r, template, { cover: true, date });
  const values = texts(sheet);
  assert.ok(values.includes('348001J400'));
  assert.equal(values.filter(v => v === '03').length, 1, 'REV of the drawing sheet');
  assert.ok(sheet.includes('{03}'), 'REV of the cover title block');
  assert.ok(values.includes('00') && values.includes('1.發行圖面'), 'the 00 release row of the cover stays');
  assert.ok(sheet.includes(';348001J400}'), 'PART NO. of the cover');
  // bytes are the same text in the reference's code page
  assert.equal(new TextDecoder('big5').decode(copperDrawingDxf(r, template, { cover: true, date })), sheet);
});

// ───────── preform drawing ─────────
test('preform drawing: approved layout at 3:1, critical sizes, notes and title block', () => {
  const r = design(d => (d.part_numbers = { preform: { part_no: '3480020T00', rev: '01', locked: false } }));
  assert.equal(preformDrawingLayout(r).label, '3:1');
  const dxf = preformDrawingText(r, template, { cover: false, date });
  const doc = parseDxf(dxf),
    values = texts(dxf);
  for (const note of PREFORM_NOTES) assert.ok(values.includes(note), note);
  assert.ok(values.includes('3480020T00') && values.includes('01'));
  assert.ok(values.includes(`Solder preform 20.6*9.8*${drawnThickness(r)}`));
  const dims = doc.entities.filter(e => e.type === 'DIMENSION').map(e => e.codes.find(([c]) => c === 1)[1]);
  assert.deepEqual(dims, ['*9.80', '*20.60', '*3.40', '*3.40', `*${drawnThickness(r).toFixed(2)}`]);
  // every dimension draws its tolerance (± or stacked) in its block
  const blockText = name =>
    doc.blocks
      .get(name)
      .entities.filter(e => e.type === 'TEXT')
      .map(e => e.codes.find(([c]) => c === 1)[1]);
  const dimBlocks = doc.entities
    .filter(e => e.type === 'DIMENSION')
    .map(e => blockText(e.codes.find(([c]) => c === 2)[1]));
  assert.deepEqual(dimBlocks[0], ['*9.80%%p0.10']);
  assert.deepEqual(dimBlocks[2], ['*3.40', '+0.20', ' 0']);
  assert.deepEqual(dimBlocks[4], [`*${drawnThickness(r).toFixed(2)}%%p0.02`]);
  assert.ok(values.includes('比例 ') && values.includes('3:1'));
  // a large preform steps down like the copper drawing
  const big = design(d => {
    d.package.length = 50;
    d.package.width = 20;
    d.copper.base_length = 70;
    d.copper.base_width = 45;
    d.boss.center_from_left = 35;
    d.boss.center_from_bottom = 22.5;
  });
  assert.notEqual(preformDrawingLayout(big).label, '3:1');
});

// ───────── file names ─────────
test('output names: 專案名稱_Copper_Coin_日期 and the others', () => {
  assert.equal(fileDate(date), '20261110');
  assert.equal(outputFileName('RRU 專案', 'copper', 'pdf', { date }), 'RRU 專案_Copper_Coin_20261110.pdf');
  assert.equal(outputFileName('RRU', 'preform', 'step', { date }), 'RRU_Solder_Preform_20261110.step');
  assert.equal(outputFileName('RRU', 'layout', 'dxf', { date }), 'RRU_Coin_Solder_Masker_20261110.dxf');
  assert.equal(
    outputFileName('RRU', 'copper', 'dxf', { date, suffix: 'outline' }),
    'RRU_Copper_Coin_20261110_outline.dxf',
  );
  assert.equal(safeFileStem('基地台 PA / A:B*?'), '基地台 PA _ A_B__');
  assert.equal(safeFileStem('  '), '未命名專案');
  assert.throws(() => outputFileName('x', 'pcb', 'dxf'), /未知/);
});

// ───────── PDF ─────────
test('DXF text helpers decode the drawing codes', () => {
  assert.equal(dxfString('4-%%c3.00 %%p0.1 45%%d \\U+00B1'), '4-Ø3.00 ±0.1 45° ±');
  assert.equal(mtextPlain('{\\fPMingLiU|b0|i0|c136|p18;348001J400}'), '348001J400');
  assert.equal(mtextPlain('A\\PB'), 'A\nB');
  const line = splinePoints(
    1,
    [0, 0, 1, 1],
    [
      [0, 0],
      [2, 2],
    ],
  );
  assert.deepEqual(line.at(0), [0, 0]);
  assert.ok(Math.abs(line.at(-1)[0] - 2) < 1e-9);
});

test('watermark placement follows Acrobat (80 % of the page, centred) as in the reference PDF', () => {
  // the reference: ArtBox 478.5636 × 478.5636 pt on A4, cm 0.9946442 at (1.454, 2.310) / (124.954, −121.190)
  const box = [536.922 - 58.3584, 660.227 - 181.663];
  const portrait = watermarkPlacement(box, [595, 842], { scale: 80 }),
    landscape = watermarkPlacement(box, [842, 595], { scale: 80 });
  assert.ok(Math.abs(portrait.scale - 0.9946442) < 1e-5 && Math.abs(landscape.scale - 0.9946442) < 1e-5);
  assert.ok(Math.abs(portrait.x - 58.3584 * portrait.scale - 1.4542236) < 0.01);
  assert.ok(Math.abs(portrait.y - 181.663 * portrait.scale - 2.3099365) < 0.01);
  assert.ok(Math.abs(landscape.x - 58.3584 * landscape.scale - 124.9544678) < 0.01);
  assert.ok(Math.abs(landscape.y - 181.663 * landscape.scale + 121.1896973) < 0.01);
});

test('drawing PDF: cover + sheet on A4, watermark under the content at 50 %', async () => {
  const r = design();
  const watermark = await loadWatermark(watermarkPdf);
  assert.equal(watermark.kind, 'pdf');
  const bytes = await drawingPdf(copperDrawingText(r, template, { cover: true, date }), template, {
    cover: true,
    watermark,
    appearance: { scale: 80, opacity: 50, rotation: 0 },
  });
  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(
    pdf.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())]),
    [
      [595, 842],
      [842, 595],
    ],
  );
  const raw = Buffer.from(bytes).toString('latin1');
  assert.match(raw, /\/S \/Transparency/);
  assert.match(raw, /\/ca 0\.5/);
  assert.match(raw, /\/BaseFont \/MSung-Light/);
  // the watermark content stream is the first one of each page: drawn behind the drawing
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    assert.equal(contents.size(), 2);
  }
  const plain = await drawingPdf(preformDrawingText(r, template, { cover: false, date }), template, { cover: false });
  const preform = await PDFDocument.load(plain);
  assert.equal(preform.getPageCount(), 1);
  assert.equal(preform.getPage(0).node.Contents().size?.() ?? 1, 1);
  await assert.rejects(loadWatermark(new Uint8Array([1, 2, 3])), /PDF、PNG 或 JPG/);
});

// ───────── 3D viewer: overall sizes measured on the adjacent edge ─────────
test('E and F can attach to either parallel edge of the base', () => {
  const r = design(),
    c = r.design.copper;
  const f = dimensionFor('copper.base_width', r, null);
  assert.equal(f.anchorCandidates.length, 4);
  assert.deepEqual(
    f.anchorCandidates.map(({ a }) => [a[0], a[2]]),
    [
      [-c.base_length / 2, c.base_thickness],
      [c.base_length / 2, c.base_thickness],
      [-c.base_length / 2, 0],
      [c.base_length / 2, 0],
    ],
  );
  const e = dimensionFor('copper.base_length', r, null);
  assert.deepEqual(
    e.anchorCandidates.slice(0, 2).map(({ a }) => a[1]),
    [-c.base_width / 2, c.base_width / 2],
  );
  assert.deepEqual(mirroredEdge([1, -2, 3], [5, -2, 3]), { a: [1, 2, 3], b: [5, 2, 3] });
  assert.equal(dimensionFor('copper.hole_diameter', r, null).anchorCandidates, undefined);
});
