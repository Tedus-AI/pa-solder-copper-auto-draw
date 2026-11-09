"""Build the copper 2D drawing template from the reference drawing 348001J40001.

Run (needs ezdxf, e.g. the cad-app environment), from the repository root:

    python web/scripts/build-drawing-template.py 348001J40001.dxf web/public/drawing/copper-drawing-template.json

The reference DXF (a Creo export, AC1015) supplies the drawing format: the A4 frame
and title block of the drawing sheet, the cover sheet with its revision table, the
Delta logo, the arrow block (_FILLED) and the surface-roughness symbols. Everything
drawn for part 348001J40001 (views, dimensions, notes, revision marks) is removed;
web/src/copper-drawing.js regenerates it from the tool's design.

The cover is restored to the first release: revision 01 (its row, entry texts and
delta marks) is removed so only the 00 "1.發行圖面" row remains. Values that change
per export are replaced by @@NAME@@ placeholders:

    DATE         drawing sheet date (2026/2/26 style)
    DATE_PADDED  cover release-row dates (2026/02/23 style)
    USED_ON      project name;  PART_NO  part number;  DESCRIPTION  Cu base E*F*T
    SHEET/SHEETS drawing sheet number (1 of 1, or 2 of 2 after the cover)

The DXF text is split into pieces that the browser reassembles: new block records go
before the BLOCK_RECORD table end, new blocks before the BLOCKS section end, and the
drawing entities after the template's sheet (and optional cover) entities. Text is
stored as Unicode (UTF-8 JSON); the browser writes the DXF in the reference's code
page, ANSI_950 (Big5).
"""
import io
import json
import re
import sys

from ezdxf import bbox, recover
from ezdxf.math import Vec2

REF, OUT = sys.argv[1:3]
doc, auditor = recover.readfile(REF)
msp = doc.modelspace()

FORMAT_LAYERS = {"12_COIN_DXF_FORMAT", "PAPER", "10___PAPER"}
SHEET_BOX = (0.0, 0.0, 198.0, 140.0)  # drawing sheet (A4 scaled 2/3 by the Creo export)


def anchor(e):
    t = e.dxftype()
    try:
        if t == "LINE":
            return e.dxf.start
        if t in ("TEXT", "MTEXT", "INSERT"):
            return e.dxf.insert
        if t in ("CIRCLE", "ARC"):
            return e.dxf.center
        if t == "LWPOLYLINE":
            return Vec2(next(iter(e.vertices())))
    except (AttributeError, StopIteration):
        pass
    return None


def on_cover(e):
    """The cover (x -159…0, y 0…225) lies left of the drawing sheet (x 0…198, y 0…140);
    its frame shares the x = 0 edge but runs higher."""
    b = bbox.extents([e])
    return b.has_data and b.extmax.x < 0.01 and (b.extmin.x < -1 or b.extmax.y > 140.01)


def revision_01(e):
    """Revision 01 on the cover: entry texts, row lines and the two delta marks."""
    t = e.dxftype()
    if t == "TEXT":
        return 149.0 < e.dxf.insert.y < 177.9  # between the 00 row and the bottom of the 01 row
    if t == "LINE":
        if e.dxf.layer == "0":
            return True  # the delta triangles are the cover's only layer-0 lines
        ys = (e.dxf.start.y, e.dxf.end.y)
        return min(ys) > 149.8 and max(ys) < 155.9 and e.dxf.start.distance(e.dxf.end) > 1
    return False


cover = set()
for e in list(msp):
    if on_cover(e):
        if revision_01(e):
            msp.delete_entity(e)
        else:
            cover.add(e.dxf.handle)
        continue
    p = anchor(e)
    if not (p is not None and p[0] > -1 and e.dxf.layer in FORMAT_LAYERS):
        msp.delete_entity(e)

# ── per-export values → placeholders ──
replaced = {}


def placeholder(entity, value):
    replaced[value] = replaced.get(value, 0) + 1
    return f"@@{value}@@"


for t in msp.query("TEXT"):
    key = t.dxf.text.strip()
    if key == "2026/2/26":
        t.dxf.text = placeholder(t, "DATE")
    elif key == "2026/02/23":
        t.dxf.text = placeholder(t, "DATE_PADDED")
    elif key == "DMR-464X-3537A":
        t.dxf.text = placeholder(t, "USED_ON")
        t.dxf.style = "STANDARD"  # project names may be Chinese; the Arial style has no CJK
    elif key == "348001J400":
        t.dxf.text = placeholder(t, "PART_NO")
    elif key.startswith("Cu base "):
        t.dxf.text = placeholder(t, "DESCRIPTION")
    elif key == "01":
        t.dxf.text = "00"  # REV: first release
    elif key == "2" and abs(t.dxf.insert.y - 8.0) < 1e-6 and 95 < t.dxf.insert.x < 102:
        t.dxf.text = placeholder(t, "SHEET")
    elif key == "2" and abs(t.dxf.insert.y - 8.0) < 1e-6 and 102 < t.dxf.insert.x < 106:
        t.dxf.text = placeholder(t, "SHEETS")
for t in msp.query("MTEXT"):  # cover title block (SHEET 1 OF 2 stays as drawn)
    if "{01}" in t.text:
        t.text = t.text.replace("{01}", "{00}")
    if "348001J400" in t.text:
        t.text = t.text.replace("348001J400", placeholder(t, "PART_NO"))
expected = {"DATE": 1, "DATE_PADDED": 2, "USED_ON": 2, "PART_NO": 2, "DESCRIPTION": 2, "SHEET": 1, "SHEETS": 1}
assert replaced == expected, replaced

