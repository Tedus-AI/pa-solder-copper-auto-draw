from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import pytest
import yaml

from pa_cad.design import Design, calculate, ceil_tenth

ROOT = Path(__file__).parents[1]


@pytest.fixture
def data():
    return yaml.safe_load((ROOT / "examples/780-m1p.yaml").read_text())


def test_pdf_page13_numeric_regression(data):
    r = calculate(Design.from_mapping(data))
    assert (r.boss_length, r.boss_width) == (20.6, 9.8)
    assert r.boss_total_height == pytest.approx(.48)
    assert r.copper_to_flange == pytest.approx(.63)
    assert r.cavity_volume == pytest.approx(134.966, abs=.0005)
    assert r.boss_volume == pytest.approx(67.970, abs=.0005)
    assert r.solder_volume == pytest.approx(66.996, abs=.0005)
    assert r.preform_area == pytest.approx(178.760)
    assert r.calculated_thickness == pytest.approx(.3748, abs=.00005)
    assert r.recommended_opening == (20.9, 10.1)
    assert r.trial_thicknesses == pytest.approx((r.calculated_thickness-.05, r.calculated_thickness, r.calculated_thickness+.05))


def test_ceiling_without_rounding_down():
    assert ceil_tenth(20.57) == 20.6
    assert ceil_tenth(20.6) == 20.6
    assert ceil_tenth(20.60001) == 20.7


def test_stack_changes_gap_and_volume(data):
    d = Design.from_mapping(data)
    r1 = calculate(d)
    r2 = calculate(replace(d, pcb=replace(d.pcb, thickness=2.1)))
    assert r2.boss_total_height == pytest.approx(r1.boss_total_height+.1)
    assert r2.copper_to_flange == pytest.approx(r1.copper_to_flange+.1)
    assert r2.solder_volume > r1.solder_volume


@pytest.mark.parametrize("group,field,value", [
    ("package", "length", float("nan")), ("pcb", "thickness", True),
    ("copper", "base_width", 8), ("copper", "pad_size", 4),
    ("copper", "base_thickness", 2.9), ("copper", "hole_edge_offset", 1),
    ("stack", "flange_gap", .1), ("preform", "chamfer", 3),
    ("preform", "trial_delta", 1), ("preform", "thickness_override", -1),
    ("pcb", "opening_length", 20), ("preform", "unknown", 1),
])
def test_invalid_inputs_rejected(data, group, field, value):
    data[group][field] = value
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_path_traversal_name_rejected(data):
    data["name"] = "../../outside"
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_no_inferred_base_dimensions(data):
    del data["copper"]["base_length"]
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_override_changes_model_only(data):
    r1 = calculate(Design.from_mapping(data))
    data["preform"]["thickness_override"] = .37
    r2 = calculate(Design.from_mapping(data))
    assert r2.model_thickness == .37
    assert r2.calculated_thickness == r1.calculated_thickness
    assert r2.trial_thicknesses == r1.trial_thicknesses


def test_trial_conflict_and_clearance_visible(data):
    r = calculate(Design.from_mapping(data))
    assert r.corner_clearance == pytest.approx(.2828427125)
    assert any("第13頁" in w for w in r.warnings)
    assert any("0.37 mm" in w for w in r.warnings)


def test_browser_layout_metadata_roundtrip_preserves_manufacturing_geometry(data):
    original = calculate(Design.from_mapping(data))
    data["layout"] = {"border_width": 1.5, "epad_size": 2, "web_width": .4, "hole_clearance": 4}
    design = Design.from_mapping(data)
    updated = calculate(design)
    assert design.to_mapping()["layout"] == data["layout"]
    assert updated.boss_volume == original.boss_volume
    assert updated.model_thickness == original.model_thickness
