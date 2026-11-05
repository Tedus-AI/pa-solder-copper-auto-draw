"""輸出 DXF，每種幾何放在獨立圖層。"""
from __future__ import annotations

from pathlib import Path

import ezdxf

from .models import DesignGeometry, Rect

LAYERS = {
    "PA_BODY": 7,
    "PA_PAD": 3,
    "SOLDER": 2,
    "COPPER_COIN": 30,
    "PCB_CUTOUT": 1,
    "DIM": 8,
}


def _add_rect(msp, r: Rect, layer: str) -> None:
    if r.corner_r <= 0:
        pts = [(r.x0, r.y0), (r.x0 + r.w, r.y0), (r.x0 + r.w, r.y0 + r.h), (r.x0, r.y0 + r.h)]
        msp.add_lwpolyline(pts, close=True, dxfattribs={"layer": layer})
        return
    # 圓角：用 bulge=tan(90°/4) 表示 1/4 圓弧
    b = 0.41421356237
    rr = r.corner_r
    x0, y0, x1, y1 = r.x0, r.y0, r.x0 + r.w, r.y0 + r.h
    pts = [
        (x0 + rr, y0, 0), (x1 - rr, y0, b),
        (x1, y0 + rr, 0), (x1, y1 - rr, b),
        (x1 - rr, y1, 0), (x0 + rr, y1, b),
        (x0, y1 - rr, 0), (x0, y0 + rr, b),
    ]
    msp.add_lwpolyline(pts, format="xyb", close=True, dxfattribs={"layer": layer})


def write_dxf(g: DesignGeometry, path: str | Path) -> Path:
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    for name, color in LAYERS.items():
        doc.layers.add(name, color=color)
    msp = doc.modelspace()

    _add_rect(msp, g.pcb_cutout, "PCB_CUTOUT")
    _add_rect(msp, g.coin, "COPPER_COIN")
    _add_rect(msp, g.body, "PA_BODY")
    _add_rect(msp, g.pad, "PA_PAD")
    for w in g.solder_windows:
        _add_rect(msp, w, "SOLDER")

    # 基本尺寸標註：copper coin 寬、高
    c = g.coin
    msp.add_linear_dim(base=(c.cx, c.y0 - 1.0), p1=(c.x0, c.y0), p2=(c.x0 + c.w, c.y0),
                       dxfattribs={"layer": "DIM"}).render()
    msp.add_linear_dim(base=(c.x0 - 1.0, c.cy), p1=(c.x0, c.y0), p2=(c.x0, c.y0 + c.h), angle=90,
                       dxfattribs={"layer": "DIM"}).render()

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.saveas(path)
    return path
