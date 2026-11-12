import { defaultTolerances, toleranceDefaults, getTolerance, dimensionRange } from './tolerances.js';
import { chamferFor, TRIAL_DELTA, trialChoices, emptyTrial, trialState } from './preform-rules.js';
import { holeCorners, holeMask } from './hole-corners.js';
import { copperFootprint, roundedBaseDistance } from './copper-geometry.js';
import { emptyPartNumbers, normalizePartNumbers } from './part-numbers.js';

export const defaults = {
  name: 'pa_780_m1p',
  project: { name: '未命名專案', project_id: '', pa_brand: '', pa_model: 'H-37248KC-6/2' },
  package: { length: 20.57, width: 9.78, max_tolerance: 0.127, support_height: 1.57 },
  pcb: {
    opening_length: 20.9,
    opening_width: 10.1,
    thickness: 2,
    relief_diameter: 2,
    opening_mode: 'auto',
    opening_rule: 'delta',
  },
  copper: {
    base_length: 40,
    base_width: 30,
    base_thickness: 3,
    corner_radius: 3,
    hole_diameter: 3,
    hole_edge_offset: 4,
    hole_corners: ['bottom_left', 'top_right'],
    pad_size: 1.5,
  },
  boss: {
    length: 20.6,
    width: 9.8,
    total_height: 0.48,
    center_from_left: 20,
    center_from_bottom: 15,
    size_mode: 'auto',
    height_mode: 'auto',
  },
  stack: { lead_solder: 0.1, board_solder: 0.1, flange_gap: 0.3, pad_height: 0.15 },
  preform: { length: 20.6, width: 9.8, chamfer: chamferFor(1.5), trial_delta: TRIAL_DELTA, thickness_override: null },
  layout: { border_width: 1, epad_size: 1.5, web_width: 0.3, hole_clearance: 4 },
  tolerances: defaultTolerances(),
  trial_result: emptyTrial(),
  // 12-character part numbers (10-character base + 2-digit REV) of the drawn parts.
  part_numbers: emptyPartNumbers(),
};
export const fields = {
  package: ['PA 封裝', { length: 'PA 長度', width: 'PA 寬度', support_height: '支撐高度 SPH' }],
  pcb: [
    'PCB 開孔',
    {
      opening_length: '開孔長度 M',
      opening_width: '開孔寬度 N',
      thickness: 'PCB 厚度 C',
      relief_diameter: '避空孔徑 O',
    },
  ],
  copper: [
    '銅塊',
    {
      base_length: '基座長度 E',
      base_width: '基座寬度 F',
      base_thickness: '基座厚度 G',
      corner_radius: '四角半徑 R',
      hole_diameter: '吊掛孔徑 D',
      hole_edge_offset: '孔中心距邊 C',
      pad_size: '小凸台邊長 J',
    },
  ],
  boss: [
    '中凸台／小凸台',
    {
      length: '中凸台長度 I',
      width: '中凸台寬度 H',
      total_height: '中凸台總高 L',
      center_from_left: '中心距左邊 Xc',
      center_from_bottom: '中心距下邊 Yc',
    },
  ],
  stack: [
    '高度堆疊',
    {
      lead_solder: '引腳下錫厚 A',
      board_solder: '銅塊／PCB 錫厚 B',
      flange_gap: 'PA 至中凸台 D',
      pad_height: '小凸台高度 K',
    },
  ],
  preform: [
    '錫片設計',
    {
      length: '錫片長度 W',
      width: '錫片寬度 X',
      chamfer: '45° 削角 Y',
      trial_delta: '試片厚度增減量',
      thickness_override: '選定錫厚 Z',
    },
  ],
  layout: [
    '綠漆／E-PAD',
    { border_width: '外框綠漆 R', epad_size: 'E-PAD 邊長 S', web_width: '格間綠漆 T', hole_clearance: '定位孔避讓 V' },
  ],
};
const zero = new Set([
  'max_tolerance',
  'lead_solder',
  'board_solder',
  'flange_gap',
  'trial_delta',
  'center_from_left',
  'center_from_bottom',
]);
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
// Notes that hold for every design. calculate() lists them first in `warnings`;
// the workspace raises only the warnings a particular design adds to them.
export const STANDING_NOTES = Object.freeze([
  '銅塊 E/F 由 thermal／RF 設計定義，40 × 30 mm 僅為示範外形。',
  '未指定的公差在極限分析中暫按 0；請解鎖填入製造規格後再評估。',
  '試片增減量固定 ±0.15 mm；錫片製造公差 ±0.02 mm 另行設定。',
  '錫厚仍為設計尺寸（Typ.）體積估算，未含全公差錫量堆疊、損耗與空洞率。',
]);
export const ceilTenth = v => Math.ceil(v * 10 - Number.EPSILON * Math.abs(v) * 10) / 10;
// Fixed process capability from PPT p8. It is not a user-entered dimensional tolerance.
export const PLACEMENT_ALLOWANCE = 0.066;
export function openingRecommendation(d) {
  const factor = d.pcb.opening_rule === 'ampleon' ? 0.5 : 1;
  const maximum = [
    d.package.length + getTolerance(d, 'package.length').plus,
    d.package.width + getTolerance(d, 'package.width').plus,
  ];
  // Compensate for an undersized manufactured opening. With asymmetric
  // tolerances this is the negative allowance, not the positive allowance.
  const pcbTolerance = ['pcb.opening_length', 'pcb.opening_width'].map(key => getTolerance(d, key).minus);
  const raw = maximum.map((v, i) => v + PLACEMENT_ALLOWANCE + pcbTolerance[i] * factor);
  return {
    maximum,
    raw,
    rounded: raw.map(ceilTenth),
    factor,
    placement_allowance: PLACEMENT_ALLOWANCE,
    pcb_tolerances: pcbTolerance,
  };
}
// PCB relief: four outward half-discs centred on the opening's short edges
// (p7/p9). Each side's two half-discs may overlap when N < 2·O; the union area
// subtracts half of each circular lens. Inner halves lie inside M × N.
export function reliefArea(b) {
  const r = b.relief_diameter / 2,
    d = b.opening_width - 2 * r;
  const lens = d < 2 * r ? 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d) : 0;
  return 2 * Math.PI * r * r - lens;
}
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
// Project metadata only (display name, project ID, PA brand and model); independent of geometry.
// project_id belongs to this tool only; it is never read from or written to AI-Thermal.
const PROJECT_LABELS = { name: '專案名稱', project_id: '專案ID', pa_brand: 'PA 品牌', pa_model: 'PA 型號' };
export function normalizeProject(project) {
  const result = structuredClone(defaults.project);
  check(project && typeof project === 'object' && !Array.isArray(project), '專案資料須為設定物件。');
  for (const key of Object.keys(project)) check(Object.hasOwn(result, key), `未知專案欄位：${key}`);
  for (const key of Object.keys(result)) {
    const value = Object.hasOwn(project, key) ? project[key] : result[key];
    check(
      // eslint-disable-next-line no-control-regex -- project text must be a single printable line
      typeof value === 'string' && !/[\u0000-\u001f\u007f]/.test(value),
      `${PROJECT_LABELS[key]}須為單行文字。`,
    );
    result[key] = value.trim();
    check(
      result[key].length <= 100 && (key !== 'name' || result[key].length > 0),
      `${PROJECT_LABELS[key]}長度須為${key === 'name' ? '1' : '0'}至100字。`,
    );
  }
  return result;
}
export function normalize(input) {
  check(input && typeof input === 'object' && !Array.isArray(input), '請輸入有效的設計參數。');
  for (const key of Object.keys(input)) check(Object.hasOwn(defaults, key), `未知欄位：${key}`);
  const d = structuredClone(defaults);
  d.name = input.name ?? d.name;
  check(
    typeof d.name === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(d.name),
    'CAD 檔名代碼須以英文字母開頭，使用英數字、_ 或 -，最多40字。',
  );
  d.project = normalizeProject(Object.hasOwn(input, 'project') ? input.project : {});
  for (const group of Object.keys(fields)) {
    const values = input[group] ?? {};
    check(values && typeof values === 'object' && !Array.isArray(values), `${group} 須為設定物件。`);
    for (const key of Object.keys(values))
      check(
        Object.hasOwn(d[group], key) || (group === 'pcb' && ['placement_accuracy', 'opening_tolerance'].includes(key)),
        `未知欄位：${group}.${key}`,
      );
    for (const key of Object.keys(d[group])) if (Object.hasOwn(values, key)) d[group][key] = values[key];
    for (const [key, value] of Object.entries(d[group])) {
      if (group === 'copper' && key === 'hole_corners') {
        check(
          Array.isArray(value) &&
            value.length >= 1 &&
            value.length <= 4 &&
            new Set(value).size === value.length &&
            value.every(k => Object.hasOwn(holeCorners, k)),
          '吊掛孔請選擇一至四個不同角位。',
        );
        continue;
      }
      if (
        (group === 'pcb' && ['opening_mode', 'opening_rule'].includes(key)) ||
        (group === 'boss' && ['size_mode', 'height_mode'].includes(key))
      )
        continue;
      if (key === 'thickness_override' && value === null) continue;
      check(
        typeof value === 'number' &&
          Number.isFinite(value) &&
          value <= 10000 &&
          (zero.has(key) ? value >= 0 : value > 0),
        `${fields[group][1][key] || key} 的數值無效。`,
      );
    }
  }
  check(
    ['base_length', 'base_width'].every(k => Object.hasOwn(input.copper ?? {}, k)),
    '銅塊基座 E/F 須由 thermal／RF 設計明確提供，不自動套用 40 × 30 示範值。',
  );
  try {
    d.part_numbers = normalizePartNumbers(input.part_numbers);
  } catch (error) {
    check(false, error.message);
  }
  const record = input.trial_result ?? emptyTrial();
  check(
    record &&
      typeof record === 'object' &&
      !Array.isArray(record) &&
      Object.keys(record).every(k => Object.hasOwn(emptyTrial(), k)),
    '試片驗證記錄格式無效。',
  );
  d.trial_result = { ...emptyTrial(), ...record };
  check(
    trialChoices.includes(d.trial_result.choice) && typeof d.trial_result.locked === 'boolean',
    '試片選項或鎖定狀態無效。',
  );
  if (d.trial_result.locked)
    check(
      typeof d.trial_result.value === 'number' &&
        Number.isFinite(d.trial_result.value) &&
        d.trial_result.value > 0 &&
        typeof d.trial_result.signature === 'string' &&
        typeof d.trial_result.confirmed_at === 'string' &&
        ISO_TIMESTAMP.test(d.trial_result.confirmed_at) &&
        !Number.isNaN(Date.parse(d.trial_result.confirmed_at)),
      '已鎖定的試片須包含尺寸、設計指紋與 ISO 8601 驗證時間。',
    );
  const supplied = input.tolerances ?? {};
  check(supplied && typeof supplied === 'object' && !Array.isArray(supplied), '公差須為設定物件。');
  for (const [key, pair] of Object.entries(supplied)) {
    check(Object.hasOwn(toleranceDefaults, key), `未知公差：${key}`);
    check(
      pair &&
        typeof pair === 'object' &&
        !Array.isArray(pair) &&
        Object.keys(pair).every(k => ['minus', 'plus', 'source'].includes(k)) &&
        (!Object.hasOwn(pair, 'source') || typeof pair.source === 'string'),
      `${key} 公差格式無效。`,
    );
    for (const side of ['minus', 'plus']) if (Object.hasOwn(pair, side)) d.tolerances[key][side] = pair[side];
  }
  // Older files used one PA tolerance and one PCB opening tolerance.
  if (input.package && Object.hasOwn(input.package, 'max_tolerance'))
    for (const key of ['package.length', 'package.width'])
      if (!Object.hasOwn(supplied, key))
        d.tolerances[key] = { minus: input.package.max_tolerance, plus: input.package.max_tolerance };
  if (input.pcb && Object.hasOwn(input.pcb, 'opening_tolerance'))
    for (const key of ['pcb.opening_length', 'pcb.opening_width'])
      if (!Object.hasOwn(supplied, key))
        d.tolerances[key] = { minus: input.pcb.opening_tolerance, plus: input.pcb.opening_tolerance };
  for (const [key, pair] of Object.entries(d.tolerances))
    for (const side of ['minus', 'plus'])
      check(
        typeof pair[side] === 'number' && Number.isFinite(pair[side]) && pair[side] >= 0 && pair[side] <= 10000,
        `${key} 公差須為有限、非負數值。`,
      );
  d.package.max_tolerance = Math.max(getTolerance(d, 'package.length').plus, getTolerance(d, 'package.width').plus);
  if (
    input.pcb &&
    !Object.hasOwn(input.pcb, 'opening_mode') &&
    ['opening_length', 'opening_width'].some(k => Object.hasOwn(input.pcb, k))
  )
    d.pcb.opening_mode = 'manual';
  check(['auto', 'manual'].includes(d.pcb.opening_mode), 'PCB 開窗模式須為 auto 或 manual。');
  check(['delta', 'ampleon'].includes(d.pcb.opening_rule), 'PCB 開窗規則須為 delta 或 ampleon。');
  check(['auto', 'manual'].includes(d.boss.size_mode), '中凸台長寬模式須為 auto 或 manual。');
  check(d.boss.height_mode === 'auto', 'PPT 第六頁：中凸台總高 L 固定依高度堆疊自動計算。');
  check(
    d.stack.lead_solder === 0.1 && d.stack.board_solder === 0.1 && d.stack.flange_gap === 0.3,
    'PPT 第六頁的 A、B、D 採固定建議值 0.1／0.1／0.3 mm；調整 PCB 厚度與小凸台 K。',
  );
  if (!input.boss || !Object.hasOwn(input.boss, 'center_from_left')) d.boss.center_from_left = d.copper.base_length / 2;
  if (!input.boss || !Object.hasOwn(input.boss, 'center_from_bottom'))
    d.boss.center_from_bottom = d.copper.base_width / 2;
  if (d.pcb.opening_mode === 'auto') [d.pcb.opening_length, d.pcb.opening_width] = openingRecommendation(d).rounded;
  if (d.boss.size_mode === 'auto') {
    d.boss.length = ceilTenth(d.package.length);
    d.boss.width = ceilTenth(d.package.width);
  }
  d.boss.total_height =
    d.pcb.thickness +
    d.stack.lead_solder +
    d.stack.board_solder -
    d.package.support_height -
    d.stack.flange_gap +
    d.stack.pad_height;
  d.preform.length = d.boss.length;
  d.preform.width = d.boss.width;
  d.preform.chamfer = chamferFor(d.copper.pad_size);
  d.preform.trial_delta = TRIAL_DELTA;
  return d;
}
export function gapAnalysis(d) {
  const axis = (windowKey, paKey, w, p) => {
    const window = dimensionRange(d, windowKey, w),
      pa = dimensionRange(d, paKey, p);
    return { nominal: (w - p) / 2, min: (window.min - pa.max) / 2, max: (window.max - pa.min) / 2, window, pa };
  };
  const x = axis('pcb.opening_length', 'package.length', d.pcb.opening_length, d.package.length),
    y = axis('pcb.opening_width', 'package.width', d.pcb.opening_width, d.package.width);
  return {
    x,
    y,
    overlap: x.min < 0 || y.min < 0,
    concentric: true,
    assumptions: [
      '固定設計條件：PA 金屬底座與 PCB 開窗保持同心。',
      'Typ. 是未加公差的設計尺寸；最小與最大由上下公差推算。',
      '共同跟隨中凸台移位，兩者共用同一中心。',
    ],
  };
}
export function calculate(input) {
  const d = normalize(input),
    b = d.pcb,
    c = d.copper,
    s = d.stack,
    t = d.preform,
    q = d.boss;
  const I = q.length,
    H = q.width,
    L = q.total_height,
    gap = L + s.flange_gap - s.pad_height,
    center = [q.center_from_left - c.base_length / 2, q.center_from_bottom - c.base_width / 2];
  check(L > s.pad_height && gap > L, '高度堆疊無效：中凸台總高 L 必須大於小凸台高度 K，PA 底面必須高於小凸台。');
  check([2.5, 3].includes(c.base_thickness), '規範基座厚度 G 為 2.5 或 3.0 mm。');
  check(c.corner_radius < Math.min(c.base_length, c.base_width) / 2, '銅塊四角半徑超出基座範圍。');
  check(
    c.base_length > b.opening_length && b.opening_length >= I && c.base_width > b.opening_width && b.opening_width >= H,
    '基座須大於 PCB 開孔，開孔不可小於中凸台。',
  );
  check(b.relief_diameter < Math.min(b.opening_length, b.opening_width), '避空孔徑超出開孔尺寸。');
  check(c.pad_size < Math.min(I, H) / 2, '四角小凸台尺寸過大。');
  check(
    t.chamfer > 2 * c.pad_size && t.chamfer < Math.min(I, H) / 2,
    '削角須大於兩倍小凸台邊長，並小於錫片短邊的一半。',
  );
  check(2 * c.hole_edge_offset < Math.min(c.base_length, c.base_width), '吊掛孔中心不在基座內。');
  check(c.hole_diameter < Math.min(c.base_length, c.base_width) / 2, '吊掛孔徑須小於基座短邊的一半。');
  const footprint = copperFootprint(c);
  check(footprint.area > 1e-6 && footprint.profile.length === 1, '開孔使銅塊基座斷開或完全消失，請縮小孔徑。');
  // Rounded corners are created first. Hole centers are independent edge datums;
  // a large circle may genuinely break out through the rounded boundary.
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      check(
        roundedBaseDistance(center[0] + (x * I) / 2, center[1] + (y * H) / 2, c) <= 1e-7,
        '中凸台超出銅塊圓角基座，請調整中心位置或尺寸。',
      );
  const rad = c.hole_diameter / 2;
  for (const [hx, hy] of footprint.centers)
    check(
      Math.hypot(Math.max(Math.abs(hx - center[0]) - I / 2, 0), Math.max(Math.abs(hy - center[1]) - H / 2, 0)) >
        rad + 1e-8,
      '吊掛孔與中凸台相交，請調整孔位、孔徑或凸台位置。',
    );
  check(d.layout.epad_size > 0 && d.layout.web_width > 0, 'E-PAD 與格間綠漆尺寸須大於零。');
  const relief = reliefArea(b),
    cavity = (b.opening_length * b.opening_width + relief) * gap;
  const boss = I * H * (L - s.pad_height) + 4 * c.pad_size ** 2 * s.pad_height,
    volume = cavity - boss,
    area = I * H - 2 * t.chamfer ** 2;
  check(volume > 0 && area > 0, '體積扣除後錫量或錫片面積非正值。');
  const z = volume / area;
  check(z - t.trial_delta > 0, '試作厚度差值過大，最薄試片須大於零。');
  const openingChain = openingRecommendation(d),
    clearance = (t.chamfer - 2 * c.pad_size) / Math.SQRT2,
    analysis = gapAnalysis(d);
  const warnings = [...STANDING_NOTES];
  if (footprint.breakouts) warnings.push('吊掛孔已穿破圓角／外緣；預覽與出圖保留實際缺口。');
  if (footprint.outside_holes) warnings.push('有吊掛孔刀具圓未切到圓角基座，實際模型不會出現該孔。');
  if (footprint.tangent_holes) warnings.push('孔與基座外形恰好相接；顯示實際輪廓，出圖仍會驗證單一實體。');
  if (d.layout.hole_clearance < c.hole_diameter) warnings.push('定位孔避讓 V 小於實際孔徑 D；Layout 仍扣除實際孔。');
  if (analysis.overlap) warnings.push('PA／PCB 單邊最小間隙為負值，公差極限下可能干涉。');
  if (
    I + getTolerance(d, 'boss.length').plus > b.opening_length - getTolerance(d, 'pcb.opening_length').minus ||
    H + getTolerance(d, 'boss.width').plus > b.opening_width - getTolerance(d, 'pcb.opening_width').minus
  )
    warnings.push('中凸台最大尺寸大於 PCB 最小開孔，公差極限下凸台可能與開孔干涉。');
  if (b.opening_length < openingChain.rounded[0] || b.opening_width < openingChain.rounded[1])
    warnings.push(`手動開孔小於 ${b.opening_rule} 規則建議值 ${openingChain.rounded.join(' × ')} mm。`);
  if (Math.hypot(...center) > 1e-6)
    warnings.push(
      `中凸台未置中：相對基座中心偏移 X ${Number(center[0].toFixed(4))} mm、Y ${Number(center[1].toFixed(4))} mm；如需置中請按「置中」。`,
    );
  if (
    input?.pcb &&
    Object.hasOwn(input.pcb, 'placement_accuracy') &&
    input.pcb.placement_accuracy !== PLACEMENT_ALLOWANCE
  )
    warnings.push(
      `pcb.placement_accuracy 已停用；開窗固定採 PPT 第8頁貼片能力 ${PLACEMENT_ALLOWANCE} mm，輸入值 ${input.pcb.placement_accuracy} 未使用。`,
    );
  if (q.size_mode === 'manual') warnings.push('中凸台 I/H 使用手動設計尺寸（Typ.）；錫片 W/X 跟隨中凸台。');
  const trial = trialState(d, z);
  t.thickness_override = trial.model;
  if (trial.status === 'stale') warnings.push('設計尺寸已變更：已記錄的試驗結果需解鎖並重新驗證。');
  const ranges = {};
  for (const [group, [, names]] of Object.entries(fields))
    for (const key of Object.keys(names)) {
      const value = key === 'thickness_override' ? (t.thickness_override ?? z) : d[group][key];
      ranges[`${group}.${key}`] = dimensionRange(d, `${group}.${key}`, value);
    }
  return {
    design: d,
    boss_length: I,
    boss_width: H,
    boss_total_height: L,
    boss_lower_height: L - s.pad_height,
    boss_center: center,
    copper_to_flange: gap,
    relief_area: relief,
    cavity_volume: cavity,
    boss_volume: boss,
    solder_volume: volume,
    preform_area: area,
    calculated_thickness: z,
    model_thickness: trial.model,
    trial_status: trial.status,
    trial_signature: trial.signature,
    trial_thicknesses: trial.trials,
    recommended_opening: openingChain.rounded,
    opening_chain: openingChain,
    corner_clearance: clearance,
    heatsink_depth: c.base_thickness + 0.05,
    copper_base_area: footprint.area,
    copper_volume: footprint.area * c.base_thickness + boss,
    hole_breakouts: footprint.breakouts,
    hole_tangencies: footprint.tangent_holes,
    gap_analysis: analysis,
    dimension_ranges: ranges,
    pa_envelope: {
      min_length: ranges['package.length'].min,
      max_length: ranges['package.length'].max,
      min_width: ranges['package.width'].min,
      max_width: ranges['package.width'].max,
    },
    warnings,
  };
}
export function octagon(l, w, c) {
  const x = l / 2,
    y = w / 2;
  return [
    [-x + c, -y],
    [x - c, -y],
    [x, -y + c],
    [x, y - c],
    [x - c, y],
    [-x + c, y],
    [-x, y - c],
    [-x, -y + c],
  ];
}
export function nativeJob(r) {
  const d = r.design,
    c = d.copper;
  return {
    schema_version: 2,
    status: 'awaiting_local_creo_execution',
    target: { product: 'Creo Parametric', version: '7.0.10.0', os: 'Windows 11' },
    name: d.name,
    units: 'mm',
    required_model_type: 'native_parametric_features',
    step_import_acceptable: false,
    design: d,
    derived: r,
    native_parameters: {
      copper: {
        BASE_L: c.base_length,
        BASE_W: c.base_width,
        BASE_T: c.base_thickness,
        BASE_R: c.corner_radius,
        HOLE_D: c.hole_diameter,
        HOLE_EDGE: c.hole_edge_offset,
        ...(holeMask(c) !== 9 ? { HOLE_MASK: holeMask(c) } : {}),
        BOSS_L: r.boss_length,
        BOSS_W: r.boss_width,
        CUH: r.boss_total_height,
        PAD_SIZE: c.pad_size,
        PAD_H: d.stack.pad_height,
        BOSS_X: r.boss_center[0],
        BOSS_Y: r.boss_center[1],
      },
      preform: {
        PREFORM_L: r.boss_length,
        PREFORM_W: r.boss_width,
        CHAMFER_Y: d.preform.chamfer,
        PREFORM_Z: r.model_thickness,
      },
    },
    required_features: {
      copper: ['BASE_EXTRUDE', 'BASE_ROUNDS', 'MOUNT_HOLES', 'MAIN_BOSS', 'CORNER_PADS'],
      preform: ['PREFORM_EXTRUDE'],
    },
    expected: {
      copper: {
        volume: r.copper_volume,
        bounds: [c.base_length, c.base_width, c.base_thickness + r.boss_total_height],
      },
      preform: { volume: r.preform_area * r.model_thickness, bounds: [r.boss_length, r.boss_width, r.model_thickness] },
    },
    note: 'Native parametric masters with boss offset parameters and actual licensed Creo execution are required. The website does not generate native PRT files.',
  };
}
