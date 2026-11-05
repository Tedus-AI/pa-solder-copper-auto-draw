export const defaults = {
  name: 'pa_780_m1p',
  package: { length: 20.57, width: 9.78, max_tolerance: .127, support_height: 1.57 },
  pcb: { opening_length: 20.9, opening_width: 10.1, thickness: 2, relief_diameter: 2, placement_accuracy: .066, opening_tolerance: .1 },
  copper: { base_length: 40, base_width: 30, base_thickness: 3, corner_radius: 3, hole_diameter: 3, hole_edge_offset: 4, pad_size: 1.5 },
  stack: { lead_solder: .1, board_solder: .1, flange_gap: .3, pad_height: .15 },
  preform: { chamfer: 3.4, trial_delta: .05, thickness_override: null },
};

export const fields = {
  package: ['PA 封裝', { length: 'PA 長度', width: 'PA 寬度', max_tolerance: '最大尺寸增量', support_height: '支撐高度 SPH' }],
  pcb: ['PCB 開孔', { opening_length: '開孔長度 M', opening_width: '開孔寬度 N', thickness: 'PCB 厚度 C', relief_diameter: 'Relief 直徑 O', placement_accuracy: '貼片放置精度', opening_tolerance: '開孔公差' }],
  copper: ['銅塊尺寸', { base_length: '基座長度 E', base_width: '基座寬度 F', base_thickness: '基座厚度 G', corner_radius: '四角半徑 R', hole_diameter: '吊掛孔直徑 D', hole_edge_offset: '孔中心距邊 C', pad_size: '小凸台邊長 J' }],
  stack: ['高度堆疊', { lead_solder: '引腳下方錫厚 A', board_solder: '銅塊／PCB 間錫厚 B', flange_gap: 'Flange 至大凸台 D', pad_height: '小凸台高度 K' }],
  preform: ['錫片設計', { chamfer: '45° 削角 Y', trial_delta: '試片厚度增減量', thickness_override: '指定厚度（留空自動）' }],
};

const zero = new Set(['max_tolerance', 'placement_accuracy', 'opening_tolerance', 'lead_solder', 'board_solder', 'flange_gap', 'trial_delta']);
const check = (condition, message) => { if (!condition) throw new Error(message); };
export const ceilTenth = v => Math.ceil(v * 10 - Number.EPSILON * Math.abs(v) * 10) / 10;

export function normalize(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), '請輸入有效的設計參數。');
  for (const key of Object.keys(input)) check(Object.hasOwn(defaults, key), `未知欄位：${key}`);
  const d = structuredClone(defaults);
  d.name = input.name ?? d.name;
  check(typeof d.name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(d.name), '設計名稱須以英文字母開頭，使用英數字、_ 或 -，最多40字。');
  for (const group of Object.keys(fields)) {
    const values = input[group] ?? {};
    check(values && typeof values === 'object' && !Array.isArray(values), `${group} 須為設定物件。`);
    for (const key of Object.keys(values)) check(Object.hasOwn(d[group], key), `未知欄位：${group}.${key}`);
    Object.assign(d[group], values);
    for (const [key, v] of Object.entries(d[group])) {
      if (key === 'thickness_override' && v === null) continue;
      check(typeof v === 'number' && Number.isFinite(v) && v <= 10000 && (zero.has(key) ? v >= 0 : v > 0), `${fields[group][1][key]} 的數值無效。`);
    }
  }
  return d;
}

