// Copper base 2D drawing in the company format of drawing 348001J40001.
//
// The format (A4 frame, title block, cover sheet, Delta logo, arrow and surface
// roughness blocks) comes from the reference drawing, prepared once by
// scripts/build-drawing-template.py into public/drawing/copper-drawing-template.json.
// This module draws the part on it: the main (top) view with the B-B cutting
// plane, section B-B, detail A of a boss pad, notes and the title block values.
//
// Conventions follow the reference, a Creo export (DXF R2000, sheet scaled by
// 2/3 so a 3:2 view is drawn at part size): every dimension is a DIMENSION entity
// whose block holds explicitly drawn geometry — 1.667 arrows, extension lines
// 1.5 off the part and 1.333 past the dimension line, text 0.45 above the line,
// stacked deviations, arrows outside with a 2.667 tail when the text does not fit.
// Positions are the reference's, measured from the features they dimension; the
// view scale and placement adapt to the part size. Tolerances follow the tool's
// tolerance settings; a zero tolerance leaves the value to the general tolerance
// table of the title block. Values marked "*" are critical, as on the reference.

import { getTolerance } from './tolerances.js';
import { holeCorners, defaultHoleCorners } from './hole-corners.js';
import { copperFootprint } from './copper-geometry.js';
import { PART_NO_PLACEHOLDER, titleBlockPartNumber } from './part-numbers.js';

export const DRAWING_TEMPLATE_PATH = 'drawing/copper-drawing-template.json';
export const DEFAULT_PART_NO = PART_NO_PLACEHOLDER.copper;

const OUTLINE = 'COIN_DXF_CONTINUOUS_LINE',
  AXIS = 'COIN_DXF_AXIS',
  DIM = '12_COIN_DXF_DIMENSION',
  TXT = '12_COIN_DXF_TEXT';
const TH = 1.8,
  TOL_H = 1.17,
  ARROW = 1.6667,
  TAIL = 2.667,
  EXO = 1.5,
  EXE = 1.333,
  GAP = 0.45,
  GLYPH = 1.27; // measured advance per glyph at 1.8 (reference label length / glyph count)
const SHEET_SCALE = 2 / 3; // the Creo export draws the A4 sheet at 2/3
const VIEW_SCALES = [
  [3, 2],
  [1, 1],
  [1, 2],
  [1, 3],
  [1, 4],
  [1, 5],
];
const DETAIL_SCALES = [
  [4, 1],
  [2, 1],
  [1, 1],
];
// Drawing area of the sheet: inside the frame, above the title block, left of the notes.
const AREA = { left: 9.5, right: 103, bottom: 24.2, top: 132.3 };
const MAIN_CENTER = [62.354, 57.882]; // the reference's main view centre
const NOTE_X = 104.68,
  NOTE_TOP = 65.32,
  NOTE_LINE = 2.7;
/** Shared with the preform drawing (same format, title block and notes position). */
export const DRAWING_LAYERS = { OUTLINE, AXIS, DIM, TXT };
export const DRAWING_SHEET = { AREA, NOTE_X, NOTE_TOP, NOTE_LINE, SHEET_SCALE, TH };
// The reference's notes, word for word, wrapped to fill the space between the
// views and the frame (approved layout; the wording must not change).
export const DRAWING_NOTES = [
  'Note:',
  '1.Material: C1100 or C1020',
  '2.Surfce treatment: Matte tin (100%) plated over nickel (Electroless',
  'nickel (EN) + electroplated tin (Sn))',
  '3.Thickness of tin coating is 1.5-3.5 microns, and thickness of',
  'nickel plating should be no less than 1.5 microns.',
  '4. All sharp edges removed',
  "5. MUST MEET DELTA's SPEC :10000-0002 and 10000-0094",
  "6. MUST MEET DELTA's SPEC :10000-0162",
  '7.THE MARK "*" ARE CRITICAL DIMENSIONS IN THE PART.',
];

// Arial advance widths (units of 2048/em, ASCII 32…126), for the relative widths
// of short dimension texts.
const ARIAL = [
  569, 569, 727, 1139, 1139, 1821, 1366, 391, 682, 682, 797, 1196, 569, 682, 569, 569, 1139, 1139, 1139, 1139, 1139,
  1139, 1139, 1139, 1139, 1139, 569, 569, 1196, 1196, 1196, 1139, 2079, 1366, 1366, 1479, 1479, 1366, 1251, 1593, 1479,
  569, 1024, 1366, 1139, 1706, 1479, 1593, 1366, 1593, 1479, 1366, 1251, 1479, 1366, 1933, 1366, 1366, 1251, 569, 569,
  569, 961, 1139, 682, 1139, 1139, 1024, 1139, 1139, 569, 1139, 1139, 455, 455, 1024, 455, 1706, 1139, 1139, 1139, 1139,
  682, 1024, 569, 1139, 1024, 1479, 1024, 1024, 1024, 684, 532, 684, 1196,
];
const arialAdvance = s => [...s].reduce((sum, ch) => sum + (ARIAL[ch.charCodeAt(0) - 32] ?? 2048), 0);

// ───────── numbers and labels ─────────
/** Two decimals as on the reference; a third only when the value needs it. */
export const drawingNumber = v => {
  const s = (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3);
  return s.endsWith('0') ? s.slice(0, -1) : s;
};
export const general = v => String(Number(v.toPrecision(6)));
const glyphs = s => s.replaceAll('%%p', '±').replaceAll('%%c', 'Ø').length;

