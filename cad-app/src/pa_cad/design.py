"""Design dimensions (Typ.) transcribed from pages 3–13 of the specification."""
from __future__ import annotations

from dataclasses import asdict, dataclass, fields, field, replace
from decimal import Decimal, ROUND_CEILING
import math
from pathlib import Path
import re

import yaml
from .creo import rounded_base_area, rounded_boundary_distance


@dataclass(frozen=True)
class Package:
    length: float
    width: float
    max_tolerance: float = 0.127
    support_height: float = 1.57


@dataclass(frozen=True)
class PCB:
    opening_length: float
    opening_width: float
    thickness: float = 2.0
    relief_diameter: float = 2.0
    placement_accuracy: float = 0.066
    opening_tolerance: float = 0.1
    opening_mode: str = "manual"  # Legacy parameter files preserve their opening.
    opening_rule: str = "delta"


@dataclass(frozen=True)
class Copper:
    base_length: float
    base_width: float
    base_thickness: float = 3.0
    corner_radius: float = 3.0
    hole_diameter: float = 3.0
    hole_edge_offset: float = 4.0
    pad_size: float = 1.5


@dataclass(frozen=True)
class Stack:
    lead_solder: float = 0.1
    board_solder: float = 0.1
    flange_gap: float = 0.3
    pad_height: float = 0.15


@dataclass(frozen=True)
class Preform:
    chamfer: float = 3.4
    trial_delta: float = 0.05
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


@dataclass(frozen=True)
class Design:
    name: str
    package: Package
    pcb: PCB
    copper: Copper
    stack: Stack
    preform: Preform
    layout: Layout = field(default_factory=Layout)
    boss: Boss = field(default_factory=Boss)
    tolerances: dict = field(default_factory=dict)
    project: Project = field(default_factory=Project)

    @classmethod
    def from_mapping(cls, data: dict) -> Design:
        if not isinstance(data, dict):
            raise ValueError("設定必須是 YAML mapping")
        expected = {f.name for f in fields(cls)}
        if unknown := set(data) - expected:
            raise ValueError(f"未知設定欄位: {sorted(unknown)}")
        if not isinstance(data.get("name"), str) or not re.fullmatch(
            r"[A-Za-z][A-Za-z0-9_-]{0,39}", data["name"]
        ):
            raise ValueError("name 須為英文字母開頭、最多 40 個英數字或 _ -")
        project_data = data.get("project", {})
        if not isinstance(project_data, dict):
            raise ValueError("project 必須是 mapping")
        if unknown := set(project_data)-{"name", "pa_model"}:
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
        groups = {}
        for name, typ in (("package", Package), ("pcb", PCB), ("copper", Copper),
                          ("stack", Stack), ("preform", Preform), ("layout", Layout), ("boss", Boss)):
            source = data.get(name, {})
            if not isinstance(source, dict):
                raise ValueError(f"{name} 必須是 mapping")
            try:
                group = typ(**source)
            except TypeError as exc:
                raise ValueError(f"{name} 欄位不完整或不支援: {exc}") from exc
            for f in fields(group):
                value = getattr(group, f.name)
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
                if value < 0 or (value == 0 and not zero_allowed):
                    raise ValueError(f"{name}.{f.name} 超出有效範圍")
            groups[name] = group
        tolerances = data.get("tolerances", {})
        if not isinstance(tolerances, dict):
            raise ValueError("tolerances 必須是 mapping")
        for key, pair in tolerances.items():
            if not isinstance(key, str) or not re.fullmatch(r"[a-z_]+\.[a-z_]+", key) or not isinstance(pair, dict):
                raise ValueError("公差須為尺寸路徑與 minus/plus mapping")
            if set(pair)-{"minus", "plus", "source"} or not {"minus", "plus"} <= set(pair):
                raise ValueError(f"{key} 公差須包含 minus 與 plus")
            for side in ("minus", "plus"):
                value = pair[side]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 10000:
                    raise ValueError(f"{key} 公差須為有限非負數值")
            if "source" in pair and not isinstance(pair["source"], str):
                raise ValueError(f"{key} 公差來源須為文字")
        design = cls(data["name"], **groups, tolerances=tolerances, project=project)
        if design.pcb.opening_mode == "auto":
            length, width = recommended_opening(design)
            design = replace(design, pcb=replace(design.pcb, opening_length=length, opening_width=width))
        length, width, height, center = boss_dimensions(design)
        design = replace(design, boss=replace(design.boss, length=length, width=width, total_height=height,
                                             center_from_left=center[0]+design.copper.base_length/2,
                                             center_from_bottom=center[1]+design.copper.base_width/2),
                         preform=replace(design.preform, length=length, width=width))
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