export function calculate(input) {
  const d = normalize(input), p = d.package, b = d.pcb, c = d.copper, s = d.stack, t = d.preform;
  const I = ceilTenth(p.length), H = ceilTenth(p.width);
  const L = b.thickness + s.lead_solder + s.board_solder - p.support_height - s.flange_gap + s.pad_height;
  const gap = L + s.flange_gap - s.pad_height;
  check(L > s.pad_height && gap > L, '高度堆疊無效：CuH 必須大於小凸台高度，flange 必須高於凸台頂面。');
  check([2.5, 3].includes(c.base_thickness), '規範基座厚度 G 為 2.5 或 3.0 mm。');
  check(c.corner_radius < Math.min(c.base_length, c.base_width) / 2, '銅塊四角半徑超出基座範圍。');
  check(c.base_length > b.opening_length && b.opening_length >= I && c.base_width > b.opening_width && b.opening_width >= H, '基座須大於 PCB 開孔，開孔不可小於大凸台。');
  check(b.relief_diameter < Math.min(b.opening_length, b.opening_width), 'Relief 直徑超出開孔尺寸。');
  check(c.pad_size < Math.min(I, H) / 2, '四角小凸台尺寸過大。');
  check(t.chamfer > 2 * c.pad_size && t.chamfer < Math.min(I, H) / 2, '削角須大於兩倍小凸台邊長，並小於錫片短邊的一半。');
  const off = c.hole_edge_offset, rad = c.hole_diameter / 2;
  check(off >= c.corner_radius && off > rad && 2 * off < Math.min(c.base_length, c.base_width), '吊掛孔邊距不足，或孔位不在基座內。');
  const hx = c.base_length / 2 - off, hy = c.base_width / 2 - off;
  check(Math.hypot(Math.max(hx - I / 2, 0), Math.max(hy - H / 2, 0)) > rad, '吊掛孔與大凸台相交。');
  const cavity = (b.opening_length * b.opening_width + Math.PI * (b.relief_diameter / 2) ** 2) * gap;
  const boss = I * H * (L - s.pad_height) + 4 * c.pad_size ** 2 * s.pad_height;
  const volume = cavity - boss, area = I * H - 2 * t.chamfer ** 2;
  check(volume > 0 && area > 0, '體積扣除後錫量或錫片面積非正值。');
  const z = volume / area;
  check(z - t.trial_delta > 0, '試作厚度差值過大，最薄試片須大於零。');
  const opening = [p.length, p.width].map(v => ceilTenth(v + p.max_tolerance + b.placement_accuracy + b.opening_tolerance));
  const clearance = (t.chamfer - 2 * c.pad_size) / Math.SQRT2;
  const warnings = [
    '銅塊 E/F 由 thermal／RF 設計定義，40 × 30 mm 僅為示範外形。',
    'PDF 第12頁為 Z ± 0.05 mm，第13頁表格為 ± 0.15 mm；本次依指定增減量計算。',
    `削角與小凸台的解析最近距離為 ${clearance.toFixed(4)} mm，與 PDF 第11頁「約0.37 mm」不同，需工程確認。`,
    '名義體積估算未含全公差堆疊、焊料損耗與空洞率，最終厚度須依製程切片選定。',
  ];
  if (b.opening_length < opening[0] || b.opening_width < opening[1]) warnings.push(`開孔小於 Delta 規則建議值 ${opening.join(' × ')} mm。`);
  if (t.thickness_override !== null) warnings.push('模型使用指定錫厚；計算厚度與三款試片仍另列於報告。');
  return { design: d, boss_length: I, boss_width: H, boss_total_height: L, boss_lower_height: L - s.pad_height,
    copper_to_flange: gap, cavity_volume: cavity, boss_volume: boss, solder_volume: volume, preform_area: area,
    calculated_thickness: z, model_thickness: t.thickness_override ?? z, trial_thicknesses: [z - t.trial_delta, z, z + t.trial_delta],
    recommended_opening: opening, corner_clearance: clearance, heatsink_depth: c.base_thickness + .05, warnings,
    copper_volume: (c.base_length * c.base_width - (4 - Math.PI) * c.corner_radius ** 2 - 2 * Math.PI * rad ** 2) * c.base_thickness + boss };
}

export function octagon(l, w, c) {
  const x = l / 2, y = w / 2;
  return [[-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c], [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]];
}

export function nativeJob(r) {
  const d = r.design, c = d.copper;
  return { schema_version: 2, status: 'awaiting_local_creo_execution', target: { product: 'Creo Parametric', version: '7.0.10.0', os: 'Windows 11' },
    name: d.name, units: 'mm', required_model_type: 'native_parametric_features', step_import_acceptable: false,
    design: d, derived: r,
    native_parameters: {
      copper: { BASE_L: c.base_length, BASE_W: c.base_width, BASE_T: c.base_thickness, BASE_R: c.corner_radius, HOLE_D: c.hole_diameter,
        HOLE_EDGE: c.hole_edge_offset, BOSS_L: r.boss_length, BOSS_W: r.boss_width, CUH: r.boss_total_height, PAD_SIZE: c.pad_size, PAD_H: d.stack.pad_height },
      preform: { PREFORM_L: r.boss_length, PREFORM_W: r.boss_width, CHAMFER_Y: d.preform.chamfer, PREFORM_Z: r.model_thickness },
    },
    required_features: { copper: ['BASE_EXTRUDE', 'BASE_ROUNDS', 'MOUNT_HOLES', 'MAIN_BOSS', 'CORNER_PADS'], preform: ['PREFORM_EXTRUDE'] },
    expected: { copper: { volume: r.copper_volume, bounds: [c.base_length, c.base_width, c.base_thickness + r.boss_total_height] },
      preform: { volume: r.preform_area * r.model_thickness, bounds: [r.boss_length, r.boss_width, r.model_thickness] } },
    note: 'Native parametric masters and actual execution on licensed Creo are required. This website does not generate native PRT files.',
  };
}
