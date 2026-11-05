"""Nominal design rules transcribed from pages 3–13 of the supplied specification."""
from __future__ import annotations

from dataclasses import asdict, dataclass, fields, field, replace
from decimal import Decimal, ROUND_CEILING
import math
from pathlib import Path
import re

import yaml


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


@dataclass(frozen=True)
class Layout:
    """Browser Layout metadata; never contributes to copper/preform solids."""
    border_width: float = 1.0
    epad_size: float = 1.5
    web_width: float = 0.3
    hole_clearance: float = 4.0


@dataclass(frozen=True)
class Design:
    name: str
    package: Package
    pcb: PCB
    copper: Copper
    stack: Stack
    preform: Preform
    layout: Layout = field(default_factory=Layout)

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
        groups = {}
        for name, typ in (("package", Package), ("pcb", PCB), ("copper", Copper),
                          ("stack", Stack), ("preform", Preform), ("layout", Layout)):
            source = data.get(name, {})
            if not isinstance(source, dict):
                raise ValueError(f"{name} 必須是 mapping")
            try:
                group = typ(**source)
            except TypeError as exc:
                raise ValueError(f"{name} 欄位不完整或不支援: {exc}") from exc
            for f in fields(group):
                value = getattr(group, f.name)
                if name == "pcb" and f.name in {"opening_mode", "opening_rule"}:
                    choices = {"auto", "manual"} if f.name == "opening_mode" else {"delta", "ampleon"}
                    if not isinstance(value, str) or value not in choices:
                        raise ValueError(f"pcb.{f.name} 不支援此設定")
                    continue
                if name == "preform" and f.name == "thickness_override" and value is None:
                    continue
                if (isinstance(value, bool) or not isinstance(value, (int, float))
                        or not math.isfinite(value)):
                    raise ValueError(f"{name}.{f.name} 須為有限數值")
                zero_allowed = f.name in {"max_tolerance", "placement_accuracy", "opening_tolerance",
                                          "lead_solder", "board_solder", "flange_gap", "trial_delta"}
                if value < 0 or (value == 0 and not zero_allowed):
                    raise ValueError(f"{name}.{f.name} 超出有效範圍")
            groups[name] = group
        design = cls(data["name"], **groups)
        if design.pcb.opening_mode == "auto":
            length, width = recommended_opening(design)
            design = replace(design, pcb=replace(design.pcb, opening_length=length, opening_width=width))
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
    return tuple(ceil_tenth(float(Decimal(str(v)) + Decimal(str(d.package.max_tolerance))
                                 + Decimal(str(d.pcb.placement_accuracy))
                                 + Decimal(str(d.pcb.opening_tolerance)) * factor))
                 for v in (d.package.length, d.package.width))


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


def calculate(d: Design) -> Result:
    p, b, c, s, t = d.package, d.pcb, d.copper, d.stack, d.preform
    recommended = recommended_opening(d)
    if b.opening_mode == "auto":
        b = replace(b, opening_length=recommended[0], opening_width=recommended[1])
    length, width = ceil_tenth(p.length), ceil_tenth(p.width)
    height = b.thickness + s.lead_solder + s.board_solder - p.support_height - s.flange_gap + s.pad_height
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
    # A conservative, explicit hole placement rule keeps complete circles inside the
    # rounded base and away from the central pedestal. Holes are diagonally opposed.
    off, rad = c.hole_edge_offset, c.hole_diameter / 2
    if not (off >= c.corner_radius and off > rad and 2 * off < min(c.base_length, c.base_width)):
        raise ValueError("吊掛孔邊距不足，或孔位不在基座內")
    hx, hy = c.base_length / 2 - off, c.base_width / 2 - off
    if math.hypot(max(hx - length / 2, 0), max(hy - width / 2, 0)) <= rad:
        raise ValueError("吊掛孔與大凸台相交")
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
        "名義尺寸體積估算未含公差堆疊、焊料損耗及空洞率；最終厚度依切片結果選定。",
    ]
    clearance = (t.chamfer - 2 * c.pad_size) / math.sqrt(2)
    warnings.append(f"依四角 J×J 凸台與45度削角計算最近距離為 {clearance:.4f} mm；PDF 第11頁約0.37 mm，須確認。")
    if b.opening_length < recommended[0] or b.opening_width < recommended[1]:
        warnings.append(f"PCB 手動開孔小於 {b.opening_rule.title()} 規則向上進位的建議值 {recommended[0]}×{recommended[1]} mm。")
    if t.thickness_override is not None:
        warnings.append("模型採用指定的 thickness_override；計算厚度與三款試片仍另列於報告。")
    return Result(length, width, height, height - s.pad_height, gap, cavity, boss,
                  volume, area, z, t.thickness_override if t.thickness_override is not None else z,
                  trials, recommended, clearance, c.base_thickness + 0.05, tuple(warnings))


def octagon(length: float, width: float, chamfer: float) -> list[tuple[float, float]]:
    x, y, c = length / 2, width / 2, chamfer
    return [(-x + c, -y), (x - c, -y), (x, -y + c), (x, y - c),
            (x - c, y), (-x + c, y), (-x, y - c), (-x, -y + c)]
