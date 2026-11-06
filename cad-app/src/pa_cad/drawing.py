"""Millimetre DXF views, dimensions and manufacturing notes."""
from __future__ import annotations

import math
from pathlib import Path

import ezdxf

from .design import Design, Result, octagon, tolerance, DEFAULT_TOLERANCES
from .creo import rounded_boundary_distance


def _tol(d, key):
    minus, plus = tolerance(d, key)
    specified = key in DEFAULT_TOLERANCES or key in {"package.length", "package.width", "pcb.opening_length", "pcb.opening_width"}
    if not specified and minus == plus == 0:
        return " (tolerance unspecified)"
    return f" +/-{plus:g}" if minus == plus else f" +{plus:g}/-{minus:g}"


def _document():
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$MEASUREMENT"] = 1
    for name, color in {"OUTLINE": 7, "BOSS": 3, "PAD": 2, "HOLES": 1,
                        "DIM": 4, "NOTES": 7, "SIDE": 6}.items():
        doc.layers.new(name, dxfattribs={"color": color})
    return doc, doc.modelspace()


def _poly(msp, points, layer="OUTLINE"):
    msp.add_lwpolyline(points, close=True, dxfattribs={"layer": layer})


def _rect(msp, cx, cy, w, h, layer="OUTLINE"):
    _poly(msp, [(cx-w/2, cy-h/2), (cx+w/2, cy-h/2),
                (cx+w/2, cy+h/2), (cx-w/2, cy+h/2)], layer)


def _text(msp, text, x, y, height=1.0):
    msp.add_mtext(text, dxfattribs={"insert": (x, y), "char_height": height,
                                   "width": 95, "layer": "NOTES"})


def _dim(msp, p1, p2, base, angle=0, text="<>"):
    msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, text=text,
                       dimstyle="EZDXF", override={"dimtxt": .8, "dimasz": .4,
                                                    "dimdec": 4, "dimgap": .3},
                       dxfattribs={"layer": "DIM"}).render()


def _profile(msp, center, baseline, base_width, boss_width, pad, g, lower, k, boss_offset=0):
    x, y, bw, w = center, baseline, base_width / 2, boss_width / 2
    bx = x+boss_offset
    points = [(x-bw,y), (x+bw,y), (x+bw,y+g), (bx+w,y+g),
              (bx+w,y+g+lower+k), (bx+w-pad,y+g+lower+k),
              (bx+w-pad,y+g+lower), (bx-w+pad,y+g+lower),
              (bx-w+pad,y+g+lower+k), (bx-w,y+g+lower+k),
              (bx-w,y+g), (x-bw,y+g)]
    _poly(msp, points, "SIDE")