# ── blocks: keep the ones the format and the drawing use ──
KEEP_BLOCKS = {"_FILLED", "SF0_BL4", "SYM_13_BL3"}
arrow_blocks = {  # arrowheads named by the dimension styles must stay defined
    name for style in doc.dimstyles for attr in ("dimblk", "dimblk1", "dimblk2", "dimldrblk")
    if (name := style.dxf.get(attr)) and name in doc.blocks
}
used, todo = set(), [e.dxf.name for e in msp.query("INSERT")] + sorted(KEEP_BLOCKS | arrow_blocks)
while todo:
    name = todo.pop()
    if name in used:
        continue
    used.add(name)
    todo += [e.dxf.name for e in doc.blocks[name].query("INSERT")]
for block in list(doc.blocks):
    if not block.is_any_layout and block.name not in used:
        doc.blocks.delete_block(block.name, safe=False)
for name in KEEP_BLOCKS:
    assert name in doc.blocks, name
for name in ("COIN_DXF_CONTINUOUS_LINE", "COIN_DXF_AXIS", "12_COIN_DXF_DIMENSION", "12_COIN_DXF_TEXT"):
    assert name in doc.layers, name
assert "DASHED" in doc.linetypes and "DIMSTYLE_1" in doc.dimstyles and "STANDARD" in doc.styles

# ── header and initial view: filled in per export ──
SENTINEL = {"EXTMIN_X": -99991.0, "EXTMIN_Y": -99992.0, "EXTMAX_X": 99993.0, "EXTMAX_Y": 99994.0,
            "VIEW_X": 99995.0, "VIEW_Y": 99996.0, "VIEW_H": 99997.0}
doc.header["$EXTMIN"] = (SENTINEL["EXTMIN_X"], SENTINEL["EXTMIN_Y"], 0)
doc.header["$EXTMAX"] = (SENTINEL["EXTMAX_X"], SENTINEL["EXTMAX_Y"], 0)
active = doc.viewports.get_config("*Active")[0]
active.dxf.center = (SENTINEL["VIEW_X"], SENTINEL["VIEW_Y"])
active.dxf.height = SENTINEL["VIEW_H"]

stream = io.StringIO()
doc.write(stream)
text = stream.getvalue()
for name, value in SENTINEL.items():
    assert text.count(f"\n{value}\n") == 1, name
    text = text.replace(f"\n{value}\n", f"\n@@{name}@@\n")
lines = text.split("\n")
if lines[-1] == "":
    lines.pop()
pairs = [(lines[i].strip(), lines[i + 1]) for i in range(0, len(lines), 2)]


def join(ps):
    return "".join(f"{code:>3}\n{value}\n" for code, value in ps)


def find(start, code, value):
    for i in range(start, len(pairs)):
        if pairs[i] == (code, value):
            return i
    raise ValueError((code, value))


br_table = find(find(0, "0", "TABLE"), "2", "BLOCK_RECORD") - 1
assert pairs[br_table] == ("0", "TABLE")
br_handle = dict(pairs[br_table:br_table + 6])["5"]
br_count_at = next(i for i in range(br_table, br_table + 12) if pairs[i][0] == "70")
pairs[br_count_at] = ("70", "@@BLOCK_RECORD_COUNT@@")
br_end = find(br_table, "0", "ENDTAB")
blocks_start = find(find(0, "2", "BLOCKS"), "0", "BLOCK")
blocks_end = find(blocks_start, "0", "ENDSEC")
entities_header = find(blocks_end, "2", "ENTITIES")
entities_end = find(entities_header, "0", "ENDSEC")
seed = next(i for i in range(len(pairs)) if pairs[i] == ("9", "$HANDSEED"))
pairs[seed + 1] = ("5", "@@HANDSEED@@")

chunks, current = [], None
for code, value in pairs[entities_header + 1:entities_end]:
    if code == "0":
        current = []
        chunks.append(current)
    current.append((code, value))
sheet, cover_chunks = [], []
for chunk in chunks:
    handle = dict(chunk).get("5")
    (cover_chunks if handle in cover else sheet).append(chunk)
assert len(cover_chunks) == len(cover), (len(cover_chunks), len(cover))

handles = [int(value, 16) for code, value in pairs if code in ("5", "105") and re.fullmatch(r"[0-9A-F]+", value)]
modelspace_record = doc.modelspace().block_record.dxf.handle
template = {
    "format": "pa-copper-drawing-template",
    "version": 1,
    "source": "348001J40001.dxf (Creo export, AC1015); revision 01 removed from the cover",
    "dxf_version": doc.dxfversion,
    "next_handle": max(handles) + 1,
    "block_record_count": sum(1 for _ in doc.block_records),
    "handles": {"block_record_table": br_handle, "model_space": modelspace_record},
    "block_names": sorted(b.name for b in doc.blocks),
    "sheet_box": SHEET_BOX,
    "cover_box": [-159.0334252381, 0.0, 0.0, 224.9187008582],
    "parts": {
        "head": join(pairs[:br_end]),
        "block_records_end": join(pairs[br_end:blocks_end]),
        "blocks_end": join(pairs[blocks_end:entities_header + 1]),
        "sheet": "".join(join(c) for c in sheet),
        "cover": "".join(join(c) for c in cover_chunks),
        "tail": join(pairs[entities_end:]),
    },
}
assert "NET26" not in json.dumps(template) and "修改" not in template["parts"]["cover"]
with open(OUT, "w", encoding="utf-8", newline="\n") as f:
    json.dump(template, f, ensure_ascii=False, separators=(",", ":"))
    f.write("\n")
print(f"{OUT}: {sum(len(p) for p in template['parts'].values()) // 1024} KiB of DXF, "
      f"{len(sheet)} sheet + {len(cover_chunks)} cover entities, next handle {template['next_handle']:X}")
