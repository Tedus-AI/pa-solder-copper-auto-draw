import clipping from 'polygon-clipping';
import { copperFootprint } from './copper-geometry.js';
import { dxfDocument, CENTER_LTYPE, CONTINUOUS } from './dxf-document.js';

// Curved clipping boundaries use a maximum 0.001 mm chord deviation. The same
// polygons drive the reference viewer and the Layout DXF (no guessed outlines).
export const CHORD_TOLERANCE = 0.001;
const close = p => [...p, p[0]];
export const rectangle = (x, y, w, h) => [
  [
    close([
      [x - w / 2, y - h / 2],
      [x + w / 2, y - h / 2],
      [x + w / 2, y + h / 2],
      [x - w / 2, y + h / 2],
    ]),
  ],
];
export function circle(x, y, r) {
  const n = Math.max(24, Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - CHORD_TOLERANCE / r)) / 4) * 4);
  return [
    [
      close(
        Array.from({ length: n }, (_, i) => [
          x + r * Math.cos((2 * Math.PI * i) / n),
          y + r * Math.sin((2 * Math.PI * i) / n),
        ]),
      ),
    ],
  ];
}
export function roundedRectangle(w, h, r) {
  const n = Math.max(6, Math.ceil(Math.PI / 2 / Math.acos(Math.max(-1, 1 - CHORD_TOLERANCE / r))));
  const points = [];
  for (const [x, y, start] of [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, Math.PI * 1.5],
  ])
    for (let i = 0; i <= n; i++)
      points.push([x + r * Math.cos(start + (i * Math.PI) / 2 / n), y + r * Math.sin(start + (i * Math.PI) / 2 / n)]);
  return [[close(points)]];
}
export function pcbCutout(r) {
  const b = r.design.pcb,
    radius = b.relief_diameter / 2;
  const [cx, cy] = r.boss_center || [0, 0];
  const pieces = [rectangle(cx, cy, b.opening_length, b.opening_width)];
  // p7/p9 show four outward side semicircles. The solder volume uses the same
  // outline via design.reliefArea (exact analytic union of the half-discs).
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      pieces.push(circle(cx + (x * b.opening_length) / 2, cy + y * (b.opening_width / 2 - radius), radius));
  return clipping.union(...pieces);
}
export function area(polygons) {
  const ringArea = ring =>
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return sum + p[0] * q[1] - q[0] * p[1];
      }, 0) / 2,
    );
  return polygons.reduce(
    (sum, polygon) => sum + ringArea(polygon[0]) - polygon.slice(1).reduce((s, ring) => s + ringArea(ring), 0),
    0,
  );
}

