"""Generate a reviewable, traceable file bundle from one set of design parameters."""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import zipfile

import cadquery as cq
import yaml

from .design import Design, calculate
from .drawing import write_copper, write_preform
from .solid import copper_block, solder_preform, expected_copper_volume
from .creo import prepare_job, TARGET


def export_bundle(d: Design, output: str | Path) -> Path:
    r = calculate(d)
    if r.trial_status=="stale":
        raise ValueError("尺寸已變更，請解鎖並重新驗證試片厚度")
    parent = Path(output)
    parent.mkdir(parents=True, exist_ok=True)
    target = parent / d.name
    if target.exists():
        raise FileExistsError(f"輸出已存在，請另選輸出資料夾以保留原檔：{target}")
    stage = Path(tempfile.mkdtemp(prefix=f".{d.name}-", dir=parent))
    try:
        copper, preform = copper_block(d, r), solder_preform(d, r)
        models = {"copper": copper, "preform": preform}
        volumes = {}
        expected = {"copper": expected_copper_volume(d, r), "preform": r.preform_area*r.model_thickness}
        for label, solid in models.items():
            if len(solid.solids().vals()) != 1 or not solid.val().isValid():
                raise ValueError(f"{label}: CAD kernel 產生無效或非單一實體")
            volume = solid.val().Volume()
            if abs(volume-expected[label]) > 1e-6 * max(expected[label], 1):
                raise ValueError(f"{label}: CAD 體積與規則計算不一致")
            volumes[label] = volume
            cq.exporters.export(solid, str(stage / f"{label}.step"))
            cq.exporters.export(solid, str(stage / f"{label}.stl"), tolerance=.05, angularTolerance=.1)
            cq.exporters.export(solid, str(stage / f"{label}.svg"), opt={"width": 800, "height": 500})
            # Re-import the actual delivered STEP file and check topology and volume.
            restored = cq.importers.importStep(str(stage / f"{label}.step"))
            if len(restored.solids().vals()) != 1 or not restored.val().isValid():
                raise ValueError(f"{label}: STEP 回讀失敗")
            if abs(restored.val().Volume()-volume) > 1e-6 * max(volume, 1):
                raise ValueError(f"{label}: STEP 回讀體積不一致")
        write_copper(d, r, stage / "copper.dxf")
        write_preform(d, r, stage / "preform.dxf")
        (stage / "parameters.yaml").write_text(yaml.safe_dump(d.to_mapping(), sort_keys=False), encoding="utf-8")
        report = {
            "schema_version": 1, "units": {"length": "mm", "area": "mm2", "volume": "mm3"},
            "created_at_utc": datetime.now(timezone.utc).isoformat(),
            "source_reference": "PA copper dual-reflow design specification 2026-03-19, pages 3-13",
            "parameters": d.to_mapping(), "results": asdict(r), "cad_volumes_mm3": volumes,
            "native_prt": {"status": "not_generated", "required_model_type": "native_parametric_features",
                           "target": TARGET,
                           "reason": "Local Creo runner is provided; native masters and execution on the user's Creo workstation are not yet validated. STEP import does not meet the requirement."},
        }
        (stage / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        handoff = prepare_job(d.to_mapping(), asdict(r), volumes)
        (stage / "creo_job.json").write_text(json.dumps(handoff, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        (stage / "creo_runner.py").write_bytes(Path(__file__).with_name("creo.py").read_bytes())
        (stage / "WINDOWS_CREO7.md").write_bytes((Path(__file__).with_name("resources") / "WINDOWS_CREO7.md").read_bytes())
        (stage / "CREO_README.txt").write_text(
            "Target: Creo Parametric 7.0.10.0 / Windows 11; native parametric features required.\n"
            "No native masters or PRT outputs are included. Two real native master models are prerequisites.\n"
            "On the licensed workstation with Python 3.11+ and local CREOSON/J-Link:\n"
            "  py -3 creo_runner.py check --creo-root \"C:\\Program Files\\PTC\\Creo 7.0.10.0\"\n"
            "  py -3 creo_runner.py generate creo_job.json --templates C:\\pa-cad\\templates --output C:\\pa-cad\\new-run\n"
            "Read the bundled WINDOWS_CREO7.md before running.\n"
            "The runner checks named native features, mm units, volume/bounds, dimension-change regeneration,\n"
            "save/reopen, and source-master preservation. Exact build, sketch constraints and single-body\n"
            "acceptance still require Creo inspection. Protocol tests in Linux do not validate native PRT.\n",
            encoding="utf-8")
        hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(stage.iterdir())}
        (stage / "sha256.json").write_text(json.dumps(hashes, indent=2)+"\n", encoding="utf-8")
        with zipfile.ZipFile(stage / f"{d.name}.zip", "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(stage.iterdir()):
                if path.suffix != ".zip":
                    archive.write(path, arcname=path.name)
        stage.rename(target)
        return target
    except Exception:
        shutil.rmtree(stage)
        raise
