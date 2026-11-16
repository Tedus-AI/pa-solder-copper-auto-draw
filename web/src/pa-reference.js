// Display geometry only. Ratios follow the supplied H-37248KC-6/2 outline.
// The casing is a plain rectangle. lead_count 6 adds the two narrow top corner
// leads, 4 leaves them off; pins are never used for manufacturing calculations.
export function paReference(p,envelope=null) {
  const sx = p.length / 20.57, sy = p.width / 9.78, sz = p.support_height / 1.57;
  const flangeDepth = 1.02 * sz, totalHeight = 3.78 * sz;
  const bodyLength = 20.07 * sx, bodyWidth = 9.40 * sy;
  const pins = [];
  for (const side of [-1, 1]) {
    for (const x of [-4.445 * sx, 4.445 * sx]) pins.push({ x, side, width: 3.81 * sx });
  }
  if ((p.lead_count ?? 6) === 6) for (const x of [-9.19 * sx, 9.19 * sx]) pins.push({ x, side: 1, width: 1.02 * sx });
  const inner = bodyWidth * .44, outer = p.width / 2 + 4.83 * sy;
  return {
    flange: { length: p.length, width: p.width, radius: .51 * Math.min(sx, sy), depth: flangeDepth },
    // One casing, not an extra plate on top. All heights remain schematic;
    // the pin underside below is the dimensionally meaningful SPH datum.
    body: { profile: rectangle(bodyLength, bodyWidth), bottom: flangeDepth, depth: totalHeight - flangeDepth },
    pins: pins.map(pin => ({ size: [pin.width, outer - inner, .12 * sz], center: [pin.x, pin.side * (outer + inner) / 2, p.support_height + .06 * sz] })),
    maximum: [envelope?.max_length??p.length+(p.max_tolerance||0),envelope?.max_width??p.width+(p.max_tolerance||0)], totalHeight,
  };
}

function rectangle(length, width) {
  const x = length / 2, y = width / 2;
  return [[-x, -y], [x, -y], [x, y], [-x, y]];
}
