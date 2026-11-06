"""Standalone, standard-library-only CREOSON runner for native Creo master models.

This module does not create master models. Real Creo/Windows execution is required
to produce PRT; protocol simulation tests are not native CAD validation.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import platform
import re
import shutil
import sys
import tempfile
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4

TARGET = {"product": "Creo Parametric", "version": "7.0.10.0", "os": "Windows 11"}
FEATURES = {"copper": ["BASE_EXTRUDE", "BASE_ROUNDS", "MOUNT_HOLES", "MAIN_BOSS", "CORNER_PADS"],
            "preform": ["PREFORM_EXTRUDE"]}
PARAMETERS = {"copper": {"BASE_L", "BASE_W", "BASE_T", "BASE_R", "HOLE_D", "HOLE_EDGE",
                          "BOSS_L", "BOSS_W", "CUH", "PAD_SIZE", "PAD_H"},
              "preform": {"PREFORM_L", "PREFORM_W", "CHAMFER_Y", "PREFORM_Z"}}
POSITION_PARAMETERS = {"BOSS_X", "BOSS_Y"}


class CreoError(RuntimeError):
    pass


def rounded_boundary_distance(x, y, length, width, radius):
    """Signed distance to a centered rounded rectangle (negative inside)."""
    qx, qy = abs(x)-(length/2-radius), abs(y)-(width/2-radius)
    return math.hypot(max(qx, 0), max(qy, 0))+min(max(qx, qy), 0)-radius


def rounded_base_area(params):
    """Rounded base minus the actual union of its two corner-hole cuts.

    Contained holes retain the exact closed form. Breakouts integrate true
    circular sections; this stdlib implementation also ships with the runner.
    """
    length, width, radius = params["BASE_L"], params["BASE_W"], params["BASE_R"]
    rad, off = params["HOLE_D"]/2, params["HOLE_EDGE"]
    hx, hy = length/2-off, width/2-off
    centers = [(-hx, -hy), (hx, hy)]
    outer = length*width-(4-math.pi)*radius**2
    if (all(rounded_boundary_distance(x, y, length, width, radius)+rad <= 1e-10 for x, y in centers)
            and math.hypot(2*hx, 2*hy) >= 2*rad):
        return outer-2*math.pi*rad**2

    def section(x):
        dx = max(abs(x)-(length/2-radius), 0)
        top = width/2-radius+math.sqrt(max(radius**2-dx**2, 0))
        intervals = []
        for cx, cy in centers:
            if abs(x-cx) < rad:
                half = math.sqrt(max(rad**2-(x-cx)**2, 0))
                lo, hi = max(-top, cy-half), min(top, cy+half)
                if hi > lo:
                    intervals.append((lo, hi))
        intervals.sort()
        removed, end = 0., -math.inf
        for lo, hi in intervals:
            removed += max(0, hi-max(lo, end))
            end = max(end, hi)
        return 2*top-removed

    def integrate(a, b, fa, fm, fb, whole, eps, depth):
        mid, left, right = (a+b)/2, (3*a+b)/4, (a+3*b)/4
        fl, fr = section(left), section(right)
        lval, rval = (mid-a)*(fa+4*fl+fm)/6, (b-mid)*(fm+4*fr+fb)/6
        delta = lval+rval-whole
        if depth <= 0 or abs(delta) <= 15*eps:
            return lval+rval+delta/15
        return integrate(a, mid, fa, fl, fm, lval, eps/2, depth-1)+integrate(mid, b, fm, fr, fb, rval, eps/2, depth-1)

    breaks = {-length/2, length/2, -length/2+radius, length/2-radius}
    breaks.update(max(-length/2, min(length/2, cx+s*rad)) for cx, _ in centers for s in (-1, 1))
    points = sorted(breaks)
    area = 0.
    for a, b in zip(points, points[1:]):
        fa, fm, fb = section(a), section((a+b)/2), section(b)
        area += integrate(a, b, fa, fm, fb, (b-a)*(fa+4*fm+fb)/6, 1e-9, 25)
    return area


def native_copper_volume(params):
    return (rounded_base_area(params)*params["BASE_T"]
            + params["BOSS_L"]*params["BOSS_W"]*(params["CUH"]-params["PAD_H"])
            + 4*params["PAD_SIZE"]**2*params["PAD_H"])


def prepare_job(design: dict, derived: dict, volumes: dict) -> dict:
    c, s = design["copper"], design["stack"]
    native = {"copper": {"BASE_L": c["base_length"], "BASE_W": c["base_width"],
                          "BASE_T": c["base_thickness"], "BASE_R": c["corner_radius"],
                          "HOLE_D": c["hole_diameter"], "HOLE_EDGE": c["hole_edge_offset"],
                          "BOSS_L": derived["boss_length"], "BOSS_W": derived["boss_width"],
                          "CUH": derived["boss_total_height"], "PAD_SIZE": c["pad_size"], "PAD_H": s["pad_height"]},
              "preform": {"PREFORM_L": derived["boss_length"], "PREFORM_W": derived["boss_width"],
                           "CHAMFER_Y": design["preform"]["chamfer"], "PREFORM_Z": derived["model_thickness"]}}
    if "boss" in design or "boss_center" in derived:
        center = derived.get("boss_center")
        if center is None:
            b = design["boss"]
            center = [b["center_from_left"]-c["base_length"]/2, b["center_from_bottom"]-c["base_width"]/2]
        native["copper"].update(BOSS_X=center[0], BOSS_Y=center[1])
    return {"schema_version": 2, "status": "awaiting_local_creo_execution", "target": dict(TARGET),
            "name": design["name"], "units": "mm", "required_model_type": "native_parametric_features",
            "step_import_acceptable": False, "design": design, "derived": derived,
            "native_parameters": native, "required_features": FEATURES,
            "expected": {"copper": {"volume": volumes["copper"],
                                      "bounds": [c["base_length"], c["base_width"], c["base_thickness"]+derived["boss_total_height"]]},
                         "preform": {"volume": volumes["preform"],
                                       "bounds": [derived["boss_length"], derived["boss_width"], derived["model_thickness"]]}},
            "note": "Requires two native parametric Creo master models. STEP files are references only. Run creo_runner.py locally; no native PRT has been generated by this job file."}


def validate_job(job: dict):
    if job.get("schema_version") != 2 or job.get("target") != TARGET:
        raise CreoError("Job must target Creo Parametric 7.0.10.0 / Windows 11 (schema 2).")
    if job.get("required_model_type") != "native_parametric_features" or job.get("step_import_acceptable") is not False:
        raise CreoError("Only native parametric feature trees are accepted.")
    if job.get("units") != "mm" or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,39}", job.get("name", "")):
        raise CreoError("Invalid job name or units.")
    for part in PARAMETERS:
        params = job.get("native_parameters", {}).get(part, {})
        allowed = [PARAMETERS[part]]
        if part == "copper":
            allowed.append(PARAMETERS[part] | POSITION_PARAMETERS)
        if set(params) not in allowed:
            raise CreoError(f"{part}: incorrect native parameter contract.")
        expected = job.get("expected", {}).get(part, {})
        bounds = expected.get("bounds", [])
        if len(bounds) != 3:
            raise CreoError(f"{part}: expected XYZ bounds are missing.")
        for key, value in params.items():
            if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                    or (key not in POSITION_PARAMETERS and value <= 0)):
                raise CreoError(f"{part}: invalid numeric value.")
        for value in [expected.get("volume"), *bounds]:
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
                raise CreoError(f"{part}: invalid numeric value.")
    # The runner accepts only the exact geometry schema emitted by this tool.
    # Recompute analytical volume/bounds, rather than trusting arbitrary expected values.
    c, p = job["native_parameters"]["copper"], job["native_parameters"]["preform"]
    if (c["BASE_T"] not in (2.5, 3.0) or not c["CUH"] > c["PAD_H"]
            or not 0 < c["BASE_R"] < min(c["BASE_L"], c["BASE_W"])/2
            or not c["BASE_L"] > c["BOSS_L"] or not c["BASE_W"] > c["BOSS_W"]
            or not 0 < c["PAD_SIZE"] < min(c["BOSS_L"], c["BOSS_W"])/2
            or not 0 < 2*c["HOLE_EDGE"] < min(c["BASE_L"], c["BASE_W"])
            or not 2*c["PAD_SIZE"] < p["CHAMFER_Y"] < min(p["PREFORM_L"], p["PREFORM_W"])/2
            or p["PREFORM_L"] != c["BOSS_L"] or p["PREFORM_W"] != c["BOSS_W"]):
        raise CreoError("Inconsistent native geometry.")
    hx, hy = c["BASE_L"]/2-c["HOLE_EDGE"], c["BASE_W"]/2-c["HOLE_EDGE"]
    bx, by = c.get("BOSS_X", 0), c.get("BOSS_Y", 0)
    if any(rounded_boundary_distance(bx+sx*c["BOSS_L"]/2, by+sy*c["BOSS_W"]/2,
                                    c["BASE_L"], c["BASE_W"], c["BASE_R"]) > 1e-8
           for sx in (-1, 1) for sy in (-1, 1)):
        raise CreoError("Main boss extends outside the rounded base.")
    for sign in (-1, 1):
        if math.hypot(max(abs(sign*hx-bx)-c["BOSS_L"]/2, 0), max(abs(sign*hy-by)-c["BOSS_W"]/2, 0)) <= c["HOLE_D"]/2:
            raise CreoError("Mounting holes intersect the main boss.")
    copper_volume = native_copper_volume(c)
    volume = {"copper": copper_volume,
              "preform": (p["PREFORM_L"]*p["PREFORM_W"]-2*p["CHAMFER_Y"]**2)*p["PREFORM_Z"]}
    bounds = {"copper": [c["BASE_L"], c["BASE_W"], c["BASE_T"]+c["CUH"]],
              "preform": [p["PREFORM_L"], p["PREFORM_W"], p["PREFORM_Z"]]}
    for part in PARAMETERS:
        _close(job["expected"][part]["volume"], volume[part], f"{part} job volume")
        for actual, expected in zip(job["expected"][part]["bounds"], bounds[part]):
            _close(actual, expected, f"{part} job bounds")


class Creoson:
    def __init__(self, endpoint="http://127.0.0.1:9056/creoson", timeout=60):
        url = urlparse(endpoint)
        if (url.scheme != "http" or url.hostname not in {"127.0.0.1", "localhost", "::1"}
                or url.username or url.password or url.path != "/creoson" or url.query or url.fragment):
            raise CreoError("CREOSON must run locally at an http loopback /creoson endpoint.")
        self.endpoint, self.timeout, self.session = endpoint, timeout, None
        # Only loopback is accepted above; remote proxy bypass is never allowed.
        self.opener = build_opener(ProxyHandler({}))

    def call(self, command, function, **data):
        payload = {"command": command, "function": function}
        if data:
            payload["data"] = data
        if self.session:
            payload["sessionId"] = self.session
        request = Request(self.endpoint, json.dumps(payload, allow_nan=False).encode(),
                          headers={"Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                result = json.load(response)
        except (URLError, TimeoutError, ValueError) as exc:
            raise CreoError(f"{command}.{function}: local CREOSON request failed: {exc}") from exc
        status = result.get("status") if isinstance(result, dict) else None
        if not isinstance(status, dict) or status.get("error") is not False:
            message = status.get("message", "invalid/error response") if isinstance(status, dict) else "invalid response"
            raise CreoError(f"{command}.{function}: {message}")
        if command == "connection" and function == "connect":
            self.session = result.get("sessionId")
            if not isinstance(self.session, str) or not self.session:
                raise CreoError("CREOSON did not return a sessionId.")
        data = result.get("data", {})
        if not isinstance(data, dict):
            raise CreoError(f"{command}.{function}: invalid response data.")
        return data


def _close(actual, expected, context):
    if isinstance(actual, bool) or not isinstance(actual, (int, float)) or not math.isfinite(actual):
        raise CreoError(f"{context}: missing/invalid numeric measurement.")
    if not math.isclose(actual, expected, rel_tol=1e-4, abs_tol=1e-3):
        raise CreoError(f"{context}: measured {actual}, expected {expected}.")


def inspect_model(rpc, name, part, params, expected):
    if rpc.call("file", "open_errors", file=name).get("errors") is not False:
        raise CreoError(f"{name}: Creo reports model errors.")
    if rpc.call("file", "get_length_units", file=name).get("units") != "mm":
        raise CreoError(f"{name}: master model must use mm.")
    features = rpc.call("feature", "list", file=name, inc_unnamed=True, no_datum=True).get("featlist", [])
    if not features or any("IMPORT" in f.get("type", "").upper() for f in features):
        raise CreoError(f"{name}: imported/empty feature tree is not acceptable.")
    active = {f.get("name", "").upper() for f in features if f.get("status") == "ACTIVE"}
    if not set(FEATURES[part]) <= active or any(f.get("status") != "ACTIVE" for f in features):
        raise CreoError(f"{name}: missing, inactive or unregenerated native features.")
    readback = {p["name"].upper(): p.get("value") for p in
                rpc.call("parameter", "list", file=name, names=sorted(params)).get("paramlist", [])}
    for key, value in params.items():
        _close(readback.get(key), value, f"{name} parameter {key}")
    volume = rpc.call("file", "massprops", file=name).get("volume")
    _close(volume, expected["volume"], f"{name} volume")
    box = rpc.call("geometry", "bound_box", file=name)
    sizes = []
    for axis, target in zip("xyz", expected["bounds"]):
        low, high = box.get(axis+"min"), box.get(axis+"max")
        if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (low, high)):
            raise CreoError(f"{name}: invalid bounding box.")
        _close(low, 0 if axis == "z" else -target/2, f"{name} {axis}min")
        _close(high, target if axis == "z" else target/2, f"{name} {axis}max")
        sizes.append(high-low)
    return {"volume_mm3": volume, "bounds_mm": sizes, "features": features, "parameters": readback}


def _set(rpc, name, key, value):
    rpc.call("parameter", "set", file=name, name=key, type="DOUBLE", value=value, no_create=True)


def regenerate_probe(rpc, name, part, params, expected):
    changed = dict(params)
    probe = {"volume": expected["volume"], "bounds": list(expected["bounds"])}
    if part == "copper":
        key, delta = "BASE_L", .5
        probe["bounds"][0] += delta
        probe["volume"] = native_copper_volume({**params, "BASE_L": params["BASE_L"]+delta})
    else:
        key, delta = "PREFORM_Z", .01
        probe["bounds"][2] += delta
        area = params["PREFORM_L"]*params["PREFORM_W"]-2*params["CHAMFER_Y"]**2
        probe["volume"] += delta*area
    changed[key] += delta
    try:
        _set(rpc, name, key, changed[key])
        rpc.call("file", "regenerate", file=name)
        inspect_model(rpc, name, part, changed, probe)
    finally:
        _set(rpc, name, key, params[key])
        rpc.call("file", "regenerate", file=name)
    return inspect_model(rpc, name, part, params, expected)


def _master_file(directory, part):
    base = directory / f"{part}_master.prt"
    revisions = [(int(p.name.rsplit(".", 1)[1]), p) for p in directory.glob(base.name+".*")
                 if p.is_file() and p.name.rsplit(".", 1)[1].isdigit()]
    return max(revisions)[1] if revisions else base


def generate(job, templates, output, rpc):
    """Run on the same computer as Creo/CREOSON. Never edit the source masters."""
    validate_job(job)
    templates, output = Path(templates).resolve(), Path(output).resolve()
    masters = {part: _master_file(templates, part) for part in PARAMETERS}
    for path in masters.values():
        if not path.is_file() or path.stat().st_size == 0:
            raise CreoError(f"Missing native master: {path}. No synthetic PRT/template is provided.")
    source_hashes = {part: hashlib.sha256(path.read_bytes()).hexdigest() for part, path in masters.items()}
    if output.exists():
        raise CreoError(f"Output already exists; choose a new directory: {output}")
    output.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{output.name}-", dir=output.parent))
    owned, connected = set(), False
    try:
        rpc.call("connection", "connect")
        connected = True
        if rpc.call("connection", "is_creo_running").get("running") is not True:
            raise CreoError("Start licensed Creo Parametric 7.0.10.0 first.")
        rpc.call("creo", "set_creo_version", version=7)
        report = {"schema_version": 1, "target": TARGET, "created_at_utc": datetime.now(timezone.utc).isoformat(),
                  "status": "automatic_checks_passed_manual_acceptance_pending", "parts": {},
                  "template_sha256": source_hashes,
                  "manual_checks_remaining": ["Exact Creo build and OS from local preflight", "single solid body", "editable sketch constraints", "all driving dimensions / complete design change workflow", "MAIN_BOSS X/Y sketch location and positional regeneration; volume/bounds checks do not prove boss position"]}
        work = stage / "_work"
        work.mkdir()
        for part, master in masters.items():
            template_name = f"{part}_master.prt"
            if rpc.call("file", "list", file=template_name).get("files"):
                raise CreoError(f"{template_name} is already in the Creo session; use a separate automation session.")
            copy = work / template_name
            shutil.copy2(master, copy)
            rpc.call("file", "open", file=template_name, dirname=str(work), display=False)
            owned.add(template_name)
            name = f"pa_{'cu' if part == 'copper' else 'sn'}_{uuid4().hex[:10]}.prt"
            if rpc.call("file", "list", file=name).get("files"):
                raise CreoError(f"Generated name {name} already exists in Creo; refusing to replace it.")
            rpc.call("file", "rename", file=template_name, new_name=name, onlysession=True)
            owned.discard(template_name)
            owned.add(name)
            params, expected = job["native_parameters"][part], job["expected"][part]
            for key, value in params.items():
                _set(rpc, name, key, value)
            rpc.call("file", "regenerate", file=name)
            initial = inspect_model(rpc, name, part, params, expected)
            regenerate_probe(rpc, name, part, params, expected)
            rpc.call("file", "backup", file=name, target_dir=str(stage))
            saved = [p for p in stage.iterdir() if re.fullmatch(re.escape(name)+r"(?:\.\d+)?", p.name) and p.is_file() and p.stat().st_size]
            if not saved:
                raise CreoError(f"{name}: Creo did not write a PRT file.")
            rpc.call("file", "erase", file=name)
            owned.discard(name)
            rpc.call("file", "open", file=name, dirname=str(stage), display=False)
            owned.add(name)
            restored = inspect_model(rpc, name, part, params, expected)
            rpc.call("file", "erase", file=name)
            owned.discard(name)
            report["parts"][part] = {"model_name": name, "files": sorted(p.name for p in saved),
                                      "initial": initial, "reopened": restored, "dimension_change_probe": "passed"}
        for part, path in masters.items():
            if hashlib.sha256(path.read_bytes()).hexdigest() != source_hashes[part]:
                raise CreoError("A source master changed during execution; investigate before accepting output.")
        shutil.rmtree(work)
        report["output_sha256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in stage.iterdir() if p.is_file()}
        (stage / "native_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        stage.rename(output)
        return output
    except Exception:
        # Partial Creo output is retained separately for diagnosis, never advertised
        # as a passed delivery. Never delete files which a live Creo model may use.
        (stage / "FAILED.txt").write_text("This is a failed/partial native run, not an accepted delivery.\n", encoding="utf-8")
        raise
    finally:
        for name in list(owned):
            try:
                rpc.call("file", "erase", file=name)
            except Exception:
                pass
        if connected:
            try:
                rpc.call("connection", "disconnect")
            except Exception:
                pass


def installation_check(root, rpc=None):
    result = {"target": TARGET, "observed_os": platform.system(), "observed_release": platform.release(),
              "python": platform.python_version(), "native_execution_verified": False}
    if root:
        root = Path(root)
        result["installation_files"] = {str(rel): (root / rel).is_file() for rel in [
            "Parametric/bin/parametric.bat", "Common Files/x86e_win64/obj/parametric.exe",
            "Common Files/text/java/pfc.jar", "Common Files/text/java/pfcasync.jar"]}
    if rpc:
        connected = False
        try:
            rpc.call("connection", "connect")
            connected = True
            result["creo_running"] = rpc.call("connection", "is_creo_running").get("running") is True
            rpc.call("creo", "set_creo_version", version=7)
            result["creo7_protocol_setup"] = True
        except CreoError as exc:
            result["connection_error"] = str(exc)
        finally:
            if connected:
                try:
                    rpc.call("connection", "disconnect")
                except CreoError:
                    pass
    result["ready_for_template_run"] = (result["observed_os"] == "Windows" and
        result.get("creo_running") is True and result.get("creo7_protocol_setup") is True)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description="Local Creo 7.0.10.0 native parametric master runner (no CAD libraries required).")
    parser.add_argument("mode", choices=["check", "generate"])
    parser.add_argument("job", nargs="?", help="creo_job.json from the exported bundle")
    parser.add_argument("--endpoint", default="http://127.0.0.1:9056/creoson")
    parser.add_argument("--creo-root", help="Installation folder; check reports file presence only, not license values")
    parser.add_argument("--templates", help="Folder containing native copper_master.prt and preform_master.prt")
    parser.add_argument("--output", help="New output folder; existing folders are refused")
    args = parser.parse_args(argv)
    try:
        rpc = Creoson(args.endpoint)
        if args.mode == "check":
            result = installation_check(args.creo_root, rpc)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result["ready_for_template_run"] else 2
        if platform.system() != "Windows":
            raise CreoError("Native generation must run on your Windows 11 Creo workstation.")
        if not args.job or not args.templates or not args.output:
            raise CreoError("generate requires JOB, --templates and --output.")
        job = json.loads(Path(args.job).read_text(encoding="utf-8"))
        result = generate(job, args.templates, args.output, rpc)
        print(f"Native files generated by local Creo; review native_report.json and complete manual acceptance: {result}")
        return 0
    except (CreoError, OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Creo integration error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
