// Vector PDF of the 2D drawings, rendered from the same DXF text that is downloaded,
// so the PDF and the DXF always show the same drawing.
//
// · Pages: the cover (A4 portrait) when present, then the drawing sheet (A4 landscape).
//   The DXF sheet is the Creo export's A4 at 2/3 scale, so one sheet unit is 1.5 mm.
// · Entities: LINE, ARC, CIRCLE, LWPOLYLINE (bulges), SPLINE (NURBS), SOLID, HATCH
//   (SOLID fill and line patterns such as ANSI31), TEXT, MTEXT, INSERT, DIMENSION
//   (its block) and LEADER (with its arrowhead). Plotted as the reference PDF that
//   AutoCAD printed from this drawing format: everything black and every line a
//   hairline (line width 0), so the DELTA logo, frame and text stay as fine as there.
// · Text: Helvetica (Arial metrics; the reference uses ArialMT) for Latin text;
//   Chinese uses the standard Traditional Chinese sans font MHei-Medium (Adobe-CNS1;
//   the reference uses Microsoft JhengHei), which Acrobat and browsers provide, so
//   no font file is embedded.
// · Watermark (optional): placed like Acrobat's 「新增浮水印」 from a file — the source
//   page's ArtBox (or the whole image) scaled to a share of the page, centred, with
//   opacity and rotation, and drawn first so it lies under the drawing content.

import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';

const MM = 72 / 25.4;
export const A4 = { long: 841.89, short: 595.28 };
// The reference plot draws every layer with line width 0 (the device's finest line).
const PLOT_LINE_WIDTH = 0;
const LINETYPES = {
  DASHED: [0.1, -0.1],
  HIDDEN: [0.1, -0.1],
  CENTER: [0.375, -0.075, 0.075, -0.075],
  PHANTOM: [0.45, -0.05, 0.1, -0.05, 0.1, -0.05],
  DOT: [0, -0.1],
};
// Text as AutoCAD plotted the reference: a DXF text height is the font's capital
// height, so the em size is height / ratio. Styles whose font file is arial.ttf
// plot in Arial; every other style (STANDARD, DELTA, the file-less "Arial") plots in
// Microsoft JhengHei, and the cover's PMingLiU MTEXT in PMingLiU. Ratios measured
// from the reference PDF (e.g. 1.8 → 10.69 pt Arial, 10.12 pt JhengHei on A4).
const FAMILY_RATIO = { arial: 0.716, jhenghei: 0.7566, mingliu: 0.672 };
// Microsoft JhengHei Latin advance widths (1/1000 em) from the font embedded in the
// reference PDF; characters it does not use take the same design's (Segoe UI) widths.
const JHENGHEI_WIDTHS = {
  ' ': 250,
  '!': 270,
  '"': 400,
  '#': 620,
  $: 580,
  '%': 855,
  '&': 861,
  "'": 240,
  '(': 321,
  ')': 321,
  '*': 447,
  '+': 750,
  ',': 230,
  '-': 432,
  '.': 230,
  '/': 417,
  0: 580,
  1: 580,
  2: 580,
  3: 580,
  4: 580,
  5: 580,
  6: 580,
  7: 580,
  8: 580,
  9: 580,
  ':': 230,
  ';': 230,
  '<': 750,
  '=': 750,
  '>': 750,
  '?': 450,
  '@': 1030,
  A: 693,
  B: 614,
  C: 668,
  D: 755,
  E: 544,
  F: 525,
  G: 739,
  H: 763,
  I: 284,
  J: 377,
  K: 636,
  L: 505,
  M: 965,
  N: 805,
  O: 814,
  P: 601,
  Q: 814,
  R: 642,
  S: 572,
  T: 562,
  U: 740,
  V: 667,
  W: 1004,
  X: 646,
  Y: 593,
  Z: 623,
  '[': 321,
  '\\': 400,
  ']': 321,
  '^': 750,
  _: 420,
  '`': 270,
  a: 547,
  b: 634,
  c: 498,
  d: 634,
  e: 563,
  f: 361,
  g: 634,
  h: 609,
  i: 259,
  j: 261,
  k: 539,
  l: 259,
  m: 928,
  n: 608,
  o: 631,
  p: 632,
  q: 634,
  r: 372,
  s: 456,
  t: 363,
  u: 608,
  v: 513,
  w: 775,
  x: 512,
  y: 513,
  z: 481,
  '{': 321,
  '|': 240,
  '}': 321,
  '~': 750,
  '±': 737,
  Ø: 1000,
  '°': 400,
};
const JHENGHEI_LATIN_CAP = 0.7; // capital height of JhengHei's Latin glyphs, in em
const HELVETICA_CAP = 0.718;

