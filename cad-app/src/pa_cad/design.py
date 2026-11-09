"""Design dimensions (Typ.) transcribed from pages 3–13 of the specification."""
from __future__ import annotations

from dataclasses import asdict, dataclass, fields, field, replace
from decimal import Decimal, ROUND_CEILING, ROUND_HALF_UP
import math
from pathlib import Path
import re

import yaml
from .creo import rounded_base_area, rounded_boundary_distance


def chamfer_for(pad):
    return float(Decimal(str(2*pad+math.sqrt(2)*.2828)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


# Process values fixed by PPT p6 (A, B, D) and p8 (placement capability).
FIXED_STACK = {"lead_solder": .1, "board_solder": .1, "flange_gap": .3}
PLACEMENT_ALLOWANCE = .066
ISO_TIMESTAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})")


def relief_area(opening_width: float, relief_diameter: float) -> float:
    """Union area of the four outward PCB relief half-discs (p7/p9).

    The two half-discs on one short edge overlap when N < 2·O; half of each
    circular lens is then removed. Mirrors web/src/design.js reliefArea().
    """
    r = relief_diameter/2
    d = opening_width-2*r
    lens = 2*r*r*math.acos(d/(2*r))-(d/2)*math.sqrt(4*r*r-d*d) if d < 2*r else 0.
    return 2*math.pi*r*r-lens


@dataclass(frozen=True)
class Package:
    length: float = 20.57
    width: float = 9.78
    max_tolerance: float = 0.127
    support_height: float = 1.57


@dataclass(frozen=True)
class PCB:
    opening_length: float = 20.9
    opening_width: float = 10.1
    thickness: float = 2.0
    relief_diameter: float = 2.0
    placement_accuracy: float = 0.066
    opening_tolerance: float = 0.1
    opening_mode: str = "auto"  # from_mapping keeps legacy files with M/N but no mode manual.
    opening_rule: str = "delta"


@dataclass(frozen=True)
class Copper:
    base_length: float = 40.0
    base_width: float = 30.0
    base_thickness: float = 3.0
    corner_radius: float = 3.0
    hole_diameter: float = 3.0
    hole_edge_offset: float = 4.0
    hole_corners: tuple = ("bottom_left", "top_right")
    pad_size: float = 1.5


@dataclass(frozen=True)
class Stack:
    lead_solder: float = 0.1
    board_solder: float = 0.1
    flange_gap: float = 0.3
    pad_height: float = 0.15


@dataclass(frozen=True)
class Preform:
    chamfer: float = chamfer_for(1.5)
    trial_delta: float = 0.15
    thickness_override: float | None = None
    length: float | None = None
    width: float | None = None


@dataclass(frozen=True)
class Boss:
    length: float | None = None
    width: float | None = None
    total_height: float | None = None
    center_from_left: float | None = None
    center_from_bottom: float | None = None
    size_mode: str = "auto"
    height_mode: str = "auto"


@dataclass(frozen=True)
class Layout:
    """Browser Layout metadata; never contributes to copper/preform solids."""
    border_width: float = 1.0
    epad_size: float = 1.5
    web_width: float = 0.3
    hole_clearance: float = 4.0


@dataclass(frozen=True)
class Project:
    """Display metadata; independent of the safe CAD file name and geometry."""
    name: str = "未命名專案"
    pa_model: str = "H-37248KC-6/2"
    pa_brand: str = ""  # last, so positional Project(name, pa_model) keeps working


