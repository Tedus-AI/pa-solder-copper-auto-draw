// Solder preform 2D drawing in the company format of the copper drawing (drawing
// 348001J40001: A4 frame, title block, optional cover sheet, part number and REV).
//
// Layout of the approved preform drawing: the top view (W × X with four 45° chamfers
// Y) with X on the left, W below and both chamfer legs at the top-right corner; the
// side view (thickness Z, chamfer edges) to its right with Z above it; the notes
// under the side view and the scale under the top view. Every size is a critical
// dimension (*). Dimensions are DIMENSION entities drawn with the copper drawing's
// tools, so arrows, extension lines, text and stacked tolerances look the same.
// The approved drawing is at 3:1; larger preforms step down like the copper drawing.

import { templateWriter, drawingTools, finishSheet, encodeDxf, general, DRAWING_SHEET } from './copper-drawing.js';
import { titleBlockPartNumber } from './part-numbers.js';

const { AREA, NOTE_LINE, SHEET_SCALE } = DRAWING_SHEET;
const VIEW_SCALES = [
  [3, 1],
  [2, 1],
  [3, 2],
  [1, 1],
  [1, 2],
];
// Positions of the approved drawing, in sheet units from the top view's edges.
const X_DIM = 5.7, // X dimension line left of the view
  W_DIM = 5.7, // W dimension line below the view
  CHAMFER_TOP = 4.5, // horizontal chamfer leg above the top edge
  CHAMFER_RIGHT = 4.9, // vertical chamfer leg right of the right edge
  SIDE_GAP = 32, // top view right edge → side view
  Z_DIM = 2.6, // Z dimension line above the side view
  TEXT_GAP = 2.4, // arrow tip → text end for dimensions with outside arrows
  NOTE_OFFSET = 16.4, // notes start, right of the top view
  NOTE_DROP = 14.1, // first note baseline below the top view
  SCALE_DROP = 14.1, // scale label below the top view
  NOTE_WIDTH = 70, // longest note (Arial 1.8)
  LEFT_REACH = 9.5, // X text left of the view
  TOP_REACH = 7; // chamfer text above the view
const FRAME = { left: 6, right: 192 };

export const PREFORM_NOTES = [
  'Note:',
  '1.Material:96.5Sn3Ag0.5Cu COATED WITH 0.5%F8 FLUX',
  "2. MUST MEET DELTA's SPEC :10000-0002 and 10000-0094",
  "3. MUST MEET DELTA's SPEC :10000-0162",
  '4.THE MARK "*" ARE CRITICAL DIMENSIONS IN THE PART.',
];

/** Thickness Z as drawn: the selected trial thickness to 2 decimals, as in the tool. */
export const drawnThickness = r => Number(r.model_thickness.toFixed(2));

/** View scale and top view position for the preform size (3:1 when it fits). */
export function preformDrawingLayout(r) {
  const W = r.boss_length,
    X = r.boss_width;
  const bottomReach = NOTE_DROP + (PREFORM_NOTES.length - 1) * NOTE_LINE + 1;
  for (const [n, dn] of VIEW_SCALES) {
    const s = (n / dn) * SHEET_SCALE;
    const width = LEFT_REACH + W * s + NOTE_OFFSET + NOTE_WIDTH,
      height = TOP_REACH + X * s + bottomReach;
    if (width <= FRAME.right - FRAME.left && height <= AREA.top - AREA.bottom) {
      const left = FRAME.left + (FRAME.right - FRAME.left - width) / 2 + LEFT_REACH;
      const top = AREA.top - (AREA.top - AREA.bottom - height) / 2 - TOP_REACH;
      return { scale: s, label: `${n}:${dn}`, left, top };
    }
  }
  throw new Error('錫片尺寸超出 A4 圖面可排版範圍（最小比例 1:2）。');
}

/**
 * The preform drawing as DXF text (Unicode; preformDrawingDxf gives the file bytes).
 * @param options cover: include the cover sheet; date: drawing date;
 *   partNo / rev: override the design's part_numbers.preform
 */
export function preformDrawingText(r, template, { cover = true, date = new Date(), partNo, rev } = {}) {
  const d = r.design;
  const number = { ...titleBlockPartNumber(d, 'preform') };
  if (partNo !== undefined) number.partNo = partNo;
  if (rev !== undefined) number.rev = rev;
  const w = templateWriter(template),
    msp = w.model;
  const lay = preformDrawingLayout(r),
    s = lay.scale;
  const { linear } = drawingTools(w, d, false);
  const W = r.boss_length,
    X = r.boss_width,
    Y = d.preform.chamfer,
    Z = drawnThickness(r);
  const left = lay.left,
    right = left + W * s,
    top = lay.top,
    bottom = top - X * s,
    y = Y * s;

  // ── top view: octagon with four 45° chamfers ──
  w.poly(msp, [
    [left + y, bottom],
    [right - y, bottom],
    [right, bottom + y],
    [right, top - y],
    [right - y, top],
    [left + y, top],
    [left, top - y],
    [left, bottom + y],
  ]);
  linear([left + y, bottom], [left + y, top], left - X_DIM, true, X, 'preform.width', '*');
  linear([left, bottom + y], [right, bottom + y], bottom - W_DIM, false, W, 'preform.length', '*');
  // chamfer Y: both legs at the top-right corner, arrows outside, text beside them
  linear([right - y, top], [right, top - y], top + CHAMFER_TOP, false, Y, 'preform.chamfer', '*', {
    outside: true,
    textCenter: right - y - TEXT_GAP,
    textAlign: 'end',
  });
  linear([right - y, top], [right, top - y], right + CHAMFER_RIGHT, true, Y, 'preform.chamfer', '*', {
    outside: true,
    textCenter: top - y - TEXT_GAP,
    textAlign: 'end',
  });
  w.text(msp, '比例 ', [(left + right) / 2 - 4.334, bottom - SCALE_DROP]);
  w.text(msp, lay.label, [(left + right) / 2 + 1.026, bottom - SCALE_DROP]);

  // ── side view to the right: thickness Z, with the chamfer edges ──
  const x0 = right + SIDE_GAP,
    x1 = x0 + Z * s;
  w.poly(msp, [
    [x0, bottom],
    [x1, bottom],
    [x1, top],
    [x0, top],
  ]);
  for (const ye of [top - y, bottom + y]) w.line(msp, [x0, ye], [x1, ye]);
  linear([x0, top], [x1, top], top + Z_DIM, false, Z, 'preform.thickness_override', '*', {
    outside: true,
    textCenter: x0 - TEXT_GAP,
    textAlign: 'end',
  });

  // ── notes under the side view ──
  PREFORM_NOTES.forEach((line, i) => w.text(msp, line, [right + NOTE_OFFSET, bottom - NOTE_DROP - i * NOTE_LINE]));

  return finishSheet(w, template, d, {
    cover,
    date,
    partNo: number.partNo,
    rev: number.rev,
    description: `Solder preform ${general(W)}*${general(X)}*${general(Z)}`,
  });
}

/** The preform drawing as DXF R2000 bytes (code page ANSI_950, as the copper drawing). */
export const preformDrawingDxf = (r, template, options) => encodeDxf(preformDrawingText(r, template, options));
