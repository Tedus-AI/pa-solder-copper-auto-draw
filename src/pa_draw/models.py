"""資料模型（單位：mm）。"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Rect:
    """以中心點定義的矩形，可帶圓角。"""

    cx: float
    cy: float
    w: float
    h: float
    corner_r: float = 0.0

    @property
    def x0(self) -> float:
        return self.cx - self.w / 2

    @property
    def y0(self) -> float:
        return self.cy - self.h / 2

    @property
    def area(self) -> float:
        # 圓角扣除面積：每角 r^2 - pi r^2 / 4
        r = self.corner_r
        return self.w * self.h - (4 - 3.141592653589793) * r * r

    def offset(self, d: float) -> "Rect":
        """往外 (d>0) 或往內 (d<0) 偏移。"""
        w, h = self.w + 2 * d, self.h + 2 * d
        if w <= 0 or h <= 0:
            raise ValueError(f"offset {d} 使矩形尺寸 <= 0")
        return Rect(self.cx, self.cy, w, h, max(self.corner_r + d, 0.0))


@dataclass
class PAPackage:
    name: str
    body_w: float
    body_h: float
    pad_w: float  # exposed pad / flange
    pad_h: float
    pad_offset_x: float = 0.0
    pad_offset_y: float = 0.0


@dataclass
class SolderSpec:
    inset: float = 0.1          # 焊料相對 pad 內縮
    windows_x: int = 1          # 鋼板開窗分割數（window-pane）
    windows_y: int = 1
    web: float = 0.2            # 開窗間隔筋寬
    thickness: float = 0.1      # 焊料厚度（給熱阻計算用）


@dataclass
class CopperCoinSpec:
    expand: float = 0.5         # coin 相對 pad 外擴
    corner_r: float = 0.3
    thickness: float = 1.6
    pcb_clearance: float = 0.1  # PCB 挖槽相對 coin 單邊間隙


@dataclass
class DesignInput:
    package: PAPackage
    solder: SolderSpec = field(default_factory=SolderSpec)
    coin: CopperCoinSpec = field(default_factory=CopperCoinSpec)


@dataclass
class DesignGeometry:
    """計算後的各層幾何。"""

    body: Rect
    pad: Rect
    solder_windows: list[Rect]
    coin: Rect
    pcb_cutout: Rect

    @property
    def solder_area(self) -> float:
        return sum(r.area for r in self.solder_windows)

    @property
    def solder_coverage(self) -> float:
        return self.solder_area / self.pad.area