// ───────── DXF parsing ─────────
function pairs(text) {
  const lines = text.split(/\r?\n/),
    out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([Number(lines[i].trim()), lines[i + 1]]);
  return out;
}

/** Entities of the ENTITIES section, blocks by name, text styles (name → font file) and header values. */
export function parseDxf(text) {
  const all = pairs(text),
    blocks = new Map(),
    entities = [],
    styles = new Map(),
    header = {};
  let section = null,
    block = null,
    current = null;
  const finish = () => {
    if (!current) return;
    if (current.type === 'STYLE' && section === 'TABLES') {
      const name = current.codes.find(([c]) => c === 2)?.[1];
      if (name !== undefined) styles.set(name.toUpperCase(), current.codes.find(([c]) => c === 3)?.[1] ?? '');
    } else if (block && current.type !== 'BLOCK') block.entities.push(current);
    else if (section === 'ENTITIES') entities.push(current);
    current = null;
  };
  for (let i = 0; i < all.length; i++) {
    const [code, value] = all[i];
    if (code === 0) {
      finish();
      if (value === 'SECTION') {
        section = all[i + 1]?.[1];
        continue;
      }
      if (value === 'ENDSEC') {
        section = null;
        continue;
      }
      if (section === 'HEADER') continue;
      if (section === 'BLOCKS' && value === 'BLOCK') {
        block = { name: '', base: [0, 0], entities: [] };
        current = { type: 'BLOCK', codes: [] };
        continue;
      }
      if (section === 'BLOCKS' && value === 'ENDBLK') {
        if (block) blocks.set(block.name, block);
        block = null;
        continue;
      }
      if (section === 'ENTITIES' || (section === 'BLOCKS' && block) || (section === 'TABLES' && value === 'STYLE'))
        current = { type: value, codes: [] };
      continue;
    }
    if (section === 'HEADER' && code === 9) {
      const next = all[i + 1];
      if (next) header[value.trim()] = Number(next[1]);
      continue;
    }
    if (current?.type === 'BLOCK' && block) {
      if (code === 2) block.name = value;
      if (code === 10) block.base[0] = Number(value);
      if (code === 20) block.base[1] = Number(value);
      continue;
    }
    current?.codes.push([code, value]);
  }
  finish();
  return { entities, blocks, styles, header };
}

const get = (e, code, fallback) => {
  const hit = e.codes.find(([c]) => c === code);
  return hit ? hit[1] : fallback;
};
const num = (e, code, fallback = 0) => {
  const v = get(e, code);
  return v === undefined ? fallback : Number(v);
};
const all = (e, code) => e.codes.filter(([c]) => c === code).map(([, v]) => Number(v));

// ───────── geometry helpers ─────────
const IDENTITY = [1, 0, 0, 1, 0, 0];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const scaleOf = m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
const rad = d => (d * Math.PI) / 180;

/** Cubic Bézier segments (≤ 90° each) of a circular arc, counter-clockwise a0 → a1 (radians). */
function arcCurves(c, r, a0, a1) {
  while (a1 <= a0) a1 += 2 * Math.PI;
  const n = Math.max(1, Math.ceil((a1 - a0) / (Math.PI / 2) - 1e-9)),
    step = (a1 - a0) / n,
    k = (4 / 3) * Math.tan(step / 4);
  const p = a => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = a0 + i * step,
      e = s + step,
      ps = p(s),
      pe = p(e);
    out.push([
      [ps[0] - k * r * Math.sin(s), ps[1] + k * r * Math.cos(s)],
      [pe[0] + k * r * Math.sin(e), pe[1] - k * r * Math.cos(e)],
      pe,
    ]);
  }
  return { start: p(a0), curves: out };
}

/** Points of a NURBS curve (de Boor), sampled per knot span. */
export function splinePoints(degree, knots, control, weights = []) {
  const n = control.length;
  if (n < 2 || knots.length !== n + degree + 1) return control;
  const w = i => weights[i] ?? 1;
  const point = t => {
    let k = degree;
    while (k < n - 1 && t >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= degree; j++) {
      const i = k - degree + j,
        wi = w(i);
      d.push([control[i][0] * wi, control[i][1] * wi, wi]);
    }
    for (let r = 1; r <= degree; r++)
      for (let j = degree; j >= r; j--) {
        const i = k - degree + j,
          denom = knots[i + degree - r + 1] - knots[i],
          a = denom ? (t - knots[i]) / denom : 0;
        d[j] = d[j].map((v, q) => (1 - a) * d[j - 1][q] + a * v);
      }
    return [d[degree][0] / d[degree][2], d[degree][1] / d[degree][2]];
  };
  const t0 = knots[degree],
    t1 = knots[n],
    out = [];
  for (let k = degree; k < n; k++) {
    const a = knots[k],
      b = knots[k + 1];
    if (b <= a) continue;
    for (let s = 0; s < 8; s++) out.push(point(a + ((b - a) * s) / 8));
  }
  out.push(point(t1 - (t1 - t0) * 1e-12));
  return out;
}

