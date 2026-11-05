"""命令列入口：pa-draw examples/pa_example.yaml -o output"""
from __future__ import annotations

import argparse
from pathlib import Path

from .config import load_design
from .dxf_writer import write_dxf
from .geometry import build_geometry
from .preview import write_png


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="pa-draw", description=__doc__)
    ap.add_argument("config", help="設計參數 YAML 檔")
    ap.add_argument("-o", "--out", default="output", help="輸出資料夾")
    ap.add_argument("--no-png", action="store_true", help="不輸出 PNG 預覽")
    args = ap.parse_args(argv)

    design = load_design(args.config)
    g = build_geometry(design)
    stem = Path(args.out) / design.package.name

    print(f"[{design.package.name}]")
    print(f"  pad          : {g.pad.w:.2f} x {g.pad.h:.2f} mm")
    print(f"  solder       : {len(g.solder_windows)} windows, area {g.solder_area:.2f} mm², "
          f"coverage {g.solder_coverage:.1%}")
    print(f"  copper coin  : {g.coin.w:.2f} x {g.coin.h:.2f} mm (R{g.coin.corner_r})")
    print(f"  PCB cutout   : {g.pcb_cutout.w:.2f} x {g.pcb_cutout.h:.2f} mm")
    print(f"  -> {write_dxf(g, stem.with_suffix('.dxf'))}")
    if not args.no_png:
        print(f"  -> {write_png(g, stem.with_suffix('.png'), design.package.name)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
