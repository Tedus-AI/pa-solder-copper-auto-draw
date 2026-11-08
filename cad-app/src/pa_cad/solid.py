"""Exact B-rep solids; never rename STEP output to pretend it is Creo PRT."""
from __future__ import annotations
from .creo import mounting_centers, copper_hole_mask
from dataclasses import asdict

import cadquery as cq

from .design import Design, Result, octagon


def copper_block(d: Design, r: Result) -> cq.Workplane:
    c = d.copper
    base = (cq.Workplane("XY").rect(c.base_length, c.base_width)
            .extrude(c.base_thickness).edges("|Z").fillet(c.corner_radius))
    hx, hy = c.base_length / 2 - c.hole_edge_offset, c.base_width / 2 - c.hole_edge_offset
    # The tool overshoots both base faces to avoid a coplanar boolean cut;
    # the resulting hole is identical.
    overshoot = .1
    holes = (cq.Workplane("XY").workplane(offset=-overshoot)
             .pushPoints(mounting_centers({"BASE_L":c.base_length,"BASE_W":c.base_width,"HOLE_EDGE":c.hole_edge_offset,"HOLE_MASK":copper_hole_mask(asdict(c))}))
             .circle(c.hole_diameter / 2).extrude(c.base_thickness + 2 * overshoot))
    base = base.cut(holes)
    bx, by = r.boss_center
    boss = (cq.Workplane("XY").workplane(offset=c.base_thickness)
            .center(bx, by).rect(r.boss_length, r.boss_width).extrude(r.boss_lower_height))
    px, py = (r.boss_length - c.pad_size) / 2, (r.boss_width - c.pad_size) / 2
    pads = (cq.Workplane("XY").workplane(offset=c.base_thickness + r.boss_lower_height)
            .pushPoints([(bx+x, by+y) for x in (-px, px) for y in (-py, py)])
            .rect(c.pad_size, c.pad_size).extrude(d.stack.pad_height))
    result = base.union(boss).union(pads).clean()
    if len(result.solids().vals()) != 1 or not result.val().isValid():
        raise ValueError("孔切除造成斷裂或無效銅塊實體，無法作為單一製造零件")
    return result


def solder_preform(d: Design, r: Result) -> cq.Workplane:
    return (cq.Workplane("XY").polyline(octagon(r.boss_length, r.boss_width, r.preform_chamfer))
            .close().extrude(r.model_thickness))


def expected_copper_volume(d: Design, r: Result) -> float:
    return r.copper_base_area * d.copper.base_thickness + r.boss_volume