// ───────── text ─────────
const WIN_ANSI = ch => {
  const c = ch.codePointAt(0);
  return (c >= 32 && c <= 126) || (c >= 160 && c <= 255);
};
export function dxfString(s) {
  return String(s)
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (m, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%');
}
/** Plain text of an MTEXT value (formatting codes removed; \P = new line). */
export function mtextPlain(s) {
  return dxfString(s)
    .replace(/\\P/g, '\n')
    .replace(/\\~/g, ' ')
    .replace(/\\[ACFHQTWcfhpqtw][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*);/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\\\\/g, '\\');
}

/** Font family of a text: arial for styles with arial.ttf, else jhenghei (see FAMILY_RATIO). */
export function textFamily(doc, style, mtext = '') {
  const font = /\\f([^|;]+)/i.exec(mtext)?.[1] ?? '';
  if (/mingliu/i.test(font)) return 'mingliu';
  if (/arial/i.test(font)) return 'arial';
  return /arial/i.test(doc.styles?.get(String(style ?? 'STANDARD').toUpperCase()) ?? '') ? 'arial' : 'jhenghei';
}

// ───────── content stream writer ─────────
const fmt = v => {
  if (!Number.isFinite(v)) throw new Error(`PDF 數值無效：${v}`);
  const s = (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

class Canvas {
  constructor(fonts, unitMm) {
    this.ops = [];
    this.fonts = fonts;
    this.unitMm = unitMm; // paper mm per sheet unit
    this.style = null;
  }
  setStroke(layer, ltype, ltscale) {
    const width = PLOT_LINE_WIDTH;
    const pattern = LINETYPES[ltype?.toUpperCase?.()];
    const dash = pattern ? pattern.map(v => Math.max(Math.abs(v) * ltscale, 0.15 / this.unitMm)) : [];
    const key = `${width}|${dash.join(',')}`;
    if (key === this.style) return;
    this.style = key;
    this.ops.push(`${fmt(width)} w [${dash.map(fmt).join(' ')}] 0 d`);
  }
  path(segments, closed, mode = 'S') {
    if (!segments.length) return;
    const out = [];
    for (const seg of segments) {
      if (seg[0] === 'M') out.push(`${fmt(seg[1][0])} ${fmt(seg[1][1])} m`);
      else if (seg[0] === 'L') out.push(`${fmt(seg[1][0])} ${fmt(seg[1][1])} l`);
      else
        out.push(
          `${seg
            .slice(1)
            .flatMap(p => [fmt(p[0]), fmt(p[1])])
            .join(' ')} c`,
        );
    }
    if (closed) out.push('h');
    out.push(mode);
    this.ops.push(out.join(' '));
  }
  /**
   * Text runs on one baseline, in the family the reference plot used for the style:
   * arial → Helvetica (Arial metrics); jhenghei → Latin in Helvetica glyphs placed on
   * Microsoft JhengHei's advances and capital height; mingliu → Times-Roman; Chinese
   * in the standard CNS1 fonts (MHei-Medium sans, MSung-Light for PMingLiU).
   */
  text(str, origin, { height, rotation = 0, widthFactor = 1, halign = 0, valign = 0, family = 'arial' }) {
    if (!str || height <= 0) return;
    const em = height / FAMILY_RATIO[family],
      cjkEm = height / FAMILY_RATIO[family === 'mingliu' ? 'mingliu' : 'jhenghei'],
      runs = [];
    for (const ch of str) {
      const latin = WIN_ANSI(ch),
        last = runs.at(-1);
      if (last && last.latin === latin) last.text += ch;
      else runs.push({ latin, text: ch });
    }
    const helvetica = this.fonts.latin,
      times = this.fonts.serif;
    for (const run of runs) {
      const chars = [...run.text];
      if (!run.latin) {
        run.font = family === 'mingliu' ? '/F4' : '/F2';
        run.size = cjkEm;
        run.advances = chars.map(() => cjkEm);
        run.glyphs = [ucs2(run.text)];
      } else if (family === 'jhenghei') {
        // Helvetica glyphs with JhengHei's capital height, spaced on JhengHei's advances
        run.font = '/F1';
        run.size = (em * JHENGHEI_LATIN_CAP) / HELVETICA_CAP;
        run.advances = chars.map(ch => ((JHENGHEI_WIDTHS[ch] ?? helvetica.widthOfTextAtSize(ch, 1000)) / 1000) * em);
        run.glyphs = chars.map(ch => helvetica.encodeText(ch).toString());
        run.natural = chars.map(ch => helvetica.widthOfTextAtSize(ch, run.size));
      } else if (family === 'mingliu') {
        run.font = '/F3';
        run.size = em * 0.95;
        run.advances = chars.map(ch => times.widthOfTextAtSize(ch, em) * 0.912);
        run.glyphs = chars.map(ch => times.encodeText(ch).toString());
        run.natural = chars.map(ch => times.widthOfTextAtSize(ch, run.size));
      } else {
        run.font = '/F1';
        run.size = em;
        run.advances = chars.map(ch => helvetica.widthOfTextAtSize(ch, em));
        run.glyphs = [helvetica.encodeText(run.text).toString()];
      }
      run.width = run.advances.reduce((sum, v) => sum + v, 0) * widthFactor;
    }
    const total = runs.reduce((sum, r) => sum + r.width, 0);
    const dx = -total * [0, 0.5, 1, 0, 0.5, 0][halign],
      dy = -height * [0, 0, 0.5, 1][valign];
    const a = rad(rotation),
      cs = Math.cos(a),
      sn = Math.sin(a);
    let x = dx;
    const parts = ['BT'];
    for (const run of runs) {
      const p = [origin[0] + cs * x - sn * dy, origin[1] + sn * x + cs * dy];
      const matrix = `${fmt(cs)} ${fmt(sn)} ${fmt(-sn)} ${fmt(cs)} ${fmt(p[0])} ${fmt(p[1])} Tm`;
      if (run.natural)
        // each glyph stretched to the advance of the plotted font: even spacing, same extent
        parts.push(
          `${run.font} ${fmt(run.size)} Tf ${matrix} ${run.glyphs
            .map((g, i) => `${fmt((run.advances[i] / Math.max(run.natural[i], 1e-9)) * widthFactor * 100)} Tz ${g} Tj`)
            .join(' ')}`,
        );
      else parts.push(`${run.font} ${fmt(run.size)} Tf ${fmt(widthFactor * 100)} Tz ${matrix} ${run.glyphs[0]} Tj`);
      x += run.width;
    }
    parts.push('ET');
    this.ops.push(parts.join(' '));
  }
}
const ucs2 = s =>
  `<${[...s]
    .map(ch => {
      const c = ch.codePointAt(0);
      return (c > 0xffff ? 0x3f : c).toString(16).padStart(4, '0');
    })
    .join('')}>`;

// ───────── entity rendering ─────────
function renderEntities(entities, m, canvas, doc, depth = 0) {
  if (depth > 8) return;
  const ltscale = doc.header.$LTSCALE || 1;
  for (const e of entities) {
    const layer = get(e, 8, '0'),
      ltype = get(e, 6),
      s = scaleOf(m);
    const stroke = () => canvas.setStroke(layer, ltype, ltscale * num(e, 48, 1) * s);
    switch (e.type) {
      case 'LINE': {
        stroke();
        canvas.path(
          [
            ['M', apply(m, [num(e, 10), num(e, 20)])],
            ['L', apply(m, [num(e, 11), num(e, 21)])],
          ],
          false,
        );
        break;
      }
      case 'CIRCLE':
      case 'ARC': {
        stroke();
        const c = [num(e, 10), num(e, 20)],
          r = num(e, 40);
        const circle = e.type === 'CIRCLE';
        const { start, curves } = circle
          ? arcCurves(c, r, 0, 2 * Math.PI)
          : arcCurves(c, r, rad(num(e, 50)), rad(num(e, 51)));
        canvas.path(
          [['M', apply(m, start)], ...curves.map(([c1, c2, p]) => ['C', apply(m, c1), apply(m, c2), apply(m, p)])],
          circle,
        );
        break;
      }
      case 'LWPOLYLINE': {
        stroke();
        const closed = (num(e, 70) & 1) === 1;
        const vertices = [];
        for (const [code, value] of e.codes) {
          if (code === 10) vertices.push({ p: [Number(value), 0], bulge: 0 });
          else if (code === 20 && vertices.length) vertices.at(-1).p[1] = Number(value);
          else if (code === 42 && vertices.length) vertices.at(-1).bulge = Number(value);
        }
        canvas.path(polylineSegments(vertices, closed, m), closed);
        break;
      }
      case 'SPLINE': {
        stroke();
        const xs = all(e, 10),
          ys = all(e, 20);
        const control = xs.map((x, i) => [x, ys[i]]);
        const points = splinePoints(num(e, 71, 3), all(e, 40), control, all(e, 41));
        canvas.path(
          points.map((p, i) => [i ? 'L' : 'M', apply(m, p)]),
          false,
        );
        break;
      }
      case 'SOLID': {
        const corner = k => apply(m, [num(e, 10 + k), num(e, 20 + k)]);
        const [a, b, c, d] = [0, 1, 2, 3].map(corner);
        canvas.path(
          [
            ['M', a],
            ['L', b],
            ['L', d],
            ['L', c],
          ],
          true,
          'f',
        );
        break;
      }
      case 'HATCH':
        renderHatch(e, m, canvas, layer, ltscale);
        break;
      case 'TEXT': {
        const align = [num(e, 72), num(e, 73)];
        const at = align[0] || align[1] ? [num(e, 11), num(e, 21)] : [num(e, 10), num(e, 20)];
        drawText(canvas, m, dxfString(get(e, 1, '')), at, {
          height: num(e, 40),
          rotation: num(e, 50),
          widthFactor: num(e, 41, 1),
          halign: [0, 1, 2, 0, 1, 0][align[0]] ?? 0,
          valign: align[0] === 4 ? 2 : align[1],
          family: textFamily(doc, get(e, 7)),
        });
        break;
      }
      case 'MTEXT': {
        const raw = e.codes
            .filter(([c]) => c === 3 || c === 1)
            .map(([, v]) => v)
            .join(''),
          text = mtextPlain(raw),
          family = textFamily(doc, get(e, 7), raw);
        const attach = num(e, 71, 1) - 1,
          height = num(e, 40);
        const dir =
          get(e, 11) !== undefined
            ? (Math.atan2(num(e, 21), num(e, 11)) * 180) / Math.PI
            : (num(e, 50) * 180) / Math.PI;
        const lines = text.split('\n');
        const spacing = height * 1.6667,
          rowsBelow = (lines.length - 1) * spacing,
          vrow = Math.floor(attach / 3);
        // first baseline below the insertion point for top, middle and bottom attachment
        const first = [-height, -(height + rowsBelow) / 2, -rowsBelow][vrow];
        const a = rad(dir);
        lines.forEach((line, i) => {
          const off = first - i * spacing;
          drawText(canvas, m, line, [num(e, 10) - Math.sin(a) * off, num(e, 20) + Math.cos(a) * off], {
            height,
            rotation: dir,
            halign: attach % 3,
            family,
          });
        });
        break;
      }
      case 'INSERT': {
        const block = doc.blocks.get(get(e, 2));
        if (!block) break;
        const sx = num(e, 41, 1),
          sy = num(e, 42, 1),
          a = rad(num(e, 50)),
          [bx, by] = block.base;
        const local = [
          Math.cos(a) * sx,
          Math.sin(a) * sx,
          -Math.sin(a) * sy,
          Math.cos(a) * sy,
          num(e, 10) - (Math.cos(a) * sx * bx - Math.sin(a) * sy * by),
          num(e, 20) - (Math.sin(a) * sx * bx + Math.cos(a) * sy * by),
        ];
        renderEntities(block.entities, multiply(m, local), canvas, doc, depth + 1);
        break;
      }
      case 'DIMENSION': {
        const block = doc.blocks.get(get(e, 2));
        if (block) renderEntities(block.entities, m, canvas, doc, depth + 1);
        break;
      }
      case 'LEADER': {
        stroke();
        const xs = all(e, 10),
          ys = all(e, 20);
        const points = xs.map((x, i) => apply(m, [x, ys[i]]));
        canvas.path(
          points.map((p, i) => [i ? 'L' : 'M', p]),
          false,
        );
        if (num(e, 71, 1) && points.length > 1) {
          const arrow = doc.blocks.get('_FILLED'),
            size = (doc.header.$DIMASZ || 1.6667) * (doc.header.$DIMSCALE || 1) * s;
          const [p0, p1] = points,
            a = Math.atan2(p0[1] - p1[1], p0[0] - p1[0]);
          if (arrow)
            renderEntities(
              arrow.entities,
              [Math.cos(a) * size, Math.sin(a) * size, -Math.sin(a) * size, Math.cos(a) * size, p0[0], p0[1]],
              canvas,
              doc,
              depth + 1,
            );
        }
        break;
      }
      default:
        break;
    }
  }
}

function polylineSegments(vertices, closed, m) {
  if (!vertices.length) return [];
  const out = [['M', apply(m, vertices[0].p)]];
  const count = closed ? vertices.length : vertices.length - 1;
  for (let i = 0; i < count; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length];
    if (!a.bulge) {
      out.push(['L', apply(m, b.p)]);
      continue;
    }
    // bulge = tan(θ/4), positive = counter-clockwise; sagitta s = bulge · chord / 2
    const chord = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]),
      sagitta = (a.bulge * chord) / 2,
      signed = ((chord / 2) ** 2 + sagitta ** 2) / (2 * sagitta),
      r = Math.abs(signed);
    const mid = [(a.p[0] + b.p[0]) / 2, (a.p[1] + b.p[1]) / 2],
      u = [(b.p[0] - a.p[0]) / chord, (b.p[1] - a.p[1]) / chord];
    const c = [mid[0] - u[1] * (signed - sagitta), mid[1] + u[0] * (signed - sagitta)];
    const a0 = Math.atan2(a.p[1] - c[1], a.p[0] - c[0]),
      a1 = Math.atan2(b.p[1] - c[1], b.p[0] - c[0]);
    if (a.bulge > 0)
      for (const [c1, c2, p] of arcCurves(c, r, a0, a1).curves)
        out.push(['C', apply(m, c1), apply(m, c2), apply(m, p)]);
    else {
      // clockwise a → b: the counter-clockwise arc b → a, walked backwards
      const { start, curves } = arcCurves(c, r, a1, a0);
      const pts = [start, ...curves.map(x => x[2])];
      for (let k = curves.length - 1; k >= 0; k--)
        out.push(['C', apply(m, curves[k][1]), apply(m, curves[k][0]), apply(m, pts[k])]);
    }
  }
  return out;
}

