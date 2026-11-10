"""Protocol/contract simulation only. These tests do NOT validate real PRT files."""
from copy import deepcopy
from dataclasses import asdict, replace
import io
import json
import math
from pathlib import Path

import pytest

from pa_cad.creo import Creoson, CreoError, FEATURES, generate, main, prepare_job, validate_job, native_copper_volume
from pa_cad.design import Design, Project, calculate
from pa_cad.solid import expected_copper_volume


@pytest.fixture
def job():
    d = Design.load(Path(__file__).parents[1] / "examples/780-m1p.yaml")
    r = calculate(d)
    return prepare_job(d.to_mapping(), asdict(r), {"copper": expected_copper_volume(d, r),
                                                "preform": r.preform_area*r.model_thickness})


def test_project_metadata_is_preserved_without_driving_native_geometry(job):
    d = Design.from_mapping(job["design"])
    d = replace(d, project=Project("基地台 PA 專案 / A", "H-37248KC-6/2"))
    r = calculate(d)
    updated = prepare_job(d.to_mapping(), asdict(r),
                          {part: job["expected"][part]["volume"] for part in ("copper", "preform")})
    assert updated["design"]["project"] == {"name": "基地台 PA 專案 / A", "pa_model": "H-37248KC-6/2", "pa_brand": "", "project_id": ""}
    assert updated["native_parameters"] == job["native_parameters"]
    assert updated["name"] == job["name"]
    validate_job(updated)


class ProtocolSimulator:
    """Independent analytical geometry behind a fake CREOSON protocol boundary."""
    def __init__(self, job, drive_geometry=True, imported=False, write_backup=True):
        self.job, self.drive_geometry, self.imported, self.write_backup = job, drive_geometry, imported, write_backup
        self.models, self.backups, self.calls = {}, {}, []

    def measurements(self, model):
        part = model["part"]
        p = model["params"] if self.drive_geometry else self.job["native_parameters"][part]
        if part == "copper":
            volume = (p["BASE_L"]*p["BASE_W"]-(4-math.pi)*p["BASE_R"]**2-2*math.pi*(p["HOLE_D"]/2)**2)*p["BASE_T"]
            volume += p["BOSS_L"]*p["BOSS_W"]*(p["CUH"]-p["PAD_H"])+4*p["PAD_SIZE"]**2*p["PAD_H"]
            bounds = [p["BASE_L"], p["BASE_W"], p["BASE_T"]+p["CUH"]]
        else:
            volume = (p["PREFORM_L"]*p["PREFORM_W"]-2*p["CHAMFER_Y"]**2)*p["PREFORM_Z"]
            bounds = [p["PREFORM_L"], p["PREFORM_W"], p["PREFORM_Z"]]
        return volume, bounds

    def call(self, command, function, **data):
        self.calls.append((command, function, data))
        if command == "connection":
            return {"running": True} if function == "is_creo_running" else {}
        if command == "creo" and function == "set_creo_version":
            assert data["version"] == 7
            return {}
        name = data["file"]
        if command == "file" and function == "list":
            return {"files": [name] if name in self.models else []}
        if command == "file" and function == "open":
            if name in self.backups:
                self.models[name] = deepcopy(self.backups[name])
            else:
                part = name.split("_master")[0]
                self.models[name] = {"part": part, "params": dict(self.job["native_parameters"][part])}
            return {"files": [name]}
        if command == "file" and function == "rename":
            assert data["onlysession"] is True
            self.models[data["new_name"]] = self.models.pop(name)
            return {"file": data["new_name"]}
        if command == "file" and function == "erase":
            del self.models[name]
            return {}
        model = self.models[name]
        if command == "parameter":
            if function == "set":
                assert data["no_create"] is True and data["type"] == "DOUBLE"
                assert data["name"] in model["params"]
                model["params"][data["name"]] = data["value"]
                return {}
            return {"paramlist": [{"name": k, "value": model["params"][k]} for k in data["names"]]}
        if command == "feature":
            feats = [{"name": f, "type": "PROTRUSION", "status": "ACTIVE"} for f in FEATURES[model["part"]]]
            if self.imported:
                feats.append({"name": "IMPORTED", "type": "IMPORT", "status": "ACTIVE"})
            return {"featlist": feats}
        if command == "geometry":
            _, b = self.measurements(model)
            return {"xmin": -b[0]/2, "xmax": b[0]/2, "ymin": -b[1]/2, "ymax": b[1]/2, "zmin": 0, "zmax": b[2]}
        if command == "file":
            if function == "regenerate":
                return {}
            if function == "open_errors":
                return {"errors": False}
            if function == "get_length_units":
                return {"units": "mm"}
            if function == "massprops":
                return {"volume": self.measurements(model)[0]}
            if function == "backup":
                self.backups[name] = deepcopy(model)
                if self.write_backup:
                    (Path(data["target_dir"]) / (name+".1")).write_bytes(b"PROTOCOL SIMULATION ONLY; NOT A CREO FILE")
                return {}
        raise AssertionError((command, function, data))


@pytest.fixture
def masters(tmp_path):
    folder = tmp_path / "masters"
    folder.mkdir()
    for part in FEATURES:
        # Fake source fixtures never leave pytest temporary directories.
        (folder / f"{part}_master.prt.2").write_bytes(b"PROTOCOL TEST FIXTURE ONLY")
    return folder


