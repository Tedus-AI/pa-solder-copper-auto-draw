import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import zipfile

import cadquery as cq
import ezdxf
import pytest

from pa_cad.cli import main
from pa_cad.design import Design, calculate
from pa_cad.export import export_bundle
from pa_cad.solid import expected_copper_volume
from pa_cad.solid import copper_block
from pa_cad.drawing import write_copper

EXAMPLE = Path(__file__).parents[1] / "examples/780-m1p.yaml"


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    design = Design.load(EXAMPLE)
    return design, export_bundle(design, tmp_path_factory.mktemp("export"))


def test_step_roundtrip_volume_and_bounds(bundle):
    d, folder = bundle
    r = calculate(d)
    for label, volume, z in [("copper", expected_copper_volume(d, r), d.copper.base_thickness+r.boss_total_height),
                              ("preform", r.preform_area*r.model_thickness, r.model_thickness)]:
        solid = cq.importers.importStep(str(folder / f"{label}.step"))
        assert len(solid.solids().vals()) == 1
        assert solid.val().isValid()
        assert solid.val().Volume() == pytest.approx(volume, rel=1e-8)
        assert solid.val().BoundingBox().zlen == pytest.approx(z)
    copper = cq.importers.importStep(str(folder / "copper.step"))
    assert copper.val().BoundingBox().xlen == pytest.approx(40)
    assert copper.val().BoundingBox().ylen == pytest.approx(30)


def test_dxf_holes_pads_dimensions_and_octagon(bundle):
    _, folder = bundle
    for label in ("copper", "preform"):
        doc = ezdxf.readfile(folder / f"{label}.dxf")
        assert doc.units == ezdxf.units.MM
        assert not doc.audit().has_errors
        assert len(doc.modelspace().query("DIMENSION")) >= 3
    msp = ezdxf.readfile(folder / "copper.dxf").modelspace()
    holes = msp.query('CIRCLE[layer=="HOLES"]')
    assert len(holes) == 2
    assert all(e.dxf.radius == 1.5 for e in holes)
    assert len(msp.query('LWPOLYLINE[layer=="PAD"]')) == 4
    assert len(msp.query('LWPOLYLINE[layer=="SIDE"]')) == 2
    msp = ezdxf.readfile(folder / "preform.dxf").modelspace()
    octagon = msp.query('LWPOLYLINE[layer=="OUTLINE"]')[0]
    assert len(octagon) == 8 and octagon.closed


def test_round_features_use_native_dimensions_quantities_and_center_lines(bundle):
    d, folder = bundle
    doc = ezdxf.readfile(folder / "copper.dxf")
    audit = doc.audit()
    assert not audit.has_errors and not audit.has_fixes
    msp = doc.modelspace()
    dimensions = list(msp.query("DIMENSION"))
    radius = next(dim for dim in dimensions if dim.dimtype == 4)
    diameter = next(dim for dim in dimensions if dim.dimtype == 3)
    assert radius.dxf.text == "4-R = 3.00 mm"
    assert diameter.dxf.text == "2-%%cD = 3.00 mm"
    assert radius.get_measurement() == pytest.approx(d.copper.corner_radius)
    assert diameter.get_measurement() == pytest.approx(d.copper.hole_diameter)
    radial_entities = list(radius.virtual_entities())
    radial_lines = [entity for entity in radial_entities if entity.dxftype() == "LINE"]
    assert radial_lines
    center = radius.dxf.defpoint
    assert all((point-center).magnitude >= d.copper.corner_radius-1e-8
               for entity in radial_lines for point in (entity.dxf.start, entity.dxf.end))
    assert not any(entity.dxftype() == "POINT" for entity in radial_entities)
    radial_text = next(entity for entity in radial_entities if entity.dxftype() == "MTEXT")
    assert 1 < radial_text.get_rotation() % 180 < 89
    centers = msp.query('LINE[layer=="CENTER"]')
    assert len(centers) == 4
    assert doc.layers.get("CENTER").dxf.linetype == "PA_CENTER"
    assert any(element[0] == 49 and element[1] == 0
               for element in doc.linetypes.get("PA_CENTER").pattern_tags.tags)
    # ezdxf's bundled EZDXF style scales measurements by 100 by default.
    # Check delivered rendered text, not only the unchanged nominal geometry.
    overall = next(dim for dim in dimensions if dim.dxf.text.startswith("E ="))
    assert [entity.text for entity in overall.virtual_entities()
            if entity.dxftype() == "MTEXT"] == ["E = 40 +/-0.2 mm"]


