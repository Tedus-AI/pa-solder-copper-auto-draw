from __future__ import annotations

import argparse
import json
import sys

import yaml

from .design import Design, calculate


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Final PA 銅塊／錫片：STEP 3D + DXF 2D + 錫厚報告")
    parser.add_argument("config", help="YAML 設計參數")
    parser.add_argument("-o", "--output", default="output", help="輸出根目錄；不覆寫已有設計")
    parser.add_argument("--calculate-only", action="store_true", help="只輸出 JSON 計算結果")
    parser.add_argument("--format", choices=["step", "prt"], default="step", help="原生 PRT 必須在 Windows Creo 上執行圖檔包中的本機 runner")
    args = parser.parse_args(argv)
    try:
        design = Design.load(args.config)
        result = calculate(design)
        if args.calculate_only:
            from dataclasses import asdict
            print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
            return 0
        if args.format == "prt":
            raise ValueError("原生 PRT 需在 Creo 7.0.10.0／Windows 11 執行本機 runner 與原生參數化母檔。請先匯出圖檔包，再依 CREO_README.txt 執行 creo_runner.py；STEP 匯入不符合特徵樹要求。")
        from .export import export_bundle
        folder = export_bundle(design, args.output)
        print(f"CuH={result.boss_total_height:.4f} mm; 錫厚 Z={result.calculated_thickness:.6f} mm")
        print(f"三款試片: {', '.join(f'{t:.6f}' for t in result.trial_thicknesses)} mm")
        print(f"銅塊與錫片 STEP / DXF / STL / SVG、計算報告及 ZIP: {folder}")
        print("原生 PRT 未產生；需整合已授權 Creo。")
        return 0
    except (ValueError, FileExistsError, OSError, yaml.YAMLError) as exc:
        print(f"錯誤: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
