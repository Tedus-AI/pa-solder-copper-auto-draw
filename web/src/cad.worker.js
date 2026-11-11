import initOpenCascade from 'replicad-opencascadejs';
import wasmURL from 'replicad-opencascadejs/wasm?url';
import { setOC, sketchRoundedRectangle, sketchRectangle, makeCylinder, Sketcher, measureVolume, importSTEP, exportSTEP } from 'replicad';
import {holeCenters} from './hole-corners.js';
import { calculate, octagon } from './design.js';

let engine;
const ready = () => engine ??= initOpenCascade({ locateFile: path => path.endsWith('.wasm') ? wasmURL : path }).then(oc => { setOC(oc); return oc; });
const near = (a, b) => Math.abs(a - b) <= Math.max(.001, Math.abs(b) * .0001);
// STEP files carry part names and colours (AP214 via XCAF), so CAD opens them coloured:
// copper in copper, the solder preform in purple.
const STEP_PARTS = { copper: { name: 'Copper_Coin', color: '#b87333' }, preform: { name: 'Solder_Preform', color: '#8e44ad' } };
// OpenCascade keeps colours as linear RGB and writes sRGB to STEP: hand it the linear value.
const linearHex = hex => '#' + [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255, l = c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; return Math.round(l * 255).toString(16).padStart(2, '0'); }).join('');
const stepOf = items => exportSTEP(items.map(([part, shape]) => ({ shape, name: STEP_PARTS[part].name, color: linearHex(STEP_PARTS[part].color) })), { unit: 'MM' });

self.onmessage = async ({ data: { id, design } }) => {
  const owned = [];
  const keep = shape => { owned.push(shape); return shape; };
  try {
    self.postMessage({ id, status: '正在載入瀏覽器 CAD 引擎…' });
    await ready();
    const r = calculate(design), c = r.design.copper;
    if(r.trial_status==='stale')throw new Error('尺寸已變更，請解鎖並重新驗證試片厚度。');
    const [cx,cy]=r.boss_center||[0,0];
    self.postMessage({ id, status: '正在建立銅塊與錫片實體…' });
    let copper = keep(sketchRoundedRectangle(c.base_length, c.base_width, c.corner_radius).extrude(c.base_thickness));
    // The drilling tool overshoots both base faces so the boolean cut never
    // relies on coplanar faces (a common OpenCascade failure mode). The hole
    // itself is identical: material only exists between z = 0 and G.
    const overshoot = .1;
    for (const [hx,hy] of holeCenters(c)) {
      const hole = keep(makeCylinder(c.hole_diameter / 2, c.base_thickness + 2 * overshoot, [hx,hy,-overshoot]));
      copper = keep(copper.cut(hole));
    }
    const boss = keep(sketchRectangle(r.boss_length, r.boss_width, { origin: [cx,cy,c.base_thickness] }).extrude(r.boss_lower_height));
    copper = keep(copper.fuse(boss));
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const pad = keep(sketchRectangle(c.pad_size, c.pad_size, { origin: [cx+x * (r.boss_length - c.pad_size) / 2, cy+y * (r.boss_width - c.pad_size) / 2, c.base_thickness + r.boss_lower_height] }).extrude(r.design.stack.pad_height));
      copper = keep(copper.fuse(pad));
    }
    const points = octagon(r.boss_length, r.boss_width, r.design.preform.chamfer);
    const pen = new Sketcher('XY').movePointerTo(points[0]);
    points.slice(1).forEach(p => pen.lineTo(p));
    const preform = keep(pen.close().extrude(r.model_thickness));
    const parts = {};
    for (const [name, shape] of Object.entries({ copper, preform })) {
      self.postMessage({ id, status: `正在驗證 ${name === 'copper' ? '銅塊' : '錫片'} STEP 回讀…` });
      const expected = name === 'copper' ? r.copper_volume : r.preform_area * r.model_thickness;
      const volume = measureVolume(shape);
      if (!near(volume, expected)) throw new Error(`${name} 實體體積與公式不符。`);
      const solids = shape.solids;
      if (solids.length !== 1) throw new Error(`${name} 不是單一實體。`);
      solids.forEach(s => s.delete());
      const mesh = shape.mesh({ tolerance: .015, angularTolerance: .1 });
      const edges = shape.meshEdges({ tolerance: .015, angularTolerance: .1 });
      const step = stepOf([[name, shape]]);
      const restored = keep(await importSTEP(step));
      if (!near(measureVolume(restored), expected)) throw new Error(`${name} STEP 回讀體積不符。`);
      parts[name] = { mesh, edges, step, volume, bounds: shape.boundingBox.bounds };
    }
    // Assembly: the preform placed on the main boss top, between the four pads.
    self.postMessage({ id, status: '正在建立銅塊＋錫片組合 STEP…' });
    const placed = keep(preform.clone().translate([cx, cy, c.base_thickness + r.boss_lower_height]));
    const assembly = stepOf([['copper', copper], ['preform', placed]]);
    const together = keep(await importSTEP(assembly));
    if (!near(measureVolume(together), parts.copper.volume + parts.preform.volume)) throw new Error('組合 STEP 回讀體積不符。');
    self.postMessage({ id, result: { parts, assembly: { step: assembly }, results: r, verification: 'volume_and_step_roundtrip_passed' } });
  } catch (error) {
    self.postMessage({ id, error: typeof error === 'object' && error?.message ? error.message : `CAD 建模失敗：${String(error)}` });
  } finally {
    for (const shape of owned.reverse()) { try { shape.delete(); } catch { /* already released by the kernel */ } }
  }
};