@dataclass(frozen=True)
class Design:
    name: str = "pa_780_m1p"
    package: Package = field(default_factory=Package)
    pcb: PCB = field(default_factory=PCB)
    copper: Copper = field(default_factory=Copper)
    stack: Stack = field(default_factory=Stack)
    preform: Preform = field(default_factory=Preform)
    layout: Layout = field(default_factory=Layout)
    boss: Boss = field(default_factory=Boss)
    tolerances: dict = field(default_factory=dict)
    project: Project = field(default_factory=Project)
    trial_result: dict = field(default_factory=lambda: {"choice":"middle", "locked":False, "value":None, "signature":None, "confirmed_at":None})

    @classmethod
    def from_mapping(cls, data: dict) -> Design:
        if not isinstance(data, dict):
            raise ValueError("設定必須是 YAML mapping")
        expected = {f.name for f in fields(cls)}
        if unknown := set(data) - expected:
            raise ValueError(f"未知設定欄位: {sorted(unknown)}")
        data = {**data, "name": data.get("name", "pa_780_m1p")}
        if not isinstance(data.get("name"), str) or not re.fullmatch(
            r"[A-Za-z][A-Za-z0-9_-]{0,39}", data["name"]
        ):
            raise ValueError("name 須為英文字母開頭、最多 40 個英數字或 _ -")
        project_data = data.get("project", {})
        if not isinstance(project_data, dict):
            raise ValueError("project 必須是 mapping")
        if unknown := set(project_data)-{"name", "pa_brand", "pa_model"}:
            raise ValueError(f"未知專案欄位: {sorted(unknown)}")
        project_values = asdict(Project())
        for key, value in project_data.items():
            if not isinstance(value, str) or re.search(r"[\x00-\x1f\x7f]", value):
                raise ValueError(f"project.{key} 須為單行文字")
            value = value.strip()
            if len(value) > 100 or (key == "name" and not value):
                raise ValueError(f"project.{key} 須為最多 100 字的有效文字")
            project_values[key] = value
        project = Project(**project_values)
        trial = {"choice":"middle", "locked":False, "value":None, "signature":None, "confirmed_at":None}
        source_trial = data.get("trial_result", {})
        if not isinstance(source_trial, dict) or set(source_trial)-set(trial):
            raise ValueError("試片驗證記錄格式無效")
        trial.update(source_trial)
        if trial["choice"] not in ("lower", "middle", "upper") or not isinstance(trial["locked"], bool):
            raise ValueError("試片選項或鎖定狀態無效")
        if trial["locked"] and (isinstance(trial["value"],bool) or not isinstance(trial["value"],(float,int)) or not math.isfinite(trial["value"]) or trial["value"]<=0 or not isinstance(trial["signature"],str) or not isinstance(trial["confirmed_at"],str)
                                or not ISO_TIMESTAMP.fullmatch(trial["confirmed_at"])):
            raise ValueError("已鎖定試片須有尺寸、設計指紋與 ISO 8601 驗證時間")
        groups = {}
        for name, typ in (("package", Package), ("pcb", PCB), ("copper", Copper),
                          ("stack", Stack), ("preform", Preform), ("layout", Layout), ("boss", Boss)):
            source = data.get(name, {})
            if not isinstance(source, dict):
                raise ValueError(f"{name} 必須是 mapping")
            if name == "copper" and not {"base_length", "base_width"} <= set(source):
                raise ValueError("銅塊基座 E/F 須由 thermal／RF 設計明確提供，不自動套用 40 × 30 示範值")
            if name == "pcb" and "opening_mode" not in source and {"opening_length", "opening_width"} & set(source):
                source = {**source, "opening_mode": "manual"}
            try:
                group = typ(**source)
            except TypeError as exc:
                raise ValueError(f"{name} 欄位不完整或不支援: {exc}") from exc
            for f in fields(group):
                value = getattr(group, f.name)
                if name == 'copper' and f.name == 'hole_corners':
                    if not isinstance(value, (list, tuple)) or not 1 <= len(value) <= 4 or any(not isinstance(k,str) or k not in ('bottom_left','bottom_right','top_left','top_right') for k in value) or len(set(value)) != len(value):
                        raise ValueError('吊掛孔請選擇一至四個不同角位')
                    continue
                if name == "boss" and f.name in {"size_mode", "height_mode"}:
                    if value not in {"auto", "manual"}:
                        raise ValueError(f"boss.{f.name} 不支援此設定")
                    continue
                if name == "boss" and value is None:
                    continue
                if name == "pcb" and f.name in {"opening_mode", "opening_rule"}:
                    choices = {"auto", "manual"} if f.name == "opening_mode" else {"delta", "ampleon"}
                    if not isinstance(value, str) or value not in choices:
                        raise ValueError(f"pcb.{f.name} 不支援此設定")
                    continue
                if name == "preform" and f.name in {"thickness_override", "length", "width"} and value is None:
                    continue
                if (isinstance(value, bool) or not isinstance(value, (int, float))
                        or not math.isfinite(value)):
                    raise ValueError(f"{name}.{f.name} 須為有限數值")
                zero_allowed = f.name in {"max_tolerance", "placement_accuracy", "opening_tolerance",
                                          "lead_solder", "board_solder", "flange_gap", "trial_delta",
                                          "center_from_left", "center_from_bottom"}
                if value < 0 or value > 10000 or (value == 0 and not zero_allowed):
                    raise ValueError(f"{name}.{f.name} 超出有效範圍")
            groups[name] = group
        if groups["boss"].height_mode != "auto":
            raise ValueError("PPT 第六頁：中凸台總高 L 固定依高度堆疊自動計算")
        if any(getattr(groups["stack"], key) != value for key, value in FIXED_STACK.items()):
            raise ValueError("PPT 第六頁的 A、B、D 採固定建議值 0.1／0.1／0.3 mm；調整 PCB 厚度與小凸台 K")
        tolerances = data.get("tolerances", {})
        if not isinstance(tolerances, dict):
            raise ValueError("tolerances 必須是 mapping")
        normalized = {}
        for key, pair in tolerances.items():
            if key not in TOLERANCE_DEFAULTS or not isinstance(pair, dict):
                raise ValueError(f"未知公差：{key}")
            if set(pair)-{"minus", "plus", "source"}:
                raise ValueError(f"{key} 公差格式無效")
            # A missing side keeps the table default, as in web/src/design.js
            # (legacy max_tolerance/opening_tolerance apply only to absent keys).
            default = TOLERANCE_DEFAULTS[key]
            pair = {"minus": pair.get("minus", default[0]), "plus": pair.get("plus", default[1]),
                    **({"source": pair["source"]} if "source" in pair else {})}
            normalized[key] = pair
            for side in ("minus", "plus"):
                value = pair[side]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 10000:
                    raise ValueError(f"{key} 公差須為有限非負數值")
            if "source" in pair and not isinstance(pair["source"], str):
                raise ValueError(f"{key} 公差來源須為文字")
        design = cls(data["name"], **groups, tolerances=normalized, project=project, trial_result=trial)
        if design.pcb.opening_mode == "auto":
            length, width = recommended_opening(design)
            design = replace(design, pcb=replace(design.pcb, opening_length=length, opening_width=width))
        length, width, height, center = boss_dimensions(design)
        design = replace(design, boss=replace(design.boss, length=length, width=width, total_height=height,
                                             center_from_left=center[0]+design.copper.base_length/2,
                                             center_from_bottom=center[1]+design.copper.base_width/2),
                         preform=replace(design.preform, length=length, width=width, chamfer=chamfer_for(design.copper.pad_size), trial_delta=.15))
        calculate(design)  # Cross-field physical validation, also used by direct callers.
        return design

    @classmethod
    def load(cls, path: str | Path) -> Design:
        return cls.from_mapping(yaml.safe_load(Path(path).read_text(encoding="utf-8")))

    def to_mapping(self) -> dict:
        return asdict(self)