/** Tolerance of `key` as drawn: symmetric ±, stacked deviations, or none (general tolerance). */
export function drawingTolerance(design, key) {
  if (!key) return null;
  const { plus, minus } = getTolerance(design, key);
  if (!plus && !minus) return null;
  if (plus === minus) return { symmetric: `%%p${drawingNumber(plus)}` };
  return { deviations: [plus ? `+${drawingNumber(plus)}` : ' 0', minus ? `-${drawingNumber(minus)}` : ' 0'] };
}

// ───────── DXF writing on the template ─────────
const INTEGER_CODES = c =>
  (c >= 60 && c <= 99) || (c >= 170 && c <= 179) || (c >= 270 && c <= 289) || (c >= 370 && c <= 389);
/** A DXF string value: one line, no control characters. */
export const dxfText = s =>
  String(s)
    // eslint-disable-next-line no-control-regex -- control characters cannot appear in a DXF value
    .replace(/[\u0000-\u001f\u007f]/g, ' ');

// The reference is written in code page ANSI_950 (Big5, as cp950). Standard Big5
// only: frequent and less frequent characters first, so the numerals repeated in
// the symbol area (十, 卅) take their usual codes.
let big5 = null;
function big5Table() {
  if (big5) return big5;
  const decoder = new TextDecoder('big5'),
    table = new Map();
  for (const [from, to] of [
    [0xa440, 0xc67e],
    [0xc940, 0xf9d5],
    [0xa140, 0xa3bf],
  ])
    for (let code = from; code <= to; code++) {
      const trail = code & 0xff;
      if (trail < 0x40 || (trail > 0x7e && trail < 0xa1) || trail === 0xff) continue;
      const ch = decoder.decode(new Uint8Array([code >> 8, trail]));
      if (ch.length === 1 && ch !== '\ufffd' && !table.has(ch)) table.set(ch, code);
    }
  return (big5 = table);
}
/** DXF text → ANSI_950 bytes; characters outside Big5 become DXF \\U+XXXX escapes. */
export function encodeDxf(text) {
  const table = big5Table();
  const s = text.replace(/[\u0080-\u{10ffff}]/gu, ch =>
    table.has(ch) ? ch : ch.length > 1 ? '?' : `\\U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
  );
  const bytes = new Uint8Array(s.length * 2);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes[n++] = c;
    else {
      const code = table.get(s[i]);
      bytes[n++] = code >> 8;
      bytes[n++] = code & 0xff;
    }
  }
  return bytes.slice(0, n);
}
const real = v => {
  if (!Number.isFinite(v)) throw new Error(`圖面數值無效：${v}`);
  const s = (Math.abs(v) < 5e-11 ? 0 : v).toFixed(10).replace(/0+$/, '');
  return s.endsWith('.') ? `${s}0` : s;
};

export function templateWriter(template) {
  if (template?.format !== 'pa-copper-drawing-template' || template.version !== 1 || template.dxf_version !== 'AC1015')
    throw new Error('圖面範本格式不正確，請重新整理網站。');
  let next = template.next_handle;
  const handle = () => (next++).toString(16).toUpperCase();
  const names = new Set(template.block_names);
  const records = [],
    blocks = [],
    model = { owner: template.handles.model_space, out: [] };
  let anonymous = 0;
  const write = (out, values) => {
    for (let i = 0; i < values.length; i += 2) {
      const code = values[i],
        value = values[i + 1];
      const text =
        typeof value === 'number' ? (INTEGER_CODES(code) ? String(Math.round(value)) : real(value)) : dxfText(value);
      out.push(`${String(code).padStart(3)}\n${text}\n`);
    }
  };
  const entity = (space, type, layer, subclass, ...values) =>
    write(space.out, [0, type, 5, handle(), 330, space.owner, 100, 'AcDbEntity', 8, layer, 100, subclass, ...values]);
  const xyz = (code, [x, y]) => [code, x, code + 10, y, code + 20, 0];
  const w = {
    model,
    line(space, a, b, layer = OUTLINE, ltype) {
      write(space.out, [0, 'LINE', 5, handle(), 330, space.owner, 100, 'AcDbEntity', 8, layer]);
      if (ltype) write(space.out, [6, ltype]);
      write(space.out, [100, 'AcDbLine', ...xyz(10, a), ...xyz(11, b)]);
    },
    arc(space, c, r, a0, a1, layer = OUTLINE) {
      entity(space, 'ARC', layer, 'AcDbCircle', ...xyz(10, c), 40, r, 100, 'AcDbArc', 50, a0, 51, a1);
    },
    circle(space, c, r, layer = OUTLINE) {
      entity(space, 'CIRCLE', layer, 'AcDbCircle', ...xyz(10, c), 40, r);
    },
    poly(space, points, closed = true, layer = OUTLINE) {
      entity(
        space,
        'LWPOLYLINE',
        layer,
        'AcDbPolyline',
        90,
        points.length,
        70,
        closed ? 1 : 0,
        ...points.flatMap(([x, y]) => [10, x, 20, y]),
      );
    },
    /** align 'right': the text ends at p (bottom-right alignment). */
    text(space, s, p, { height = TH, layer = TXT, rotation = 0, align } = {}) {
      entity(
        space,
        'TEXT',
        layer,
        'AcDbText',
        ...xyz(10, p),
        40,
        height,
        1,
        s,
        ...(rotation ? [50, rotation] : []),
        7,
        'STANDARD',
      );
      if (align === 'right') write(space.out, [72, 2, ...xyz(11, p), 100, 'AcDbText', 73, 1]);
      else write(space.out, [100, 'AcDbText']);
    },
    insert(space, name, p, { scale = 1, rotation = 0, layer = DIM } = {}) {
      entity(
        space,
        'INSERT',
        layer,
        'AcDbBlockReference',
        2,
        name,
        ...xyz(10, p),
        ...(scale !== 1 ? [41, scale, 42, scale] : []),
        ...(rotation ? [50, rotation] : []),
      );
    },
    /** LEADER with its arrowhead at the first vertex. */
    leader(points, layer = TXT) {
      entity(
        model,
        'LEADER',
        layer,
        'AcDbLeader',
        3,
        'STANDARD',
        71,
        1,
        72,
        0,
        73,
        3,
        74,
        0,
        75,
        0,
        76,
        points.length,
        ...points.flatMap(p => xyz(10, p)),
      );
    },
    hatch(points, layer = OUTLINE) {
      // ANSI31 (45° lines, 3.175 apart) at scale 0.55, as on the reference section.
      const spacing = 3.175 * 0.55,
        offset = spacing / Math.SQRT2;
      entity(
        model,
        'HATCH',
        layer,
        'AcDbHatch',
        10,
        0,
        20,
        0,
        30,
        0,
        210,
        0,
        220,
        0,
        230,
        1,
        2,
        'ANSI31',
        70,
        0,
        71,
        0,
        91,
        1,
        92,
        3,
        72,
        0,
        73,
        1,
        93,
        points.length,
        ...points.flatMap(([x, y]) => [10, x, 20, y]),
        97,
        0,
        75,
        1,
        76,
        1,
        52,
        0,
        41,
        0.55,
        77,
        0,
        78,
        1,
        53,
        45,
        43,
        0,
        44,
        0,
        45,
        -offset,
        46,
        offset,
        79,
        0,
        98,
        0,
      );
    },
    /** DIMENSION entity + its anonymous block; returns the block to draw into. */
    dimension(kind, { defpoint, mid, p1, p2, p4, text, measurement, leaderLength }) {
      let name;
      do name = `*D${++anonymous}`;
      while (names.has(name));
      names.add(name);
      const record = handle(),
        begin = handle(),
        end = handle();
      write(records, [
        0,
        'BLOCK_RECORD',
        5,
        record,
        330,
        template.handles.block_record_table,
        100,
        'AcDbSymbolTableRecord',
        100,
        'AcDbBlockTableRecord',
        2,
        name,
        340,
        '0',
      ]);
      const block = { owner: record, out: [], name, begin, end };
      blocks.push(block);
      const values = [
        2,
        name,
        3,
        'DIMSTYLE_1',
        ...xyz(10, defpoint),
        ...xyz(11, mid ?? defpoint),
        70,
        kind | 32,
        71,
        5,
        42,
        measurement,
        1,
        text,
      ];
      if (kind === 0)
        values.push(100, 'AcDbAlignedDimension', ...xyz(13, p1), ...xyz(14, p2), 50, 0, 100, 'AcDbRotatedDimension');
      else
        values.push(
          100,
          kind === 3 ? 'AcDbDiametricDimension' : 'AcDbRadialDimension',
          ...xyz(15, p4),
          40,
          leaderLength ?? 0,
        );
      entity(model, 'DIMENSION', DIM, 'AcDbDimension', ...values);
      return block;
    },
    toString({ placeholders, cover, extents, viewHeight }) {
      const parts = template.parts,
        fill = s =>
          s.replace(/@@([A-Z_]+)@@/g, (match, key) => (key in placeholders ? dxfText(placeholders[key]) : match));
      const blockText = blocks.map(b => {
        const out = [];
        write(out, [
          0,
          'BLOCK',
          5,
          b.begin,
          330,
          b.owner,
          100,
          'AcDbEntity',
          8,
          '0',
          100,
          'AcDbBlockBegin',
          2,
          b.name,
          70,
          1,
          10,
          0,
          20,
          0,
          30,
          0,
          3,
          b.name,
          1,
          '',
        ]);
        out.push(...b.out);
        write(out, [0, 'ENDBLK', 5, b.end, 330, b.owner, 100, 'AcDbEntity', 8, '0', 100, 'AcDbBlockEnd']);
        return out.join('');
      });
      const [x0, y0, x1, y1] = extents;
      const head = parts.head
        .replace('@@HANDSEED@@', next.toString(16).toUpperCase())
        .replace('@@BLOCK_RECORD_COUNT@@', String(template.block_record_count + blocks.length))
        .replace('@@EXTMIN_X@@', real(x0))
        .replace('@@EXTMIN_Y@@', real(y0))
        .replace('@@EXTMAX_X@@', real(x1))
        .replace('@@EXTMAX_Y@@', real(y1))
        .replace('@@VIEW_X@@', real((x0 + x1) / 2))
        .replace('@@VIEW_Y@@', real((y0 + y1) / 2))
        .replace('@@VIEW_H@@', real(viewHeight));
      const dxf = [
        head,
        ...records,
        parts.block_records_end,
        ...blockText,
        parts.blocks_end,
        fill(parts.sheet),
        cover ? fill(parts.cover) : '',
        ...model.out,
        parts.tail,
      ].join('');
      const left = /@@[A-Z_]+@@/.exec(dxf);
      if (left) throw new Error(`圖面範本欄位未填：${left[0]}`);
      return dxf;
    },
  };
  return w;
}

// ───────── layout: view scale and placement from the part size ─────────
const add = (a, b) => [a[0] + b[0], a[1] + b[1]],
  mul = (a, k) => [a[0] * k, a[1] * k],
  polar = deg => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** The hole carrying the n-Ø callout and its edge distances: top right as on the
 * reference; bottom left before bottom right, whose corner holds the 4-R callout. */
function referenceHole(c) {
  const corners = c.hole_corners ?? defaultHoleCorners;
  const key = ['top_right', 'top_left', 'bottom_left', 'bottom_right'].find(k => corners.includes(k));
  return key ? holeCorners[key] : null;
}

function labelLength(main, deviations) {
  let n = glyphs(main) * GLYPH;
  if (deviations) n += Math.max(deviations[0].length, deviations[1].length) * GLYPH * 0.65 + 0.4;
  return n;
}

/**
 * View scale and position. The reference's 3:2 is kept whenever the part fits;
 * larger parts step down through 1:1, 1:2 …. Clearances are the reference's, from
 * the outermost dimension texts of the main view and the section above it.
 */
export function drawingLayout(r) {
  const d = r.design,
    c = d.copper;
  const hole = referenceHole(c);
  const label = (key, value, prefix = '') => {
    const t = drawingTolerance(d, key),
      main = `${prefix}${drawingNumber(value)}${t?.symmetric ?? ''}`;
    return labelLength(main, t?.deviations);
  };
  const Lg = label('copper.base_thickness', c.base_thickness, '*'),
    Lk = label('stack.pad_height', d.stack.pad_height, '4-*');
  for (const [n, dn] of VIEW_SCALES) {
    const s = (n / dn) * SHEET_SCALE;
    const E = c.base_length * s,
      F = c.base_width * s,
      G = c.base_thickness * s,
      C = c.hole_edge_offset * s;
    const by = (r.boss_center?.[1] ?? 0) * s,
      low = r.boss_lower_height * s,
      L = r.boss_total_height * s;
    const callout = hole ? 22.112 - C : 0; // diameter leader + shoulder beyond the hole
    const leftReach = Math.max(15.9, hole?.[0] < 0 ? callout : 0),
      rightReach = Math.max(14.84, hole?.[0] > 0 ? callout : 0);
    const below = hole?.[1] < 0 ? 4 : 0; // labels under the view make room for bottom hole dimensions
    const down = Math.max(10.712 + below, 9.9 - F / 2 - by, hole?.[1] < 0 ? 8.791 + 2.5 - C : 0);
    const sectionBase = 37.707 + Math.max(0, L - 0.48); // section B-B above the main view's top edge
    const up = Math.max(sectionBase + G + 14, sectionBase + G + 0.902 + Lg, sectionBase - low + 5.055 + Lk);
    const xLo = AREA.left + leftReach + E / 2,
      xHi = AREA.right - rightReach - E / 2;
    const yLo = AREA.bottom + down + F / 2,
      yHi = AREA.top - up - F / 2;
    if (xLo <= xHi && yLo <= yHi) {
      const detail = DETAIL_SCALES.find(([a, b]) => c.pad_size * (a / b) * SHEET_SCALE <= 8) ?? DETAIL_SCALES.at(-1);
      return {
        scale: s,
        label: `${n}:${dn}`,
        center: [clamp(MAIN_CENTER[0], xLo, xHi), clamp(MAIN_CENTER[1], yLo, yHi)],
        sectionBase,
        below,
        detail: { scale: (detail[0] / detail[1]) * SHEET_SCALE, label: `${detail[0]}:${detail[1]}` },
      };
    }
  }
  throw new Error('銅塊尺寸超出 A4 圖面可排版範圍（最小比例 1:5）。');
}

/**
 * Dimension tools on a template writer, as on the reference: labels with symmetric or
 * stacked tolerances, filled arrows, and linear DIMENSION entities whose blocks hold
 * the drawn extension lines, dimension line, arrows and text.
 */
export function drawingTools(w, d, exact) {
  const parts = (key, value, prefix) => {
    const t = drawingTolerance(d, key),
      main = `${prefix}${drawingNumber(value)}`;
    return t?.symmetric ? { main: main + t.symmetric, deviations: null } : { main, deviations: t?.deviations ?? null };
  };
  const putLabel = (block, { main, deviations }, start, u, n, angle, end) => {
    const opts = { layer: DIM, rotation: angle };
    if (end && !deviations) return w.text(block, main, add(end, mul(n, GAP)), { ...opts, align: 'right' });
    if (deviations) {
      w.text(block, main, add(start, mul(n, 1.024)), opts);
      const at = add(start, mul(u, glyphs(main) * GLYPH + 0.4));
      w.text(block, deviations[0], add(at, mul(n, 2.138)), { ...opts, height: TOL_H });
      w.text(block, deviations[1], add(at, mul(n, 0.54)), { ...opts, height: TOL_H });
    } else w.text(block, main, add(start, mul(n, GAP)), opts);
  };
  const arrow = (block, tip, angle) => w.insert(block, '_FILLED', tip, { scale: ARROW, rotation: angle });
  const override = (prefix, value, viewExact = exact) =>
    viewExact ? `${prefix}<>` : `${prefix}${drawingNumber(value)}`;

  /** Linear dimension. a, b: attachment points; at: x of a vertical / y of a horizontal dimension line. */
  const linear = (a, b, at, vertical, value, key, prefix = '', o = {}) => {
    const { outside = false, textCenter, textAlign = 'center', extA = true, extB = true, viewExact = exact } = o;
    const [av, bv] = vertical ? [a[1], b[1]] : [a[0], b[0]];
    const lo = Math.min(av, bv),
      hi = Math.max(av, bv);
    const P = vertical ? t => [at, t] : t => [t, at];
    const block = w.dimension(0, {
      defpoint: P(hi),
      mid: P((lo + hi) / 2),
      p1: a,
      p2: b,
      text: override(prefix, value, viewExact),
      measurement: value,
    });
    for (const [p, ok] of [
      [a, extA],
      [b, extB],
    ]) {
      if (!ok) continue;
      if (vertical) {
        const sg = at > p[0] ? 1 : -1;
        w.line(block, [p[0] + sg * EXO, p[1]], [at + sg * EXE, p[1]], DIM);
      } else {
        const sg = at > p[1] ? 1 : -1;
        w.line(block, [p[0], p[1] + sg * EXO], [p[0], at + sg * EXE], DIM);
      }
    }
    const label = parts(key, value, prefix),
      length = labelLength(label.main, label.deviations);
    const centre = textCenter ?? (lo + hi) / 2;
    const t0 = { center: centre - length / 2, end: centre - length, start: centre }[textAlign],
      t1 = t0 + length;
    let span;
    if (outside) {
      arrow(block, P(lo), vertical ? 90 : 0);
      arrow(block, P(hi), vertical ? 270 : 180);
      span = t0 < lo ? [t0, hi + TAIL] : t1 > hi ? [lo - TAIL, t1] : [lo - TAIL, hi + TAIL];
    } else {
      arrow(block, P(lo), vertical ? 270 : 180);
      arrow(block, P(hi), vertical ? 90 : 0);
      span = [Math.min(lo, t0), Math.max(hi, t1)];
    }
    w.line(block, P(span[0]), P(span[1]), DIM);
    const end = textAlign === 'end' ? (vertical ? [at, t1] : [t1, at]) : null;
    if (vertical) putLabel(block, label, [at, t0], [0, 1], [-1, 0], 90, end);
    else putLabel(block, label, [t0, at], [1, 0], [0, 1], 0, end);
  };

  return { parts, putLabel, arrow, override, linear };
}

/**
 * Title block values and the finished DXF text (before the ANSI_950 encoding). The
 * drawing sheet is SHEET 2 OF 2 after the cover, else 1 OF 1.
 */
export function finishSheet(w, template, d, { cover, date, partNo, rev, description }) {
  const y = date.getFullYear(),
    m = date.getMonth() + 1,
    day = date.getDate(),
    two = v => String(v).padStart(2, '0');
  const sheet = template.sheet_box,
    cov = template.cover_box;
  const extents = cover ? [cov[0], 0, sheet[2], Math.max(cov[3], sheet[3])] : sheet;
  const aspect = 2.19; // the reference's initial view (wide screen)
  return w.toString({
    cover,
    extents,
    viewHeight: Math.max(extents[3] - extents[1], (extents[2] - extents[0]) / aspect) * 1.08,
    placeholders: {
      DATE: `${y}/${m}/${day}`,
      DATE_PADDED: `${y}/${two(m)}/${two(day)}`,
      USED_ON: d.project?.name ?? '',
      PART_NO: partNo,
      REV: rev,
      DESCRIPTION: description,
      SHEET: cover ? '2' : '1',
      SHEETS: cover ? '2' : '1',
    },
  });
}

// ───────── the drawing ─────────
/**
 * The copper base drawing as DXF text (Unicode; see copperDrawingDxf for the file bytes).
 * @param r calculate() result
 * @param template parsed copper-drawing-template.json
 * @param options cover: include the cover sheet (SHEET 1 OF 2, drawing 2 OF 2);
 *   date: drawing date; partNo / rev: override the design's part number
 *   (part_numbers.copper: 10-character base under PART NO., 2-digit REV)
 */
export function copperDrawingText(r, template, { cover = true, date = new Date(), partNo, rev } = {}) {
  const d = r.design,
    c = d.copper;
  const number = { ...titleBlockPartNumber(d, 'copper') };
  if (partNo !== undefined) number.partNo = partNo;
  if (rev !== undefined) number.rev = rev;
  const w = templateWriter(template),
    msp = w.model;
  const lay = drawingLayout(r),
    s = lay.scale,
    exact = Math.abs(s - 1) < 1e-9; // 3:2: the sheet measures the part, so "<>" shows the value
  const [CX, CY] = lay.center;
  const E = c.base_length,
    F = c.base_width,
    G = c.base_thickness,
    R = c.corner_radius,
    Dh = c.hole_diameter,
    Ch = c.hole_edge_offset;
  const I = r.boss_length,
    H = r.boss_width,
    J = c.pad_size,
    K = d.stack.pad_height,
    L = r.boss_total_height,
    low = r.boss_lower_height;
  const [bx, by] = r.boss_center ?? [0, 0];
  const left = CX - (E * s) / 2,
    right = CX + (E * s) / 2,
    bottom = CY - (F * s) / 2,
    top = CY + (F * s) / 2;
  const bl = CX + (bx - I / 2) * s,
    br = CX + (bx + I / 2) * s,
    bb = CY + (by - H / 2) * s,
    bt = CY + (by + H / 2) * s;
  const Rs = R * s,
    Js = J * s;

  const { parts, putLabel, arrow, linear } = drawingTools(w, d, exact);
  // ── main view: top view, boss toward the viewer ──
  const footprint = copperFootprint(c);
  const holes = footprint.centers.map(([x, y]) => [CX + x * s, CY + y * s]);
  const separate = footprint.centers.every((a, i) =>
    footprint.centers.slice(i + 1).every(b => Math.hypot(a[0] - b[0], a[1] - b[1]) > Dh + 1e-8),
  );
  if (footprint.closed_holes.every(Boolean) && separate) {
    w.line(msp, [left + Rs, bottom], [right - Rs, bottom]);
    w.line(msp, [right, bottom + Rs], [right, top - Rs]);
    w.line(msp, [right - Rs, top], [left + Rs, top]);
    w.line(msp, [left, top - Rs], [left, bottom + Rs]);
    for (const [p, a0] of [
      [[right - Rs, top - Rs], 0],
      [[left + Rs, top - Rs], 90],
      [[left + Rs, bottom + Rs], 180],
      [[right - Rs, bottom + Rs], 270],
    ])
      w.arc(msp, p, Rs, a0, a0 + 90);
    for (const p of holes) w.circle(msp, p, (Dh / 2) * s);
  } else {
    // Holes breaking through the rounded outline leave notches in the true profile.
    for (const polygon of footprint.profile)
      for (const ring of polygon)
        w.poly(
          msp,
          ring.slice(0, -1).map(([x, y]) => [CX + x * s, CY + y * s]),
        );
  }
  for (const [x, y] of holes) {
    const e = (Dh / 2) * s + 2;
    w.line(msp, [x - e, y], [x + e, y], AXIS);
    w.line(msp, [x, y - e], [x, y + e], AXIS);
  }
  w.poly(msp, [
    [bl, bb],
    [br, bb],
    [br, bt],
    [bl, bt],
  ]);
  for (const [x, y] of [
    [bl, bb],
    [br - Js, bb],
    [bl, bt - Js],
    [br - Js, bt - Js],
  ])
    w.poly(msp, [
      [x, y],
      [x + Js, y],
      [x + Js, y + Js],
      [x, y + Js],
    ]);

  const cutY = CY + by * s;
  linear([left, top - Rs - 0.5], [right, top - Rs - 0.5], top + 9.095, false, E, 'copper.base_length');
  linear([right, top - Rs - 0.5], [br, bt - 2], top + 1.32, false, E / 2 - (bx + I / 2), 'boss.center_from_left', '*', {
    textCenter: br - 3.249,
    textAlign: 'end',
  });
  linear([bl, bt - 2], [br, bt - 2], bt + 1.836, false, I, 'boss.length', '*');
  // boss width: left of the boss as on the reference, right of it when the boss
  // sits close to the left edge (the left holes and the width dimension crowd it)
  if (bl - left >= 12 || bl - left >= right - br - 3)
    linear([bl + 2, bt], [bl + 2, bb], bl - 2.876, true, H, 'boss.width', '*');
  else linear([br - 2, bt], [br - 2, bb], br + 4.6, true, H, 'boss.width', '*');
  linear([left + Rs + 0.5, bottom], [left + Rs + 0.5, top], left - 13.633, true, F, 'copper.base_width');
  const gapTop = F / 2 - (by + H / 2),
    gapLabel = parts('boss.center_from_bottom', gapTop, '*');
  if (labelLength(gapLabel.main, gapLabel.deviations) <= top - bt - 1)
    linear([right - Rs - 0.5, top], [br - 2, bt], right + 9.33, true, gapTop, 'boss.center_from_bottom', '*', {
      outside: true,
    });
  // As the reference's 4.00: text beside the lower extension line, clear of the B-B line;
  // the line moves out past the B-B arrow so the longer text clears the 4-R callout.
  else
    linear([right - Rs - 0.5, top], [br - 2, bt], right + 13.5, true, gapTop, 'boss.center_from_bottom', '*', {
      outside: true,
      textCenter: Math.min(bt - 0.902, cutY - 2),
      textAlign: 'end',
    });

  const ref = referenceHole(c);
  if (ref) {
    const [sx, sy] = ref;
    const h = [CX + sx * (E / 2 - Ch) * s, CY + sy * (F / 2 - Ch) * s];
    const edgeX = sx > 0 ? right : left,
      edgeY = sy > 0 ? top : bottom;
    // hole centre → side edge (horizontal), above (or below) the view
    linear(
      [edgeX, edgeY - sy * (Rs + 0.5)],
      [h[0], h[1] + sy * 2.667],
      edgeY + sy * 5.351,
      false,
      Ch,
      'copper.hole_edge_offset',
      '',
      {
        outside: true,
        textCenter: edgeX - sx * 11.738,
        textAlign: sx > 0 ? 'end' : 'start',
      },
    );
    // hole centre → top (or bottom) edge (vertical), beside the view. The text sits
    // on the far side of the B-B line as on the reference; when the view is too
    // short for that, it moves to the hole's side of the line.
    const holeLabel = parts('copper.hole_edge_offset', Ch, ''),
      length = labelLength(holeLabel.main, holeLabel.deviations);
    let textCenter, textAlign;
    if (sy > 0) {
      textCenter = Math.min(bottom + 16.789, cutY - 2);
      textAlign = 'end';
      if (textCenter - length < bottom + 1)
        textCenter = cutY + 2 + length <= h[1] - 1 ? cutY + 2 + length : bottom + 1 + length;
    } else {
      textCenter = Math.max(top - 16.789, cutY + 2);
      textAlign = 'start';
      if (textCenter + length > top - 1)
        textCenter = cutY - 2 - length >= h[1] + 1 ? cutY - 2 - length : top - 1 - length;
    }
    linear(
      [h[0] + sx * 2.667, h[1]],
      [edgeX - sx * (Rs + 0.5), edgeY],
      edgeX + sx * 3.949,
      true,
      Ch,
      'copper.hole_edge_offset',
      '',
      {
        outside: true,
        textCenter,
        textAlign,
      },
    );
    // n-Ø hole callout: leader through the hole, elbow and shoulder
    const angle =
      (Math.atan2(sy * Math.sin((45.7 * Math.PI) / 180), sx * Math.cos((45.7 * Math.PI) / 180)) * 180) / Math.PI;
    const u = polar(angle),
      radius = (Dh / 2) * s;
    const near = add(h, mul(u, -radius)),
      far = add(h, mul(u, radius)),
      elbow = add(h, [8.581 * sx, 8.791 * sy]);
    const count = holes.length,
      block = w.dimension(3, {
        defpoint: near,
        mid: elbow,
        p4: far,
        text: exact ? `${count}-%%c<>` : `${count}-%%c${drawingNumber(Dh)}`,
        measurement: Dh,
      });
    arrow(block, near, angle);
    arrow(block, far, angle + 180);
    w.line(block, add(near, mul(u, -TAIL)), far, DIM);
    w.line(block, far, elbow, DIM);
    w.line(block, elbow, add(elbow, [sx * 13.531, 0]), DIM);
    // As the reference: "2-", the Ø symbol in its own 2.4 slot, then the value, on one baseline.
    const textX = sx > 0 ? elbow[0] + 1.333 : elbow[0] - 13.531 + 1.333,
      textY = elbow[1] + GAP;
    const xSymbol = textX + (2.411 * arialAdvance(`${count}-`)) / arialAdvance('2-');
    for (const [str, x] of [
      [`${count}-`, textX],
      ['%%c', xSymbol],
      [drawingNumber(Dh), xSymbol + 2.4],
    ])
      w.text(block, str, [x, textY], { layer: DIM });
  }
  {
    // 4-R corner radius, from outside on the bottom-right arc (bottom-left when the
    // n-Ø callout already uses the bottom-right corner); the text reads upward
    const mirror = ref?.[0] > 0 && ref?.[1] < 0,
      angle = mirror ? -140.8 : -39.2;
    const centre = mirror ? [left + Rs, bottom + Rs] : [right - Rs, bottom + Rs],
      u = polar(angle),
      tip = add(centre, mul(u, Rs));
    const block = w.dimension(4, {
      defpoint: centre,
      mid: add(tip, mul(u, 6)),
      p4: tip,
      text: exact ? '4-R<>' : `4-R${drawingNumber(R)}`,
      measurement: R,
    });
    arrow(block, tip, angle + 180);
    w.line(block, tip, add(tip, mul(u, 12.31)), DIM);
    const label = `4-R${drawingNumber(R)}`,
      at = add(tip, mul(u, 3.678));
    if (mirror)
      w.text(block, label, add(at, mul([-u[1], u[0]], -0.449)), { layer: DIM, rotation: angle + 180, align: 'right' });
    else w.text(block, label, add(at, mul([-u[1], u[0]], 0.449)), { layer: DIM, rotation: angle });
  }

  // B-B cutting plane through the boss centre; arrows give the viewing direction
  const x0 = left - 10.192,
    x1 = right + 10.193;
  w.line(msp, [x0, cutY], [x1, cutY], AXIS, 'DASHED');
  for (const x of [x0, x1])
    w.leader([
      [x, cutY - 9.9],
      [x, cutY],
    ]);
  w.text(msp, 'B', [x0 - 2.61, cutY + 1.334], { height: 2.667 });
  w.text(msp, 'B', [x1 + 0.443, cutY + 1.334], { height: 2.667 });
  // detail A boundary on the bottom-right pad, with its label
  const q = Math.max(Js / 1.5, 0.6),
    pc = [br - Js / 2 - 0.743 * q, bb + Js / 2 + 0.077 * q],
    circle = 2.7017 * q;
  w.circle(msp, pc, circle, TXT);
  const shoulder = [pc[0] + 6.116, bottom - 9.812 - lay.below];
  w.leader([add(pc, mul(polar(-76.53), circle)), shoulder, add(shoulder, [1.333, 0])]);
  w.text(msp, '查看細節 ', add(shoulder, [1.333, -0.9]));
  w.text(msp, 'A', add(shoulder, [11.473, -0.9]), { height: 2.667 });
  w.text(msp, '比例 ', [CX - 4.334, bottom - 4.622 - lay.below]);
  w.text(msp, lay.label, [CX + 1.026, bottom - 4.622 - lay.below]);

  // ── section B-B above the main view (third-angle projection: boss faces down) ──
  const sBase = top + lay.sectionBase,
    sTop = sBase + G * s,
    sBoss = sBase - low * s,
    sPad = sBase - L * s;
  const cut = [
    [left, sTop],
    [right, sTop],
    [right, sBase],
    [br, sBase],
    [br, sBoss],
    [bl, sBoss],
    [bl, sBase],
    [left, sBase],
  ];
  w.poly(msp, cut);
  w.hatch(cut);
  for (const xa of [bl, br - Js])
    w.poly(
      msp,
      [
        [xa, sBoss],
        [xa, sPad],
        [xa + Js, sPad],
        [xa + Js, sBoss],
      ],
      false,
    );
  linear([left + 0.5, sTop], [left + 0.5, sBase], left - 5.464, true, G, 'copper.base_thickness', '*', {
    outside: true,
    textCenter: sTop + 0.902,
    textAlign: 'start',
  });
  linear([bl - 2.5, sBoss], [bl - 2.5, sPad], bl - 0.977, true, K, 'stack.pad_height', '4-*', {
    outside: true,
    textCenter: sBoss + 5.055,
    textAlign: 'start',
  });
  linear([br - 1.368, sPad], [right - 3, sBase], br + 4.118, true, L, 'boss.total_height', '*', {
    outside: true,
    textCenter: sPad - 2.064,
    textAlign: 'end',
    extB: false,
  });
  {
    // reference dimension (G+L): overall height
    const xr = right + 5.396,
      total = G + L,
      text = `(${drawingNumber(total)})`;
    const block = w.dimension(0, {
      defpoint: [xr, sTop],
      mid: [xr, sPad - 5.622],
      p1: [br - 0.5, sPad],
      p2: [right - 0.5, sTop],
      text: exact ? '(<>)' : text,
      measurement: total,
    });
    for (const [y, xs] of [
      [sPad, br + 1],
      [sTop, right + 1],
    ])
      w.line(block, [xs, y], [xr + EXE, y], DIM);
    arrow(block, [xr, sPad], 90);
    arrow(block, [xr, sTop], 270);
    const start = sPad - 2.907 - glyphs(text) * GLYPH;
    w.line(block, [xr, start], [xr, sTop + TAIL], DIM);
    putLabel(block, { main: text, deviations: null }, [xr, start], [0, 1], [-1, 0], 90);
  }
  const fcf = (x, y, cells, h = 3.6) => {
    let cx = x;
    for (const [width, value] of cells) {
      w.poly(
        msp,
        [
          [cx, y],
          [cx + width, y],
          [cx + width, y + h],
          [cx, y + h],
        ],
        true,
        TXT,
      );
      if (value === 'flat')
        w.poly(
          msp,
          [
            [cx + 0.9, y + 0.9],
            [cx + 1.95, y + 2.775],
            [cx + 4.725, y + 2.775],
            [cx + 3.675, y + 0.9],
          ],
          true,
          TXT,
        );
      else if (value === 'para') {
        w.line(msp, [cx + 0.9, y + 0.45], [cx + 2.55, y + 3.225], TXT);
        w.line(msp, [cx + 2.025, y + 0.45], [cx + 3.675, y + 3.225], TXT);
      } else w.text(msp, value, [cx + 0.675, y + 0.9]);
      cx += width;
    }
  };
  const Es = E * s;
  // datum A = heatsink face (top of the section): flatness 0.1
  const fx = left + 20.759,
    fy = sTop + 7.658;
  fcf(fx, fy, [
    [6, 'flat'],
    [4.882, '0.1'],
  ]);
  w.text(msp, 'A', [fx + 0.45, fy + 4.5]);
  w.leader([
    [left + Math.min(16.178, Es * 0.5), sTop],
    [fx - 1.333, fy + 1.8],
    [fx, fy + 1.8],
  ]);
  // boss-side face of the base: flatness 0.1, parallel 0.08 to A
  const gx = left + 8.631,
    gy = sBase - 7.588;
  fcf(gx, gy, [
    [6, 'flat'],
    [4.882, '0.1'],
  ]);
  fcf(gx - 3.128, gy - 3.603, [
    [4.95, 'para'],
    [5.607, '0.08'],
    [3.453, 'A'],
  ]);
  w.leader([
    [left + Math.min(4.087, Es * 0.2), sBase],
    [gx - 1.333, gy + 1.8],
    [gx, gy + 1.8],
  ]);
  // surface roughness 1.6: the reference's symbol blocks, triangle tips on the faces
  const faceX =
    right - br >= 9.5
      ? br + 7.932
      : bl - left >= 9.5
        ? bl - 7.932
        : right - br >= bl - left
          ? (br + right) / 2
          : (left + bl) / 2;
  for (const [name, base, tip, x, y] of [
    ['SF0_BL4', [79.586, 116.284], [79.009, 113.589], Math.min(br + 7.655, right - 1), sTop],
    ['SYM_13_BL3', [78.709, 108.299], [79.286, 110.993], faceX, sBase],
  ])
    w.insert(msp, name, add(base, [x - tip[0], y - tip[1]]), { layer: OUTLINE });
  w.text(msp, '截面 ', [CX - 5.844, top + 20.618]);
  w.text(msp, 'B-B', [CX - 0.474, top + 20.618], { height: 2.667 });

  // ── detail A: boss corner with a pad ──
  const k = lay.detail.scale,
    Jk = J * k,
    DX = 127.729,
    DY = 87.165;
  w.line(msp, [DX - Math.max(10.01, Jk + 6.01), DY], [DX, DY]);
  w.line(msp, [DX, DY], [DX, DY + Math.max(9.3, Jk + 5.3)]);
  w.poly(
    msp,
    [
      [DX - Jk, DY],
      [DX - Jk, DY + Jk],
      [DX, DY + Jk],
    ],
    false,
  );
  linear([DX - 0.5, DY], [DX - 0.5, DY + Jk], DX + 4.04, true, J, 'copper.pad_size', '4-*', {
    outside: true,
    textCenter: DY + Jk + 1.277,
    textAlign: 'start',
    viewExact: false,
  });
  linear([DX, DY + 0.5], [DX - Jk, DY + 0.5], DY - 3.362, false, J, 'copper.pad_size', '4-*', {
    outside: true,
    textCenter: DX - Jk - 2.539,
    textAlign: 'end',
    viewExact: false,
  });
  w.text(msp, '細節 ', [126.0, 73.57]);
  w.text(msp, 'A', [131.36, 73.57], { height: 2.667 });
  w.text(msp, '比例 ', [125.57, 70.65]);
  w.text(msp, lay.detail.label, [130.93, 70.65]);

  // ── notes ──
  DRAWING_NOTES.forEach((line, i) => w.text(msp, line, [NOTE_X, NOTE_TOP - i * NOTE_LINE]));

  return finishSheet(w, template, d, {
    cover,
    date,
    partNo: number.partNo,
    rev: number.rev,
    description: `Cu base ${general(E)}*${general(F)}*${general(G + L)}`,
  });
}

/** The copper base drawing as DXF R2000 bytes (code page ANSI_950, as the reference). */
export const copperDrawingDxf = (r, template, options) => encodeDxf(copperDrawingText(r, template, options));