/** HATCH boundary loops (polyline paths and line / arc edges) as path segments. */
function hatchLoops(e, m) {
  const codes = e.codes,
    loops = [];
  let i = codes.findIndex(([c]) => c === 91);
  if (i < 0) return loops;
  const count = Number(codes[i][1]);
  i++;
  const next = code => {
    while (i < codes.length && codes[i][0] !== code) i++;
    return i < codes.length ? Number(codes[i++][1]) : 0;
  };
  for (let l = 0; l < count; l++) {
    const flags = next(92);
    if (flags & 2) {
      const hasBulge = next(72),
        n = next(93),
        vertices = [];
      for (let k = 0; k < n; k++) {
        const x = next(10),
          y = next(20),
          bulge = hasBulge ? next(42) : 0;
        vertices.push({ p: [x, y], bulge });
      }
      loops.push(polylineSegments(vertices, true, m));
    } else {
      const n = next(93),
        segments = [];
      for (let k = 0; k < n; k++) {
        const type = next(72);
        if (type === 1) {
          const a = [next(10), next(20)],
            b = [next(11), next(21)];
          if (!segments.length) segments.push(['M', apply(m, a)]);
          segments.push(['L', apply(m, b)]);
        } else if (type === 2) {
          const c = [next(10), next(20)],
            r = next(40),
            a0 = next(50),
            a1 = next(51),
            ccw = next(73);
          const arc = ccw ? arcCurves(c, r, rad(a0), rad(a1)) : arcCurves(c, r, rad(-a1), rad(-a0));
          if (!segments.length) segments.push(['M', apply(m, arc.start)]);
          for (const [c1, c2, p] of arc.curves) segments.push(['C', apply(m, c1), apply(m, c2), apply(m, p)]);
        }
      }
      loops.push(segments);
    }
    // skip the source boundary objects of this loop
    const sources = next(97);
    for (let k = 0; k < sources; k++) next(330);
  }
  return loops;
}