def test_native_protocol_sequence_and_master_preservation(job, masters, tmp_path):
    rpc = ProtocolSimulator(job)
    folder = generate(job, masters, tmp_path / "native", rpc)
    report = json.loads((folder / "native_report.json").read_text())
    assert set(report["parts"]) == {"copper", "preform"}
    assert all(part["dimension_change_probe"] == "passed" for part in report["parts"].values())
    assert not rpc.models  # Only models owned by the runner were erased.
    assert all(p.read_bytes() == b"PROTOCOL TEST FIXTURE ONLY" for p in masters.iterdir())
    functions = [(a, b) for a, b, _ in rpc.calls]
    assert functions.index(("creo", "set_creo_version")) < functions.index(("file", "regenerate"))
    assert functions.count(("file", "open")) == 4  # Includes actual protocol reopen checks.
    assert functions.count(("file", "regenerate")) == 6  # initial, changed, restored for each part.
    assert "single solid body" in report["manual_checks_remaining"]


def test_unbound_parameters_cannot_pass_regeneration_probe(job, masters, tmp_path):
    rpc = ProtocolSimulator(job, drive_geometry=False)
    with pytest.raises(CreoError, match="volume|xmax"):
        generate(job, masters, tmp_path / "native", rpc)
    assert not (tmp_path / "native").exists()
    assert list(tmp_path.glob(".native-*/FAILED.txt"))
    assert not rpc.models


def test_imported_solids_are_rejected(job, masters, tmp_path):
    with pytest.raises(CreoError, match="imported"):
        generate(job, masters, tmp_path / "native", ProtocolSimulator(job, imported=True))
    assert not (tmp_path / "native").exists()


def test_no_prt_written_is_not_success(job, masters, tmp_path):
    with pytest.raises(CreoError, match="did not write"):
        generate(job, masters, tmp_path / "native", ProtocolSimulator(job, write_backup=False))


def test_existing_user_model_is_never_erased(job, masters, tmp_path):
    rpc = ProtocolSimulator(job)
    rpc.models["copper_master.prt"] = {"user_work": True}
    with pytest.raises(CreoError, match="already in the Creo session"):
        generate(job, masters, tmp_path / "native", rpc)
    assert rpc.models["copper_master.prt"] == {"user_work": True}
    assert not any(b == "erase" for _, b, _ in rpc.calls)


def test_missing_native_masters_never_contacts_creo(job, tmp_path):
    rpc = ProtocolSimulator(job)
    with pytest.raises(CreoError, match="Missing native master"):
        generate(job, tmp_path, tmp_path / "native", rpc)
    assert not rpc.calls


def test_generated_name_collision_preserves_existing_model(job, masters, tmp_path, monkeypatch):
    from types import SimpleNamespace
    monkeypatch.setattr("pa_cad.creo.uuid4", lambda: SimpleNamespace(hex="a"*32))
    rpc = ProtocolSimulator(job)
    rpc.models["pa_cu_aaaaaaaaaa.prt"] = {"user_work": True}
    with pytest.raises(CreoError, match="already exists in Creo"):
        generate(job, masters, tmp_path / "native", rpc)
    assert rpc.models == {"pa_cu_aaaaaaaaaa.prt": {"user_work": True}}


@pytest.mark.parametrize("change", ["target", "units", "import", "volume", "nan"])
def test_invalid_or_tampered_job_rejected(job, change):
    if change == "target":
        job["target"] = {"version": "10"}
    elif change == "units":
        job["units"] = "inch"
    elif change == "import":
        job["step_import_acceptable"] = True
    elif change == "volume":
        job["expected"]["copper"]["volume"] *= 2
    else:
        job["native_parameters"]["preform"]["PREFORM_Z"] = float("nan")
    with pytest.raises(CreoError):
        validate_job(job)


@pytest.mark.parametrize("endpoint", ["http://example.com/creoson", "http://user:pw@localhost/creoson", "http://localhost/other"])
def test_only_local_creoson_endpoint_allowed(endpoint):
    with pytest.raises(CreoError):
        Creoson(endpoint)


def test_http_contract_and_server_error():
    requests = []
    class Opener:
        def open(self, request, timeout):
            payload = json.loads(request.data)
            requests.append(payload)
            if payload["function"] == "connect":
                return io.BytesIO(b'{"status":{"error":false},"sessionId":"TEST_SESSION"}')
            return io.BytesIO(b'{"status":{"error":true,"message":"fixture failure"}}')
    client = Creoson()
    client.opener = Opener()
    client.call("connection", "connect")
    with pytest.raises(CreoError, match="fixture failure"):
        client.call("creo", "set_creo_version", version=7)
    assert requests[1] == {"sessionId": "TEST_SESSION", "command": "creo", "function": "set_creo_version", "data": {"version": 7}}


def test_native_generation_refuses_non_windows(monkeypatch, capsys):
    monkeypatch.setattr("pa_cad.creo.platform.system", lambda: "Linux")
    assert main(["generate", "unused.json", "--templates", "unused", "--output", "unused"]) == 2
    assert "Windows 11" in capsys.readouterr().err


def test_optional_signed_boss_position_pair_and_legacy_contract(job):
    job["native_parameters"]["copper"].update(BOSS_X=1, BOSS_Y=-1)
    validate_job(job)
    del job["native_parameters"]["copper"]["BOSS_X"]
    with pytest.raises(CreoError, match="contract"):
        validate_job(job)
    del job["native_parameters"]["copper"]["BOSS_Y"]
    validate_job(job)  # Legacy centered masters remain accepted.


def test_native_contract_accepts_corner_breakouts_with_recomputed_volume(job):
    job["native_parameters"]["copper"]["HOLE_EDGE"] = 1
    job["expected"]["copper"]["volume"] = native_copper_volume(job["native_parameters"]["copper"])
    validate_job(job)


def test_native_contract_rejects_boss_offset_outside_base(job):
    job["native_parameters"]["copper"].update(BOSS_X=18, BOSS_Y=0)
    with pytest.raises(CreoError, match="outside"):
        validate_job(job)
