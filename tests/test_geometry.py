import pytest

from pa_draw.config import load_design
from pa_draw.dxf_writer import write_dxf
from pa_draw.geometry import build_geometry, split_windows
from pa_draw.models import DesignInput, PAPackage, Rect, SolderSpec


def _design(**solder):
    return DesignInput(PAPackage("t", 10, 6, 8, 4), SolderSpec(**solder))


def test_offset():
    r = Rect(0, 0, 4, 2).offset(0.5)
    assert (r.w, r.h) == (5, 3)


def test_single_window_coverage():
    g = build_geometry(_design(inset=0.0))
    assert g.solder_coverage == pytest.approx(1.0)


def test_window_pane_split():
    ws = split_windows(Rect(0, 0, 7.4, 3.8), 3, 2, 0.2)
    assert len(ws) == 6
    assert ws[0].w == pytest.approx((7.4 - 0.4) / 3)
    assert ws[0].x0 == pytest.approx(-3.7)
    assert ws[-1].x0 + ws[-1].w == pytest.approx(3.7)


def test_coin_and_cutout():
    g = build_geometry(_design())
    assert g.coin.w == pytest.approx(9.0)
    assert g.pcb_cutout.w == pytest.approx(9.2)


def test_invalid_windows():
    with pytest.raises(ValueError):
        split_windows(Rect(0, 0, 1, 1), 10, 1, 0.2)


def test_example_end_to_end(tmp_path):
    g = build_geometry(load_design("examples/pa_example.yaml"))
    out = write_dxf(g, tmp_path / "a.dxf")
    assert out.exists() and out.stat().st_size > 0