function renderHatch(e, m, canvas, layer, ltscale) {
  const loops = hatchLoops(e, m).filter(l => l.length);
  if (!loops.length) return;
  const segments = loops.flat();
  if (num(e, 70) === 1 || get(e, 2) === 'SOLID') {
    canvas.path(segments, true, 'f*');
    return;
  }
  // Pattern lines clipped to the boundary (pattern data follows code 78).
  const codes = e.codes,
    start = codes.findIndex(([c]) => c === 78);
  if (start < 0) return;
  const lines = [];
  for (let i = start + 1; i < codes.length; i++) {
    const [c, v] = codes[i];
    if (c === 53) lines.push({ angle: Number(v), base: [0, 0], offset: [0, 0] });
    else if (lines.length && c === 43) lines.at(-1).base[0] = Number(v);
    else if (lines.length && c === 44) lines.at(-1).base[1] = Number(v);
    else if (lines.length && c === 45) lines.at(-1).offset[0] = Number(v);
    else if (lines.length && c === 46) lines.at(-1).offset[1] = Number(v);
    else if (c === 98) break;
  }
  const xs = segments.flatMap(s => s.slice(1).map(p => p[0])),
    ys = segments.flatMap(s => s.slice(1).map(p => p[1]));
  const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    diagonal = Math.hypot(box[2] - box[0], box[3] - box[1]);
  canvas.ops.push('q');
  canvas.path(segments, true, 'W* n');
  canvas.style = null;
  canvas.setStroke(layer, null, ltscale);
  const s = scaleOf(m);
  for (const line of lines) {
    const a = rad(line.angle),
      u = [Math.cos(a), Math.sin(a)],
      base = apply(m, line.base),
      off = [line.offset[0] * s, line.offset[1] * s];
    const spacing = Math.abs(off[0] * -u[1] + off[1] * u[0]);
    if (spacing < 1e-6) continue;
    const n = [-u[1], u[0]],
      centre = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    const first = Math.floor(((centre[0] - base[0]) * n[0] + (centre[1] - base[1]) * n[1] - diagonal) / spacing),
      last = Math.ceil(((centre[0] - base[0]) * n[0] + (centre[1] - base[1]) * n[1] + diagonal) / spacing);
    const segs = [];
    for (let k = first; k <= last; k++) {
      const o = [base[0] + n[0] * spacing * k, base[1] + n[1] * spacing * k];
      const t = (centre[0] - o[0]) * u[0] + (centre[1] - o[1]) * u[1];
      segs.push(['M', [o[0] + u[0] * (t - diagonal), o[1] + u[1] * (t - diagonal)]]);
      segs.push(['L', [o[0] + u[0] * (t + diagonal), o[1] + u[1] * (t + diagonal)]]);
    }
    canvas.path(segs, false);
  }
  canvas.ops.push('Q');
  canvas.style = null;
}

