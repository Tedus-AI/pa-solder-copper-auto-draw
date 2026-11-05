import initOpenCascade from 'replicad-opencascadejs';
import wasmURL from 'replicad-opencascadejs/wasm?url';
import { setOC, sketchRoundedRectangle, sketchRectangle, makeCylinder, Sketcher, measureVolume, importSTEP } from 'replicad';
import { calculate, octagon } from './design.js';

let engine;
const ready = () => engine ??= initOpenCascade({ locateFile: path => path.endsWith('.wasm') ? wasmURL : path }).then(oc => { setOC(oc); return oc; });
const near = (a, b) => Math.abs(a - b) <= Math.max(.001, Math.abs(b) * .0001);

self.onmessage = async ({ data: { id, design } }) => {
  const owned = [];
  const keep = shape => { owned.push(shape); return shape; };
  try {
    self.postMessage({ id, status: '正在載入瀏覽器 CAD 引擎…' });
    await ready();
    const r = calculate(design), c = r.design.copper;
    self.postMessage({ id, status: '正在建立銅塊與錫片實體…' });
    let copper = keep(sketchRoundedRectangle(c.base_length, c.base_width, c.corner_radius).extrude(c.base_thickness));
    for (const sign of [-1, 1]) {
      const hole = keep(makeCylinder(c.hole_diameter / 2, c.base_thickness, [sign * (c.base_length / 2 - c.hole_edge_offset), sign * (c.base_width / 2 - c.hole_edge_offset), 0]));
      copper = keep(copper.cut(hole));
    }
    const boss = keep(sketchRectangle(r.boss_length, r.boss_width, { origin: c.base_thickness }).extrude(r.boss_lower_height));
    copper = keep(copper.fuse(boss));
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const pad = keep(sketchRectangle(c.pad_size, c.pad_size, { origin: [x * (r.boss_length - c.pad_size) / 2, y * (r.boss_width - c.pad_size) / 2, c.base_thickness + r.boss_lower_height] }).extrude(r.design.stack.pad_height));
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
      const mesh = shape.mesh({ tolerance: .05, angularTolerance: .15 });
      const edges = shape.meshEdges({ tolerance: .05, angularTolerance: .15 });
      const step = shape.blobSTEP();
      const restored = keep(await importSTEP(step));
      if (!near(measureVolume(restored), expected)) throw new Error(`${name} STEP 回讀體積不符。`);
      parts[name] = { mesh, edges, step, stl: shape.blobSTL({ binary: true, tolerance: .05, angularTolerance: .15 }), volume, bounds: shape.boundingBox.bounds };
    }
    self.postMessage({ id, result: { parts, results: r, verification: 'volume_and_step_roundtrip_passed' } });
  } catch (error) {
    self.postMessage({ id, error: typeof error === 'object' && error?.message ? error.message : `CAD 建模失敗：${String(error)}` });
  } finally {
    for (const shape of owned.reverse()) { try { shape.delete(); } catch { /* already released by the kernel */ } }
  }
};
