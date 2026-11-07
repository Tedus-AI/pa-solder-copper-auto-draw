from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = Path(__file__).parents[1] / "app.py"


def test_form_generates_downloadable_validated_models():
    app = AppTest.from_file(str(APP), default_timeout=90).run()
    assert not app.exception
    app.button[0].click().run()
    assert not app.exception
    assert not app.error
    assert len(app.metric) == 4
    assert app.session_state["generated"]["zip"].startswith(b"PK")
    assert app.session_state["generated"]["result"]["preform_area"] > 177
    assert len(app.session_state["generated"]["copper"]["i"]) > 0


def test_invalid_form_clears_stale_download():
    app = AppTest.from_file(str(APP), default_timeout=90).run()
    app.button[0].click().run()
    assert "generated" in app.session_state
    app.number_input(key="copper.pad_size").set_value(4.0)
    app.button[0].click().run()
    assert not app.exception
    assert app.error
    assert "generated" not in app.session_state