function drawText(canvas, m, text, at, { height, rotation = 0, widthFactor = 1, halign = 0, valign = 0, family }) {
  const p = apply(m, at),
    s = scaleOf(m),
    mirrored = m[0] * m[3] - m[1] * m[2] < 0;
  const dir = apply([m[0], m[1], m[2], m[3], 0, 0], [Math.cos(rad(rotation)), Math.sin(rad(rotation))]);
  canvas.text(text, p, {
    height: height * s,
    rotation: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI + (mirrored ? 180 : 0),
    widthFactor,
    halign,
    valign,
    family,
  });
}

// ───────── document ─────────
/**
 * A standard Traditional Chinese font (Adobe-CNS1, not embedded): MHei-Medium (sans,
 * for JhengHei) or MSung-Light (serif, for PMingLiU). ASCII CIDs are half width.
 */
async function cjkFont(pdf, name) {
  const sans = name === 'MHei-Medium';
  const descriptor = pdf.context.register(
    pdf.context.obj({
      Type: 'FontDescriptor',
      FontName: name,
      Flags: sans ? 4 : 6,
      FontBBox: sans ? [-45, -250, 1015, 887] : [-160, -249, 1015, 888],
      ItalicAngle: 0,
      Ascent: 880,
      Descent: -120,
      CapHeight: 880,
      StemV: 93,
    }),
  );
  const descendant = pdf.context.register(
    pdf.context.obj({
      Type: 'Font',
      Subtype: 'CIDFontType0',
      BaseFont: name,
      CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('CNS1'), Supplement: 0 },
      FontDescriptor: descriptor,
      DW: 1000,
      W: [1, 95, 500],
    }),
  );
  return pdf.context.register(
    pdf.context.obj({
      Type: 'Font',
      Subtype: 'Type0',
      BaseFont: `${name}-UniCNS-UCS2-H`,
      Encoding: 'UniCNS-UCS2-H',
      DescendantFonts: [descendant],
    }),
  );
}