@pytest.mark.parametrize("value,nominal", [(3.005, "3.005"), (.000001, "0.000001")])
def test_round_labels_retain_finer_nonzero_measurements(tmp_path, value, nominal):
    data = Design.load(EXAMPLE).to_mapping()
    data["copper"].update(corner_radius=value, hole_diameter=value)
    d = Design.from_mapping(data)
    path = tmp_path/"precision.dxf"
    write_copper(d, calculate(d), path)
    doc = ezdxf.readfile(path)
    audit = doc.audit()
    assert not audit.has_errors and not audit.has_fixes
    dimensions = list(doc.modelspace().query("DIMENSION"))
    radius = next(dim for dim in dimensions if dim.dimtype == 4)
    diameter = next(dim for dim in dimensions if dim.dimtype == 3)
    assert radius.dxf.text == f"4-R = {nominal} mm"
    assert diameter.dxf.text == f"2-%%cD = {nominal} mm"
    assert radius.get_measurement() == pytest.approx(value)
    assert diameter.get_measurement() == pytest.approx(value)


def test_bundle_hashes_report_and_no_fake_prt(bundle):
    d, folder = bundle
    report = json.loads((folder / "report.json").read_text())
    assert report["native_prt"]["status"] == "not_generated"
    assert not list(folder.glob("*.prt"))
    for name, digest in json.loads((folder / "sha256.json").read_text()).items():
        assert hashlib.sha256((folder / name).read_bytes()).hexdigest() == digest
    with zipfile.ZipFile(folder / f"{d.name}.zip") as z:
        assert z.testzip() is None
        assert {"copper.step", "preform.step", "copper.dxf", "preform.dxf", "report.json", "creo_runner.py", "WINDOWS_CREO7.md"} <= set(z.namelist())
    with pytest.raises(FileExistsError):
        export_bundle(d, folder.parent)


def test_shipped_creo_runner_is_standalone_and_target_is_explicit(bundle):
    _, folder = bundle
    job = json.loads((folder / "creo_job.json").read_text())
    assert job["target"]["version"] == "7.0.10.0"
    assert job["target"]["os"] == "Windows 11"
    assert job["step_import_acceptable"] is False
    if platform.system() != "Windows":
        p = subprocess.run([sys.executable, "-I", str(folder / "creo_runner.py"), "generate", "unused.json"],
                           capture_output=True, text=True, timeout=10)
        assert p.returncode == 2
        assert "Windows 11" in p.stderr
        assert "ModuleNotFoundError" not in p.stderr


def test_prt_failure_is_explicit_and_creates_no_output(tmp_path, capsys):
    assert main([str(EXAMPLE), "-o", str(tmp_path / "new"), "--format", "prt"]) == 2
    assert "Creo" in capsys.readouterr().err
    assert not (tmp_path / "new").exists()


def test_calculate_only_without_files(tmp_path, capsys):
    assert main([str(EXAMPLE), "--calculate-only", "-o", str(tmp_path / "new")]) == 0
    assert json.loads(capsys.readouterr().out)["preform_area"] == pytest.approx(178.76)
    assert not (tmp_path / "new").exists()


def test_corner_breakout_and_positioned_boss_have_exact_valid_solid_volume():
    data = Design.load(EXAMPLE).to_mapping()
    data["copper"]["hole_edge_offset"] = 1
    data["boss"].update(center_from_left=21, center_from_bottom=14)
    d = Design.from_mapping(data)
    r = calculate(d)
    solid = copper_block(d, r)
    assert len(solid.solids().vals()) == 1 and solid.val().isValid()
    assert solid.val().Volume() == pytest.approx(expected_copper_volume(d, r), rel=1e-8)
    # The boss side face shifts in XY while the base bounds stay centered.
    top = solid.faces(">Z").vals()
    assert min(face.Center().x for face in top) < 1 < max(face.Center().x for face in top)


def test_positioned_boss_and_corner_breakout_dxf_matches_actual_outline(tmp_path):
    data = Design.load(EXAMPLE).to_mapping()
    data["copper"]["hole_edge_offset"] = 1
    data["boss"].update(center_from_left=21, center_from_bottom=14)
    data["tolerances"] = {"boss.length": {"minus": .03, "plus": .07}}
    d = Design.from_mapping(data)
    path = tmp_path/"breakout.dxf"
    write_copper(d, calculate(d), path)
    doc = ezdxf.readfile(path)
    assert not doc.audit().has_errors
    assert not doc.modelspace().query('CIRCLE[layer=="HOLES"]')
    boss = doc.modelspace().query('LWPOLYLINE[layer=="BOSS"]')[0]
    points = list(boss.get_points())
    assert sum(p[0] for p in points)/4 == pytest.approx(1)
    assert sum(p[1] for p in points)/4 == pytest.approx(-1)
    assert any("+0.07/-0.03" in dim.dxf.text for dim in doc.modelspace().query('DIMENSION'))
    radius = next(dim for dim in doc.modelspace().query("DIMENSION") if dim.dimtype == 4)
    point = radius.dxf.defpoint4
    hx = d.copper.base_length/2-d.copper.hole_edge_offset
    hy = d.copper.base_width/2-d.copper.hole_edge_offset
    assert all(((point.x-sign*hx)**2+(point.y-sign*hy)**2)**.5 > d.copper.hole_diameter/2
               for sign in (-1, 1))