def ceil_tenth(value: float) -> float:
    return float(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_CEILING))


def recommended_opening(d: Design) -> tuple[float, float]:
    factor = Decimal("0.5") if d.pcb.opening_rule == "ampleon" else Decimal("1")
    return tuple(ceil_tenth(float(Decimal(str(v))+Decimal(str(tolerance(d, f"package.{axis}")[1]))
                                 + Decimal("0.066")
                                 + Decimal(str(tolerance(d, f"pcb.opening_{axis}")[0]))*factor))
                 for axis, v in (("length", d.package.length), ("width", d.package.width)))


# Same keys and (minus, plus) defaults as web/src/tolerances.js; a parity test
# keeps the two tables identical.
TOLERANCE_DEFAULTS = {
    "package.length": (.127, .127), "package.width": (.127, .127), "package.support_height": (0, 0),
    "pcb.opening_length": (.1, .1), "pcb.opening_width": (.1, .1),
    "pcb.thickness": (0, 0), "pcb.relief_diameter": (0, 0),
    "copper.base_length": (.2, .2), "copper.base_width": (.2, .2),
    "copper.base_thickness": (.1, 0), "copper.corner_radius": (0, 0), "copper.hole_diameter": (0, 0),
    "copper.hole_edge_offset": (.1, .1), "copper.pad_size": (.05, .05),
    "boss.length": (.05, .05), "boss.width": (.05, .05), "boss.total_height": (.1, 0),
    "boss.center_from_left": (0, 0), "boss.center_from_bottom": (0, 0),
    "stack.lead_solder": (0, 0), "stack.board_solder": (0, 0), "stack.flange_gap": (0, 0),
    "stack.pad_height": (.05, .05),
    "preform.length": (.1, .1), "preform.width": (.1, .1), "preform.chamfer": (0, .2),
    "preform.trial_delta": (0, 0), "preform.thickness_override": (.02, .02),
    "layout.border_width": (0, 0), "layout.epad_size": (0, 0), "layout.web_width": (0, 0),
    "layout.hole_clearance": (0, 0),
}
DEFAULT_TOLERANCES = TOLERANCE_DEFAULTS  # Backward-compatible name.



