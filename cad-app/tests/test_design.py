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
    ("copper", "base_thickness", 2.9), ("copper", "hole_edge_offset", 0),
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


def test_browser_auto_opening_and_rule_roundtrip(data):
    data["pcb"].update(opening_mode="auto", opening_rule="delta")
    data["package"].update(length=20.62, width=9.83)
    delta = Design.from_mapping(data)
    assert (delta.pcb.opening_length, delta.pcb.opening_width) == (21, 10.2)
    assert (calculate(delta).boss_length, calculate(delta).boss_width) == (20.7, 9.9)
    data["pcb"]["opening_rule"] = "ampleon"
    ampleon = Design.from_mapping(data)
    assert (ampleon.pcb.opening_length, ampleon.pcb.opening_width) == (20.9, 10.1)
    assert calculate(ampleon).model_thickness != calculate(delta).model_thickness
    assert Design.from_mapping(ampleon.to_mapping()) == ampleon


@pytest.mark.parametrize("key,value", [("opening_mode", True), ("opening_rule", "invalid")])
def test_invalid_opening_linkage_rejected(data, key, value):
    data["pcb"][key] = value
    with pytest.raises(ValueError):
        Design.from_mapping(data)


def test_modern_browser_boss_and_tolerance_metadata(data):
    data["boss"] = {"length": 21, "width": 10, "total_height": .55,
                    "center_from_left": 21, "center_from_bottom": 14,
                    "size_mode": "manual", "height_mode": "manual"}
    data["pcb"].update(opening_length=21.5, opening_width=10.5)
    data["preform"].update(length=21, width=10)
    data["tolerances"] = {"package.length": {"minus": .1, "plus": .2},
                          "pcb.opening_length": {"minus": .15, "plus": .1},
                          "boss.length": {"minus": .05, "plus": .05}}
    d = Design.from_mapping(data)
    r = calculate(d)
    assert (r.boss_length, r.boss_width, r.boss_total_height) == (21, 10, .55)
    assert r.boss_center == (1, -1)
    assert r.gap_analysis["x"]["min"] == pytest.approx((21.5-.15-20.57-.2)/2)
    assert r.gap_analysis["x"]["max"] == pytest.approx((21.5+.1-20.57+.1)/2)
    assert Design.from_mapping(d.to_mapping()) == d


def test_gap_bounds_use_dimensions_not_placement_capability(data):
    data["pcb"]["placement_accuracy"] = 5
    r = calculate(Design.from_mapping(data))
    assert r.gap_analysis["x"]["min"] == pytest.approx(.0515)
    assert r.gap_analysis["x"]["max"] == pytest.approx(.2785)
    assert r.gap_analysis["y"]["min"] == pytest.approx(.0465)
    assert r.gap_analysis["y"]["max"] == pytest.approx(.2735)


def test_auto_opening_uses_asymmetric_undersize_allowance(data):
    data["pcb"]["opening_mode"] = "auto"
    data["tolerances"] = {"pcb.opening_length": {"minus": .2, "plus": 0}}
    r = calculate(Design.from_mapping(data))
    assert r.recommended_opening[0] == 21.0
    assert r.gap_analysis["x"]["min"] == pytest.approx(.0515)
    data["pcb"]["opening_rule"] = "ampleon"
    assert calculate(Design.from_mapping(data)).recommended_opening[0] == 20.9


def test_corner_hole_breakout_is_allowed_and_real_area_is_larger_than_full_circle_subtraction(data):
    import math
    data["copper"]["hole_edge_offset"] = 1
    d = Design.from_mapping(data)
    r = calculate(d)
    full_cut_area = 40*30-(4-math.pi)*3**2-2*math.pi*1.5**2
    assert r.copper_base_area > full_cut_area


def test_boss_offset_must_stay_on_rounded_base_and_away_from_holes(data):
    data["boss"] = {"center_from_left": 38, "center_from_bottom": 15}
    with pytest.raises(ValueError, match="中凸台"):
        Design.from_mapping(data)