export function layoutGeometry(r) {
  const c = r.design.copper,
    l = r.design.layout;
  const [cx, cy] = r.boss_center || [0, 0],
    footprint = copperFootprint(c);
  const pitch = l.epad_size + l.web_width;
  const nx = Math.ceil((c.base_length / 2 + Math.abs(cx)) / pitch) + 1,
    ny = Math.ceil((c.base_width / 2 + Math.abs(cy)) / pitch) + 1;
  if ((2 * nx + 1) * (2 * ny + 1) > 12000) throw new Error('E-PAD 格數超過12000，請縮小基座範圍或放大格距。');
  const copper = footprint.outer;
  const outer = roundedRectangle(
    c.base_length + 2 * l.border_width,
    c.base_width + 2 * l.border_width,
    c.corner_radius + l.border_width,
  );
  const cutout = pcbCutout(r);
  const centers = footprint.centers;
  const clearances = centers.map(([x, y]) => circle(x, y, l.hole_clearance / 2));
  const holes = footprint.holes;
  const allowed = clipping.difference(copper, cutout, ...clearances, ...holes);
  const pads = [],
    cells = [];
  for (let ix = -nx; ix <= nx; ix++)
    for (let iy = -ny; iy <= ny; iy++) {
      const x = cx + ix * pitch,
        y = cy + iy * pitch;
      if (Math.abs(x) - l.epad_size / 2 > c.base_length / 2 || Math.abs(y) - l.epad_size / 2 > c.base_width / 2)
        continue;
      const window = clipping.intersection(rectangle(x, y, l.epad_size, l.epad_size), allowed);
      if (!window.length || area(window) < 1e-8) continue;
      pads.push(...window);
      cells.push({ x, y, full: Math.abs(area(window) - l.epad_size ** 2) < 1e-6 });
    }
  // V marks the diameter excluded from E-PADs. Green mask retains the V-to-D
  // annulus around each real mounting hole, as illustrated on slide 9.
  if (!pads.length) throw new Error('目前尺寸未留下可用 E-PAD，請檢查基座、開孔與格距。');
  const mask = clipping.difference(outer, cutout, ...holes, pads);
  // Copper mounting holes belong to the copper part, not to the PCB. The
  // reference board only has its PA window and four side relief semicircles.
  const board = clipping.difference(rectangle(0, 0, c.base_length + 10, c.base_width + 10), cutout);
  const marginX = c.base_length / 2 - Math.max(...pads.flatMap(p => p[0].map(v => Math.abs(v[0]))));
  const marginY = c.base_width / 2 - Math.max(...pads.flatMap(p => p[0].map(v => Math.abs(v[1]))));
  return {
    copper,
    copperProfile: footprint.profile,
    copperFootprint: footprint,
    outer,
    cutout,
    clearances,
    holes,
    centers,
    pads,
    cells,
    mask,
    board,
    pitch,
    origin: [cx, cy],
    chord_tolerance: CHORD_TOLERANCE,
    epad_area: area(pads),
    mask_area: area(mask),
    boundary_margins: [marginX, marginY],
    notes: [
      'PPT p9: R=outer green-mask band, S=Typ. square E-PAD, T=green web, U=PCB cutout, V=E-PAD exclusion diameter.',
      'Grid centers follow the PCB opening/main-boss center; edge/corner windows are clipped to the true copper profile, including hole breakouts. A boundary falling in a web may leave an edge web; Layout must confirm edge treatment.',
      'Green mask retains the annulus between actual mounting hole D and E-PAD exclusion V. Layer polarity is explicit in the DXF.',
      'PCB relief outline follows p7/p9 side semicircles; solder volume uses the same half-disc union area (PDF p12 used one full circle).',
      'R outer band is interpreted outside the copper boundary per p9 illustration. Curved clipping chord tolerance is 0.001 mm.',
    ],
  };
}

const PA_CENTER_RADIUS = 0.5;
const DIM_TEXT_HEIGHT = 1;

