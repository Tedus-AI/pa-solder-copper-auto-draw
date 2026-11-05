"""輸出 PNG 預覽圖。"""
from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import FancyBboxPatch  # noqa: E402

from .models import DesignGeometry, Rect  # noqa: E402

STYLE = {
    "PCB_CUTOUT": dict(edgecolor="#d62728", facecolor="none", ls="--", lw=1.2),
    "COPPER_COIN": dict(edgecolor="#b8733a", facecolor="#e8b98a", lw=1.2),
    "PA_BODY": dict(edgecolor="#333333", facecolor="none", lw=1.5),
    "PA_PAD": dict(edgecolor="#2ca02c", facecolor="none", lw=1.2),
    "SOLDER": dict(edgecolor="#7f7f7f", facecolor="#c7c7c7", lw=0.8),
}


def _patch(r: Rect, **kw):
    return FancyBboxPatch((r.x0 + r.corner_r, r.y0 + r.corner_r), r.w - 2 * r.corner_r,
                          r.h - 2 * r.corner_r, boxstyle=f"round,pad={r.corner_r}", **kw)


def write_png(g: DesignGeometry, path: str | Path, title: str = "") -> Path:
    fig, ax = plt.subplots(figsize=(7, 6), dpi=150)
    ax.add_patch(_patch(g.pcb_cutout, label="PCB cutout", **STYLE["PCB_CUTOUT"]))
    ax.add_patch(_patch(g.coin, label="Copper coin", **STYLE["COPPER_COIN"]))
    for i, w in enumerate(g.solder_windows):
        ax.add_patch(_patch(w, label="Solder" if i == 0 else None, **STYLE["SOLDER"]))
    ax.add_patch(_patch(g.pad, label="PA pad", **STYLE["PA_PAD"]))
    ax.add_patch(_patch(g.body, label="PA body", **STYLE["PA_BODY"]))

    m = max(g.body.w, g.body.h, g.pcb_cutout.w, g.pcb_cutout.h) / 2 * 1.15
    ax.set_xlim(-m, m)
    ax.set_ylim(-m, m)
    ax.set_aspect("equal")
    ax.grid(alpha=0.3)
    ax.set_xlabel("mm")
    ax.set_ylabel("mm")
    ax.set_title(f"{title}  solder coverage = {g.solder_coverage:.1%}")
    ax.legend(loc="upper right", fontsize=8)

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)
    return path