def write_copper(d: Design, r: Result, path: Path):
    doc, msp = _document()
    c = d.copper
    x, y, rad = c.base_length / 2, c.base_width / 2, c.corner_radius
    bulge = math.tan(math.pi / 8)
    pts = [(-x+rad,-y,0), (x-rad,-y,bulge), (x,-y+rad,0),
           (x,y-rad,bulge), (x-rad,y,0), (-x+rad,y,bulge),
           (-x,y-rad,0), (-x,-y+rad,bulge)]
    hx, hy = x - c.hole_edge_offset, y - c.hole_edge_offset
    contained = all(rounded_boundary_distance(xx, yy, c.base_length, c.base_width, rad)+c.hole_diameter/2 <= 1e-10
                    for xx, yy in [(-hx, -hy), (hx, hy)])
    if contained:
        msp.add_lwpolyline(pts, format="xyb", close=True, dxfattribs={"layer": "OUTLINE"})
        for point in [(-hx,-hy), (hx,hy)]:
            msp.add_circle(point, c.hole_diameter/2, dxfattribs={"layer": "HOLES"})
    else:
        # Deliver the actual cut silhouette; full circles would falsely close
        # a corner breakout. Sampling uses maximum 0.0001 mm chord deflection.
        import cadquery as cq
        base = (cq.Workplane("XY").rect(c.base_length, c.base_width).extrude(c.base_thickness)
                .edges("|Z").fillet(rad))
        holes = cq.Workplane("XY").pushPoints([(-hx, -hy), (hx, hy)]).circle(c.hole_diameter/2).extrude(c.base_thickness)
        bottom = base.cut(holes).faces("<Z").val()
        outer = bottom.outerWire()
        for wire in bottom.Wires():
            points, _ = wire.sample(.0001)
            _poly(msp, [(p.x, p.y) for p in points], "OUTLINE" if wire.isSame(outer) else "HOLES")
    bx, by = r.boss_center
    _rect(msp, bx, by, r.boss_length, r.boss_width, "BOSS")
    px, py = (r.boss_length-c.pad_size)/2, (r.boss_width-c.pad_size)/2
    for xx in (-px, px):
        for yy in (-py, py):
            _rect(msp, bx+xx, by+yy, c.pad_size, c.pad_size, "PAD")
    _dim(msp, (-x,y), (x,y), (0,y+5), text="E = <>"+_tol(d,"copper.base_length")+" mm")
    _dim(msp, (-x,-y), (-x,y), (-x-5,0), 90, "F = <>"+_tol(d,"copper.base_width")+" mm")
    _dim(msp, (bx-r.boss_length/2,by), (bx+r.boss_length/2,by), (0,y+2), text="I = <>"+_tol(d,"boss.length")+" mm")
    _dim(msp, (bx,by-r.boss_width/2), (bx,by+r.boss_width/2), (x+5,0), 90, "H = <>"+_tol(d,"boss.width")+" mm")
    _dim(msp, (hx,hy), (x,hy), (0,y+9), text="C = <>"+_tol(d,"copper.hole_edge_offset")+" mm")
    _dim(msp, (hx,hy), (hx,y), (x+10,0), 90, "C = <>"+_tol(d,"copper.hole_edge_offset")+" mm")
    _dim(msp, (-x,by), (bx,by), (0,-y-6), text="Boss datum X = <> mm")
    _dim(msp, (bx,-y), (bx,by), (x+14,0), 90, "Boss datum Y = <> mm")
    baseline = -y-16
    _profile(msp, 0, baseline, c.base_length, r.boss_length, c.pad_size,
             c.base_thickness, r.boss_lower_height, d.stack.pad_height, bx)
    side_x = x+c.base_width/2+20
    _profile(msp, side_x, baseline, c.base_width, r.boss_width, c.pad_size,
             c.base_thickness, r.boss_lower_height, d.stack.pad_height, by)
    _dim(msp, (-x,baseline), (-x,baseline+c.base_thickness), (-x-5,0), 90, "G = <>"+_tol(d,"copper.base_thickness")+" mm")
    _text(msp, "FRONT (1:1)", -x, baseline-3)
    _text(msp, "RIGHT (1:1)", side_x-c.base_width/2, baseline-3)
    notes_x = x+20
    notes = [
        f"{d.name} / COPPER BLOCK / mm / nominal geometry",
        f"E = {c.base_length:g}{_tol(d,'copper.base_length')} mm; F = {c.base_width:g}{_tol(d,'copper.base_width')} mm",
        f"G = {c.base_thickness:g}{_tol(d,'copper.base_thickness')} mm; R = {c.corner_radius:g}{_tol(d,'copper.corner_radius')} mm",
        f"2X D = DIA {c.hole_diameter:g}{_tol(d,'copper.hole_diameter')} mm THRU; C = {c.hole_edge_offset:g}{_tol(d,'copper.hole_edge_offset')} mm",
        f"I = {r.boss_length:g}{_tol(d,'boss.length')} mm; H = {r.boss_width:g}{_tol(d,'boss.width')} mm",
        f"L(CuH) = {r.boss_total_height:.4f}{_tol(d,'boss.total_height')} mm above base top",
        f"4X J = {c.pad_size:g}{_tol(d,'copper.pad_size')} mm; K = {d.stack.pad_height:g}{_tol(d,'stack.pad_height')} mm",
        f"Lower pedestal height L-K: {r.boss_lower_height:.4f}",
        "Finish: electroless Ni <1.5 um; matte Sn 1.5-3.5 um",
        "Package: sulfur-free paper, individually heat-sealed plastic bag",
        f"Mating heatsink depth: {r.heatsink_depth:g} +/-0.05",
        "Base E/F require thermal and RF approval; no inferred final base size.",
        "See report.json for assumptions / unresolved PDF differences.",
    ]
    _text(msp, "\\P".join(notes), notes_x, y+12, .9)
    doc.saveas(path)


def write_preform(d: Design, r: Result, path: Path):
    doc, msp = _document()
    _poly(msp, octagon(r.boss_length, r.boss_width, d.preform.chamfer))
    x, y = r.boss_length/2, r.boss_width/2
    _dim(msp, (-x,0), (x,0), (0,y+4), text="W = <>"+_tol(d,"preform.length")+" mm")
    _dim(msp, (0,-y), (0,y), (-x-4,0), 90, "X = <>"+_tol(d,"preform.width")+" mm")
    _dim(msp, (-x,-y+d.preform.chamfer), (-x+d.preform.chamfer,-y),
         (0,-y-4), text=f"Y = {d.preform.chamfer:g}{_tol(d,'preform.chamfer')} mm (45 deg)")
    baseline = -y-12
    _rect(msp, 0, baseline+r.model_thickness/2, r.boss_length, r.model_thickness, "SIDE")
    _dim(msp, (x,baseline), (x,baseline+r.model_thickness), (x+4,baseline),
         90, "Z = <>"+_tol(d,"preform.thickness_override")+" mm")
    _text(msp, "FRONT (1:1)", -x, baseline-3)
    notes = [f"{d.name} / SOLDER PREFORM / mm / nominal geometry",
             f"W = {r.boss_length:g}{_tol(d,'preform.length')} mm; X = {r.boss_width:g}{_tol(d,'preform.width')} mm",
             f"4X 45 deg chamfer: Y = {d.preform.chamfer:g}{_tol(d,'preform.chamfer')} mm",
             f"Z = {r.model_thickness:.6f}{_tol(d,'preform.thickness_override')} mm",
             f"Calculated Z: {r.calculated_thickness:.6f}; A1: {r.preform_area:.6f} mm2",
             "Material: SAC305 (96.5Sn3Ag0.5Cu), coated with 0.5% F8 flux",
             f"Trial thicknesses (unrounded): {', '.join(f'{v:.6f}' for v in r.trial_thicknesses)}",
             "Set final thickness_override only after process selection / sectioning.",
             "See report.json for the PDF p12/p13 trial-step difference."]
    _text(msp, "\\P".join(notes), x+12, y+4, .9)
    doc.saveas(path)