/** Layout (solder mask / E-PAD) drawing: geometry, the PA centre and its distances to the copper edges. */
export function layoutDxf(r, g = layoutGeometry(r)) {
  const layers = {
    SOLDER_MASK: 3,
    EPAD_OPENING: 8,
    PCB_CUTOUT: 1,
    COPPER_BOUNDARY: 30,
    MASK_BOUNDARY: 3,
    HOLE_CLEARANCE: 2,
    MOUNT_HOLE: 1,
    PA_CENTER: 7,
    DIM: 1,
    CENTER: 8,
  };
  const doc = dxfDocument({
    ltypes: [CENTER_LTYPE],
    layers: Object.entries(layers).map(([name, color]) => ({
      name,
      color,
      ltype: name === 'CENTER' ? 'CENTER' : CONTINUOUS,
    })),
  });
  const put = doc.put;
  const poly = (ring, layer) => {
    const points = ring.slice(0, -1);
    put(0, 'LWPOLYLINE', 100, 'AcDbEntity', 8, layer, 100, 'AcDbPolyline', 90, points.length, 70, 1);
    for (const [x, y] of points) put(10, x, 20, y);
  };
  const line = (a, b, layer = 'DIM') =>
    put(
      0,
      'LINE',
      100,
      'AcDbEntity',
      8,
      layer,
      100,
      'AcDbLine',
      10,
      a[0],
      20,
      a[1],
      30,
      0,
      11,
      b[0],
      21,
      b[1],
      31,
      0,
      ...(layer === 'CENTER' ? [48, 0.5] : []),
    );
  const centerMark = (x, y, r) => {
    line([x - r - 0.9, y], [x + r + 0.9, y], 'CENTER');
    line([x, y - r - 0.9], [x, y + r + 0.9], 'CENTER');
  };
  const arrow = (tip, direction) => {
    const length = Math.hypot(...direction),
      u = direction.map(v => v / length),
      base = [tip[0] + u[0] * 0.8, tip[1] + u[1] * 0.8],
      normal = [-u[1] * 0.22, u[0] * 0.22],
      a = [base[0] + normal[0], base[1] + normal[1]],
      b = [base[0] - normal[0], base[1] - normal[1]];
    put(
      0,
      'SOLID',
      100,
      'AcDbEntity',
      8,
      'DIM',
      100,
      'AcDbTrace',
      10,
      tip[0],
      20,
      tip[1],
      30,
      0,
      11,
      a[0],
      21,
      a[1],
      31,
      0,
      12,
      b[0],
      22,
      b[1],
      32,
      0,
      13,
      b[0],
      23,
      b[1],
      33,
      0,
    );
  };
  const hatch = (polygon, layer) => {
    put(
      0,
      'HATCH',
      100,
      'AcDbEntity',
      8,
      layer,
      100,
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
      'SOLID',
      70,
      1,
      71,
      0,
      91,
      polygon.length,
    );
    polygon.forEach((ring, i) => {
      const points = ring.slice(0, -1);
      put(92, i === 0 ? 3 : 2, 72, 0, 73, 1, 93, points.length);
      for (const [x, y] of points) put(10, x, 20, y);
      put(97, 0);
    });
    put(75, 0, 76, 1, 98, 0);
  };
  for (const polygon of g.mask) {
    polygon.forEach(ring => poly(ring, 'SOLDER_MASK'));
    hatch(polygon, 'SOLDER_MASK');
  }
  for (const polygon of g.pads) {
    polygon.forEach(ring => poly(ring, 'EPAD_OPENING'));
    hatch(polygon, 'EPAD_OPENING');
  }
  for (const [shapes, layer] of [
    [g.copperProfile, 'COPPER_BOUNDARY'],
    [g.outer, 'MASK_BOUNDARY'],
    [g.cutout, 'PCB_CUTOUT'],
  ])
    for (const polygon of shapes) polygon.forEach(ring => poly(ring, layer));
  for (const [x, y] of g.centers)
    for (const [layer, d] of [
      ['HOLE_CLEARANCE', r.design.layout.hole_clearance],
      ['MOUNT_HOLE', r.design.copper.hole_diameter],
    ])
      put(0, 'CIRCLE', 100, 'AcDbEntity', 8, layer, 100, 'AcDbCircle', 10, x, 20, y, 30, 0, 40, d / 2);
  const l = r.design.layout;
  for (const [x, y] of g.centers) centerMark(x, y, Math.max(l.hole_clearance, r.design.copper.hole_diameter) / 2);
  const [cx, cy] = g.origin || [0, 0],
    o = r.design.pcb.relief_diameter / 2;
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      centerMark(cx + (sx * r.design.pcb.opening_length) / 2, cy + sy * (r.design.pcb.opening_width / 2 - o), o);
  // PA centre (= PCB window / main-boss centre) and its distances to the copper's
  // left and bottom edges — the only annotations on the Layout drawing.
  put(0, 'CIRCLE', 100, 'AcDbEntity', 8, 'PA_CENTER', 100, 'AcDbCircle', 10, cx, 20, cy, 30, 0, 40, PA_CENTER_RADIUS);
  const c = r.design.copper,
    left = -c.base_length / 2,
    bottom = -c.base_width / 2,
    R = c.corner_radius,
    gap = 0.6,
    overshoot = 1;
  const text = (value, x, y, rotation) =>
    put(
      0,
      'TEXT',
      100,
      'AcDbEntity',
      8,
      'DIM',
      100,
      'AcDbText',
      10,
      x,
      20,
      y,
      30,
      0,
      40,
      DIM_TEXT_HEIGHT,
      1,
      `${value.toFixed(2)} mm`,
      50,
      rotation,
      72,
      1,
      11,
      x,
      21,
      y,
      31,
      0,
      100,
      'AcDbText',
      73,
      0,
    );
  // Horizontal: PA centre → copper left edge, dimension line below the part.
  const yDim = bottom - l.border_width - 3;
  line([cx, cy - PA_CENTER_RADIUS - gap], [cx, yDim - overshoot]);
  line([left, bottom + R - gap], [left, yDim - overshoot]);
  line([left, yDim], [cx, yDim]);
  arrow([left, yDim], [1, 0]);
  arrow([cx, yDim], [-1, 0]);
  text(cx - left, (left + cx) / 2, yDim + 0.6, 0);
  // Vertical: PA centre → copper bottom edge, dimension line left of the part.
  const xDim = left - l.border_width - 3;
  line([cx - PA_CENTER_RADIUS - gap, cy], [xDim - overshoot, cy]);
  line([left + R - gap, bottom], [xDim - overshoot, bottom]);
  line([xDim, bottom], [xDim, cy]);
  arrow([xDim, bottom], [0, 1]);
  arrow([xDim, cy], [0, -1]);
  text(cy - bottom, xDim - 0.6, (bottom + cy) / 2, 90);
  return doc.toString();
}
