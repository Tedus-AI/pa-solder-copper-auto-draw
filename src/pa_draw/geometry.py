"""由設計參數計算 pad / solder / copper coin / PCB cutout 幾何。"""
from __future__ import annotations

from .models import DesignGeometry, DesignInput, Rect


def split_windows(area: Rect, nx: int, ny: int, web: float) -> list[Rect]:
    """將焊料區切成 nx × ny 個開窗（window-pane stencil）。"""
    if nx < 1 or ny < 1:
        raise ValueError("windows_x / windows_y 必須 >= 1")
    ww = (area.w - (nx - 1) * web) / nx
    wh = (area.h - (ny - 1) * web) / ny
    if ww <= 0 or wh <= 0:
        raise ValueError("開窗數或筋寬過大，開窗尺寸 <= 0")
    rects = []
    for j in range(ny):
        for i in range(nx):
            cx = area.x0 + ww / 2 + i * (ww + web)
            cy = area.y0 + wh / 2 + j * (wh + web)
            rects.append(Rect(cx, cy, ww, wh))
    return rects


def build_geometry(d: DesignInput) -> DesignGeometry:
    p = d.package
    body = Rect(0.0, 0.0, p.body_w, p.body_h)
    pad = Rect(p.pad_offset_x, p.pad_offset_y, p.pad_w, p.pad_h)
    solder_area = pad.offset(-d.solder.inset)
    windows = split_windows(solder_area, d.solder.windows_x, d.solder.windows_y, d.solder.web)
    coin = Rect(pad.cx, pad.cy, pad.w + 2 * d.coin.expand, pad.h + 2 * d.coin.expand, d.coin.corner_r)
    cutout = coin.offset(d.coin.pcb_clearance)
    return DesignGeometry(body, pad, windows, coin, cutout)