/** Watermark source → { kind, embed(pdf) } (PDF page by its ArtBox, or a PNG/JPEG image). */
export async function loadWatermark(bytes, type = '') {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = String.fromCharCode(...data.slice(0, 8));
  if (head.startsWith('%PDF') || /pdf/i.test(type)) {
    const source = await PDFDocument.load(data, { ignoreEncryption: true });
    if (!source.getPageCount()) throw new Error('浮水印 PDF 沒有頁面。');
    return { kind: 'pdf', source };
  }
  if (head.startsWith('\x89PNG')) return { kind: 'png', data };
  if (data[0] === 0xff && data[1] === 0xd8) return { kind: 'jpg', data };
  throw new Error('浮水印檔案須為 PDF、PNG 或 JPG。');
}

export const DEFAULT_WATERMARK_APPEARANCE = { scale: 80, opacity: 50, rotation: 0 };

/** Size and position of a watermark on a page, as Acrobat's 「相對於目標頁面的比例」. */
export function watermarkPlacement(box, page, { scale = 80, rotation = 0 } = {}) {
  const s = (Math.max(1, Math.min(100, scale)) / 100) * Math.min(page[0] / box[0], page[1] / box[1]);
  const w = box[0] * s,
    h = box[1] * s,
    a = rad(rotation);
  // drawn from its lower-left corner and rotated about it: shift so the centre stays put
  const cx = page[0] / 2,
    cy = page[1] / 2;
  const x = cx - (Math.cos(a) * w) / 2 + (Math.sin(a) * h) / 2,
    y = cy - (Math.sin(a) * w) / 2 - (Math.cos(a) * h) / 2;
  return { x, y, width: w, height: h, scale: s, rotation };
}