DEFAULT_TOLERANCES = {
    "copper.base_length": (.2, .2), "copper.base_width": (.2, .2),
    "copper.base_thickness": (.1, 0), "copper.hole_edge_offset": (.1, .1),
    "copper.pad_size": (.05, .05), "stack.pad_height": (.05, .05),
    "boss.length": (.05, .05), "boss.width": (.05, .05), "boss.total_height": (.1, 0),
    "preform.length": (.1, .1), "preform.width": (.1, .1),
    "preform.chamfer": (0, .2), "preform.thickness_override": (.02, .02),
}


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
    return DEFAULT_TOLERANCES.get(key, (0., 0.))


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
    boss_total_height: float  # L (CuH), relative to base top
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


def calculate(d: Design) -> Result:
    p, b, c, s, t = d.package, d.pcb, d.copper, d.stack, d.preform
    recommended = recommended_opening(d)
    if b.opening_mode == "auto":
        b = replace(b, opening_length=recommended[0], opening_width=recommended[1])
    length, width, height, center = boss_dimensions(d)
    gap = height + s.flange_gap - s.pad_height
    if not (height > s.pad_height and gap > height):
        raise ValueError("高度堆疊無效：CuH 必須大於小凸台高度，flange 必須高於小凸台頂面")
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
    if not (off > 0 and 2 * off < min(c.base_length, c.base_width)):
        raise ValueError("吊掛孔邊距不足，或孔位不在基座內")
    hx, hy = c.base_length / 2 - off, c.base_width / 2 - off
    if any(rounded_boundary_distance(center[0]+sx*length/2, center[1]+sy*width/2,
                                    c.base_length, c.base_width, c.corner_radius) > 1e-8
           for sx in (-1, 1) for sy in (-1, 1)):
        raise ValueError("中凸台超出銅塊圓角基座範圍")
    for sign in (-1, 1):
        if math.hypot(max(abs(sign*hx-center[0])-length/2, 0), max(abs(sign*hy-center[1])-width/2, 0)) <= rad:
            raise ValueError("吊掛孔與中凸台相交")
    cavity = (b.opening_length * b.opening_width + math.pi * (b.relief_diameter / 2) ** 2) * gap
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
        "PDF 第12頁為 Z±0.05 mm，第13頁表格為 ±0.15 mm；本次依輸入 trial_delta 計算。",
        "依設計尺寸（Typ.）估算的體積未含公差堆疊、焊料損耗及空洞率；最終厚度依切片結果選定。",
    ]
    clearance = (t.chamfer - 2 * c.pad_size) / math.sqrt(2)
    warnings.append(f"依四角 J×J 凸台與45度削角計算最近距離為 {clearance:.4f} mm；PDF 第11頁約0.37 mm，須確認。")
    if b.opening_length < recommended[0] or b.opening_width < recommended[1]:
        warnings.append(f"PCB 手動開孔小於 {b.opening_rule.title()} 規則向上進位的建議值 {recommended[0]}×{recommended[1]} mm。")
    if t.thickness_override is not None:
        warnings.append("模型採用指定的 thickness_override；計算厚度與三款試片仍另列於報告。")
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
                                   "HOLE_EDGE": c.hole_edge_offset})
    return Result(length, width, height, height - s.pad_height, gap, cavity, boss,
                  volume, area, z, t.thickness_override if t.thickness_override is not None else z,
                  trials, recommended, clearance, c.base_thickness + 0.05, tuple(warnings), center,
                  base_area, analysis)


def octagon(length: float, width: float, chamfer: float) -> list[tuple[float, float]]:
    x, y, c = length / 2, width / 2, chamfer
    return [(-x + c, -y), (x - c, -y), (x, -y + c), (x, y - c),
            (x - c, y), (-x + c, y), (-x, y - c), (-x, -y + c)]
