import { octagon } from './design.js';

export function drawing(r, part) {
  const out = [], put = (...pairs) => pairs.forEach(v => out.push(String(v)));
  const entity = (type, layer, subclass, ...pairs) => put(0, type, 100, 'AcDbEntity', 8, layer, 100, subclass, ...pairs);
  const line = (a, b, layer = 'DIM') => entity('LINE', layer, 'AcDbLine', 10, a[0], 20, a[1], 30, 0, 11, b[0], 21, b[1], 31, 0);
  const text = (s, x, y, h = 1, layer = 'NOTES') => entity('TEXT', layer, 'AcDbText', 10, x, 20, y, 30, 0, 40, h, 1, s, 100, 'AcDbText');
  const poly = (points, layer = 'OUTLINE') => {
    entity('LWPOLYLINE', layer, 'AcDbPolyline', 90, points.length, 70, 1);
    for (const [x, y, bulge = 0] of points) put(10, x, 20, y, 42, bulge);
  };
  const rect = (x, y, w, h, layer) => poly([[x - w / 2, y - h / 2], [x + w / 2, y - h / 2], [x + w / 2, y + h / 2], [x - w / 2, y + h / 2]], layer);
  const dim = (a, b, offset, label, vertical = false) => {
    const p1 = vertical ? [offset, a[1]] : [a[0], offset], p2 = vertical ? [offset, b[1]] : [b[0], offset];
    line(a, p1); line(b, p2); line(p1, p2);
    for (const [p, dir] of [[p1, 1], [p2, -1]]) {
      if (vertical) { line(p, [p[0] - .2, p[1] + dir * .6]); line(p, [p[0] + .2, p[1] + dir * .6]); }
      else { line(p, [p[0] + dir * .6, p[1] - .2]); line(p, [p[0] + dir * .6, p[1] + .2]); }
    }
    text(label, (p1[0] + p2[0]) / 2 + .4, (p1[1] + p2[1]) / 2 + .6, .85, 'DIM');
  };
  put(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1024', 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1, 0, 'ENDSEC');
  put(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0, 0, 'ENDTAB');
  const layers = ['0', 'OUTLINE', 'BOSS', 'PAD', 'HOLES', 'SIDE', 'DIM', 'NOTES'];
  put(0, 'TABLE', 2, 'LAYER', 70, layers.length);
  layers.forEach((name, i) => put(0, 'LAYER', 2, name, 70, 0, 62, i % 7 + 1, 6, 'CONTINUOUS'));
  put(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
  const c = r.design.copper, I = r.boss_length, H = r.boss_width;
  const notes = [];
  if (part === 'copper') {
    const x = c.base_length / 2, y = c.base_width / 2, R = c.corner_radius, b = Math.tan(Math.PI / 8);
    poly([[-x + R, -y], [x - R, -y, b], [x, -y + R], [x, y - R, b], [x - R, y], [-x + R, y, b], [-x, y - R], [-x, -y + R, b]]);
    rect(0, 0, I, H, 'BOSS');
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) rect(sx * (I - c.pad_size) / 2, sy * (H - c.pad_size) / 2, c.pad_size, c.pad_size, 'PAD');
    for (const sign of [-1, 1]) entity('CIRCLE', 'HOLES', 'AcDbCircle', 10, sign * (x - c.hole_edge_offset), 20, sign * (y - c.hole_edge_offset), 30, 0, 40, c.hole_diameter / 2);
    dim([-x, y], [x, y], y + 5, `${c.base_length} +/-0.2`);
    dim([-x, -y], [-x, y], -x - 5, `${c.base_width} +/-0.2`, true);
    dim([-I / 2, 0], [I / 2, 0], y + 2, `${I} +/-0.05`);
    dim([0, -H / 2], [0, H / 2], x + 5, `${H} +/-0.05`, true);
    const g = c.base_thickness, low = r.boss_lower_height, k = r.design.stack.pad_height, j = c.pad_size;
    const profile = (cx, by, base, boss) => {
      const e = base / 2, w = boss / 2;
      poly([[cx - e, by], [cx + e, by], [cx + e, by + g], [cx + w, by + g], [cx + w, by + g + low + k],
        [cx + w - j, by + g + low + k], [cx + w - j, by + g + low], [cx - w + j, by + g + low],
        [cx - w + j, by + g + low + k], [cx - w, by + g + low + k], [cx - w, by + g], [cx - e, by + g]], 'SIDE');
    };
    profile(0, -y - 16, c.base_length, I); profile(x + c.base_width / 2 + 20, -y - 16, c.base_width, H);
    notes.push(`COPPER / ${r.design.name} / mm / views 1:1`, `Base G=${g} +0/-0.1; 4x R${R}`, `2x DIA ${c.hole_diameter} THRU; diagonal edge offsets ${c.hole_edge_offset} +/-0.1`,
      `CuH L=${r.boss_total_height.toFixed(4)} +0/-0.1`, `4x J=${j} +/-0.05; K=${k} +/-0.05`, 'Finish: electroless Ni <1.5um; matte Sn 1.5-3.5um', 'E/F require thermal and RF approval', `Mating heatsink depth ${r.heatsink_depth.toFixed(2)} +/-0.05`, 'See report.json for assumptions and PDF differences');
  } else {
    poly(octagon(I, H, r.design.preform.chamfer));
    dim([-I / 2, 0], [I / 2, 0], H / 2 + 4, `${I} +/-0.1`);
    dim([0, -H / 2], [0, H / 2], -I / 2 - 4, `${H} +/-0.1`, true);
    rect(0, -H / 2 - 10, I, r.model_thickness, 'SIDE');
    notes.push(`SOLDER PREFORM / ${r.design.name} / mm / views 1:1`, `4x 45deg chamfer Y=${r.design.preform.chamfer} +0.2/-0`,
      `Thickness Z=${r.model_thickness.toFixed(6)} +/-0.02`, 'SAC305: 96.5Sn3Ag0.5Cu, coated with 0.5% F8 flux', `Area=${r.preform_area.toFixed(6)} mm2`,
      `Trial Z: ${r.trial_thicknesses.map(v => v.toFixed(6)).join(' / ')} mm`, 'See report.json; final thickness selected by sectioning');
  }
  const startX = part === 'copper' ? c.base_length / 2 + 20 : I / 2 + 12;
  notes.forEach((v, i) => text(v, startX, 15 - i * 2, .9));
  put(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}