/**
 * The watermark content stream of a page, drawn before the drawing so it lies
 * underneath (Acrobat 「顯示在頁面後方」). A PDF watermark is wrapped in a transparency
 * group, as Acrobat does, so the opacity applies to the whole artwork even when the
 * source sets its own graphics state.
 */
async function watermarkContent(pdf, page, watermark, appearance) {
  const size = [page.getWidth(), page.getHeight()],
    opacity = Math.max(0, Math.min(100, appearance.opacity ?? 50)) / 100;
  let object, box;
  if (watermark.kind === 'pdf') {
    const src = watermark.source.getPage(0),
      art = src.getArtBox();
    const embedded = await pdf.embedPage(src, {
      left: art.x,
      bottom: art.y,
      right: art.x + art.width,
      top: art.y + art.height,
    });
    box = [embedded.width, embedded.height];
    object = pdf.context.register(
      pdf.context.flateStream('/WM Do', {
        Type: 'XObject',
        Subtype: 'Form',
        BBox: [0, 0, box[0], box[1]],
        Group: { Type: 'Group', S: 'Transparency' },
        Resources: { XObject: { WM: embedded.ref } },
      }),
    );
  } else {
    const image = watermark.kind === 'png' ? await pdf.embedPng(watermark.data) : await pdf.embedJpg(watermark.data);
    box = [image.width, image.height];
    object = image.ref;
  }
  const p = watermarkPlacement(box, size, appearance),
    a = rad(p.rotation),
    cs = Math.cos(a),
    sn = Math.sin(a);
  // form space is the source box; image space is the unit square
  const [sx, sy] = watermark.kind === 'pdf' ? [p.scale, p.scale] : [p.width, p.height];
  page.node.setXObject(PDFName.of('Wm0'), object);
  page.node.setExtGState(
    PDFName.of('GSwm'),
    pdf.context.register(pdf.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity })),
  );
  return [
    '/Artifact <</Type /Pagination /Subtype /Watermark>> BDC',
    'q',
    `${fmt(cs * sx)} ${fmt(sn * sx)} ${fmt(-sn * sy)} ${fmt(cs * sy)} ${fmt(p.x)} ${fmt(p.y)} cm`,
    '/GSwm gs',
    '/Wm0 Do',
    'Q',
    'EMC',
  ].join('\n');
}

/**
 * PDF of a drawing DXF on the template's sheet (and cover, when the DXF has one).
 * @param dxfText the drawing's DXF text (before code-page encoding)
 * @param template copper-drawing-template.json (sheet_box / cover_box)
 * @param options cover, title, watermark (from loadWatermark), appearance
 */
export async function drawingPdf(
  dxfText,
  template,
  { cover = true, title = '', watermark = null, appearance = DEFAULT_WATERMARK_APPEARANCE } = {},
) {
  const doc = parseDxf(dxfText);
  const pdf = await PDFDocument.create();
  pdf.setTitle(title || 'Drawing');
  pdf.setCreator('PA Copper CAD');
  pdf.setProducer('PA Copper CAD (pdf-lib)');
  const latin = await pdf.embedFont(StandardFonts.Helvetica),
    serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const cjk = await cjkFont(pdf, 'MHei-Medium'),
    cjkSerif = await cjkFont(pdf, 'MSung-Light');
  const pages = [];
  if (cover) pages.push({ box: template.cover_box, size: [A4.short, A4.long] });
  pages.push({ box: template.sheet_box, size: [A4.long, A4.short] });
  for (const { box, size } of pages) {
    const page = pdf.addPage(size);
    if (watermark)
      page.node.addContentStream(
        pdf.context.register(pdf.context.flateStream(await watermarkContent(pdf, page, watermark, appearance))),
      );
    const k = Math.min(size[0] / (box[2] - box[0]), size[1] / (box[3] - box[1]));
    const canvas = new Canvas({ latin, serif }, k / MM);
    renderEntities(doc.entities, IDENTITY, canvas, doc);
    const content = [
      'q',
      `${fmt(k)} 0 0 ${fmt(k)} ${fmt(-box[0] * k)} ${fmt(-box[1] * k)} cm`,
      '0 G 0 g 1 J 1 j',
      ...canvas.ops,
      'Q',
    ].join('\n');
    const stream = pdf.context.register(pdf.context.flateStream(content));
    page.node.setFontDictionary(PDFName.of('F1'), latin.ref);
    page.node.setFontDictionary(PDFName.of('F2'), cjk);
    page.node.setFontDictionary(PDFName.of('F3'), serif.ref);
    page.node.setFontDictionary(PDFName.of('F4'), cjkSerif);
    page.node.addContentStream(stream);
  }
  // Plain object dictionaries (no object streams): readable by every PDF reader.
  return pdf.save({ useObjectStreams: false });
}