def tolerance(d: Design, key: str) -> tuple[float, float]:
    if key in d.tolerances:
        pair = d.tolerances[key]
        return pair["minus"], pair["plus"]
    if key in {"package.length", "package.width"}:
        return d.package.max_tolerance, d.package.max_tolerance
    if key in {"pcb.opening_length", "pcb.opening_width"}:
        return d.pcb.opening_tolerance, d.pcb.opening_tolerance
    # Zero is only a calculation fallback for an unspecified tolerance, never
    # a claim that the source drawing specifies perfect manufacture.
    return TOLERANCE_DEFAULTS.get(key, (0., 0.))


def boss_dimensions(d: Design):
    b, p, s, pcb, c = d.boss, d.package, d.stack, d.pcb, d.copper
    length = ceil_tenth(p.length) if b.size_mode == "auto" else b.length
    width = ceil_tenth(p.width) if b.size_mode == "auto" else b.width
    height = (pcb.thickness+s.lead_solder+s.board_solder-p.support_height-s.flange_gap+s.pad_height
              if b.height_mode == "auto" else b.total_height)
    if any(v is None or v <= 0 for v in (length, width, height)):
        raise ValueError("中凸台手動尺寸與高度須為正值")
    center = ((b.center_from_left if b.center_from_left is not None else c.base_length/2)-c.base_length/2,
              (b.center_from_bottom if b.center_from_bottom is not None else c.base_width/2)-c.base_width/2)
    return length, width, height, center


@dataclass(frozen=True)
class Result:
    boss_length: float  # I
    boss_width: float  # H
    boss_total_height: float  # L, relative to base top
    boss_lower_height: float  # L-K
    copper_to_flange: float  # L+D-K, relative to base top
    cavity_volume: float  # V1-1
    boss_volume: float  # V2, excludes base
    solder_volume: float  # V1
    preform_area: float  # A1
    calculated_thickness: float  # Z
    model_thickness: float
    trial_thicknesses: tuple[float, float, float]
    recommended_opening: tuple[float, float]
    corner_clearance: float
    heatsink_depth: float
    warnings: tuple[str, ...]
    boss_center: tuple[float, float]
    copper_base_area: float
    gap_analysis: dict
    preform_chamfer: float
    trial_status: str
    trial_signature: str


