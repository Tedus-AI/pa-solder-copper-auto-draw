import { octagon } from './design.js';

// Display geometry only. Ratios follow the supplied H-37248KC-6/2 outline;
// six illustrative pins are never used for manufacturing calculations.
export function paReference(p,envelope=null) {
  const sx = p.length / 20.57, sy = p.width / 9.78, sz = p.support_height / 1.57;
  const flangeDepth = 1.02 * sz, totalHeight = 3.78 * sz;
  const bodyLength = 20.07 * sx, bodyWidth = 9.40 * sy;
  const trim = Math.min(2.72 * Math.min(sx, sy), bodyLength / 4, bodyWidth / 4);
  const pins = [];
  for (const side of [-1, 1]) {
    for (const x of [-4.445 * sx, 4.445 * sx]) pins.push({ x, side, width: 3.81 * sx });
  }
  for (const x of [-9.19 * sx, 9.19 * sx]) pins.push({ x, side: 1, width: 1.02 * sx });
  const inner = bodyWidth * .44, outer = p.width / 2 + 4.83 * sy;
  return {
    flange: { length: p.length, width: p.width, radius: .51 * Math.min(sx, sy), depth: flangeDepth },
    // One casing, not an extra plate on top. All heights remain schematic;
    // the pin underside below is the dimensionally meaningful SPH datum.
    body: { profile: octagon(bodyLength, bodyWidth, trim), bottom: flangeDepth, depth: totalHeight - flangeDepth },
    pins: pins.map(pin => ({ size: [pin.width, outer - inner, .12 * sz], center: [pin.x, pin.side * (outer + inner) / 2, p.support_height + .06 * sz] })),
    maximum: [envelope?.max_length??p.length+(p.max_tolerance||0),envelope?.max_width??p.width+(p.max_tolerance||0)], totalHeight,
  };
}