def trial_signature(d):
    mapping=d.to_mapping()
    length,width,height,center=boss_dimensions(d)
    mapping["boss"].update(length=length,width=width,total_height=height,center_from_left=center[0]+d.copper.base_length/2,center_from_bottom=center[1]+d.copper.base_width/2)
    if d.pcb.opening_mode=="auto":mapping["pcb"]["opening_length"],mapping["pcb"]["opening_width"]=recommended_opening(d)
    mapping["preform"]["chamfer"]=chamfer_for(d.copper.pad_size)
    paths=['package.length','package.width','package.support_height','pcb.opening_length','pcb.opening_width','pcb.thickness','pcb.relief_diameter','copper.base_length','copper.base_width','copper.base_thickness','copper.corner_radius','copper.hole_diameter','copper.hole_edge_offset','copper.pad_size','boss.length','boss.width','boss.total_height','boss.center_from_left','boss.center_from_bottom','stack.lead_solder','stack.board_solder','stack.flange_gap','stack.pad_height','preform.chamfer']
    return "|".join(f"{path}={mapping[path.split('.')[0]][path.split('.')[1]]:.9f}" for path in paths)+"|holes="+",".join(sorted(d.copper.hole_corners))


def calculate(d: Design) -> Result:
    p, b, c, s, t = d.package, d.pcb, d.copper, d.stack, d.preform
    t=replace(t, chamfer=chamfer_for(c.pad_size), trial_delta=.15)
    recommended = recommended_opening(d)
    if b.opening_mode == "auto":
        b = replace(b, opening_length=recommended[0], opening_width=recommended[1])
    length, width, height, center = boss_dimensions(d)
    gap = height + s.flange_gap - s.pad_height
    if not (height > s.pad_height and gap > height):
        raise ValueError("高度堆疊無效：L 必須大於小凸台高度，flange 必須高於小凸台頂面")
    if c.base_thickness not in (2.5, 3.0):
        raise ValueError("規範 G 僅支援 2.5 或 3.0 mm")
    if not (0 < c.corner_radius < min(c.base_length, c.base_width) / 2):
        raise ValueError("銅塊四角半徑超出基座範圍")
    if not (c.base_length > b.opening_length >= length and c.base_width > b.opening_width >= width):
        raise ValueError("銅塊基座須大於 PCB 開孔；PCB 開孔不可小於銅塊大凸台")
    if not (0 < b.relief_diameter < min(b.opening_length, b.opening_width)):
        raise ValueError("PCB relief 直徑超出開孔尺寸")
    if not (0 < c.pad_size < min(length, width) / 2):
        raise ValueError("四角小凸台尺寸過大")
    if not (2 * c.pad_size < t.chamfer < min(length, width) / 2):
        raise ValueError("錫片削角須大於兩倍小凸台邊長，且小於錫片短邊的一半")
    off, rad = c.hole_edge_offset, c.hole_diameter / 2
    if not c.hole_diameter < min(c.base_length, c.base_width) / 2:
        raise ValueError("吊掛孔徑須小於基座短邊的一半")
    if not (off > 0 and 2 * off < min(c.base_length, c.base_width)):
        raise ValueError("吊掛孔邊距不足，或孔位不在基座內")
    hx, hy = c.base_length / 2 - off, c.base_width / 2 - off
    if any(rounded_boundary_distance(center[0]+sx*length/2, center[1]+sy*width/2,
                                    c.base_length, c.base_width, c.corner_radius) > 1e-8
           for sx in (-1, 1) for sy in (-1, 1)):
        raise ValueError("中凸台超出銅塊圓角基座範圍")
    from .creo import mounting_centers, copper_hole_mask
    for hx, hy in mounting_centers({"BASE_L": c.base_length, "BASE_W": c.base_width, "HOLE_EDGE": off, "HOLE_MASK": copper_hole_mask(asdict(c))}):
        if math.hypot(max(abs(hx-center[0])-length/2, 0), max(abs(hy-center[1])-width/2, 0)) <= rad:
            raise ValueError("吊掛孔與中凸台相交")
    relief = relief_area(b.opening_width, b.relief_diameter)
    cavity = (b.opening_length * b.opening_width + relief) * gap
    boss = length * width * (height - s.pad_height) + 4 * c.pad_size**2 * s.pad_height
    volume = cavity - boss
    area = length * width - 2 * t.chamfer**2
    if volume <= 0 or area <= 0:
        raise ValueError("體積扣除後錫量或錫片面積非正值")
    z = volume / area
    trials = (z - t.trial_delta, z, z + t.trial_delta)
    if trials[0] <= 0:
        raise ValueError("厚度試作差值過大，最薄試片厚度必須大於零")
    warnings = [
        "銅塊外形 E/F 為使用者輸入，須由 thermal / RF 設計確認；範例 40×30 mm 並非 PDF 規定。",
        "試片增減量固定 ±0.15 mm；製造公差另行設定。",
        "依設計尺寸（Typ.）估算的體積未含公差堆疊、焊料損耗及空洞率；最終厚度依切片結果選定。",
    ]
    clearance = (t.chamfer - 2 * c.pad_size) / math.sqrt(2)
    warnings.append("45°削角依小凸台 J 自動計算，最近距離基準固定0.2828 mm；Y取小數第二位。")
    if math.hypot(*center) > 1e-6:
        warnings.append(f"中凸台未置中：相對基座中心偏移 X {round(center[0], 4)} mm、Y {round(center[1], 4)} mm。")
    if b.placement_accuracy != PLACEMENT_ALLOWANCE:
        warnings.append(f"pcb.placement_accuracy 已停用；開窗固定採 PPT 第8頁 {PLACEMENT_ALLOWANCE} mm，輸入值 {b.placement_accuracy} 未使用。")
    if b.opening_length < recommended[0] or b.opening_width < recommended[1]:
        warnings.append(f"PCB 手動開孔小於 {b.opening_rule.title()} 規則向上進位的建議值 {recommended[0]}×{recommended[1]} mm。")
    trial=d.trial_result
    signature=trial_signature(d)
    index=("lower","middle","upper").index(trial["choice"])
    valid=trial["locked"] and trial["signature"]==signature and abs(trial["value"]-trials[index])<1e-8
    state=("locked" if valid else "stale") if trial["locked"] else "unlocked"
    model=trial["value"] if valid else trials[index]
    if state=="stale":warnings.append("尺寸已變更；原試驗結果需解鎖並重新驗證。")
    analysis = {"overlap": False, "concentric": True,
                "assumptions": ["固定設計條件：PA 底座與 PCB 開窗同心。間隙僅依尺寸上下公差計算。",
                                "未指定的公差暫按零計算，並非零公差製造規格。"]}
    for axis, pa, opening in (("x", p.length, b.opening_length), ("y", p.width, b.opening_width)):
        name = "length" if axis == "x" else "width"
        pm, pp = tolerance(d, "package."+name)
        bm, bp = tolerance(d, "pcb.opening_"+name)
        analysis[axis] = {"nominal": (opening-pa)/2, "min": (opening-bm-pa-pp)/2,
                          "max": (opening+bp-pa+pm)/2}
        analysis["overlap"] |= analysis[axis]["min"] < 0
    base_area = rounded_base_area({"BASE_L": c.base_length, "BASE_W": c.base_width,
                                   "BASE_R": c.corner_radius, "HOLE_D": c.hole_diameter,
                                   "HOLE_EDGE": c.hole_edge_offset, "HOLE_MASK": copper_hole_mask(asdict(c))})
    return Result(length, width, height, height - s.pad_height, gap, cavity, boss,
                  volume, area, z, model,
                  trials, recommended, clearance, c.base_thickness + 0.05, tuple(warnings), center,
                  base_area, analysis, t.chamfer, state, signature)


def octagon(length: float, width: float, chamfer: float) -> list[tuple[float, float]]:
    x, y, c = length / 2, width / 2, chamfer
    return [(-x + c, -y), (x - c, -y), (x, -y + c), (x, y - c),
            (x - c, y), (-x + c, y), (-x, y - c), (-x, -y + c)]
