#!/usr/bin/env python3
"""FreeCAD STEP → colored PLY exporter.

This module focuses on color fidelity and is designed to be imported from the
existing macOS/CLI wrappers without disturbing the legacy OBJ workflow.  It can
also be executed directly when STEP_INPUT_FILE / STEP_OUTPUT_FILE are supplied
via environment variables (matching the current pipeline convention).

Key features implemented in this first iteration:
  * STEP schema inspection (warn on AP203)
  * Extraction of object- and face-level colors from FreeCAD ViewObjects
  * Tessellation of each face with color propagation (PLY per-face colors)
  * Skipping helper containers, null shapes and duplicate TopoShape hashes
  * Structured logging compatible with the existing "freecad_step_debug.log"

The exporter intentionally keeps units in millimetres to match the remainder of
our toolchain.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

# FreeCAD is expected to be available because callers follow the existing
# pipeline bootstrap.  Import guarded to provide actionable feedback when users
# run the script manually in a bare Python environment.
try:
    import FreeCAD  # type: ignore
    import Import  # type: ignore  # noqa: F401 - ensure STEP importer is loaded
    import Part  # type: ignore
except Exception as exc:  # pragma: no cover - environment specific
    raise RuntimeError(
        "FreeCAD modules are required for freecad_color_export. "
        "Make sure to run this script via the pipeline wrappers."
    ) from exc

try:
    import MeshPart  # type: ignore
except Exception:
    MeshPart = None  # MeshPart is optional; we fall back to manual tessellation


LOG = logging.getLogger("freecad.color_export")
DEFAULT_COLOR = (0.9, 0.9, 0.9, 1.0)

# Helper containers we never want to export
SKIP_TYPE_PREFIXES = (
    "App::Origin",
    "App::Line",
    "App::Plane",
    "App::CoordinateSystem",
    "App::Annotation",
)
SKIP_TYPE_IDS = {
    "App::Link",
}


@dataclass(frozen=True)
class FaceTriangle:
    vertex_indices: Tuple[int, int, int]
    color_rgba: Tuple[int, int, int, int]


@dataclass
class MeshBundle:
    name: str
    display_path: str
    vertices: List[Tuple[float, float, float]]
    faces: List[FaceTriangle]
    color_source: str


def _configure_logging(log_file: Optional[str] = None) -> None:
    if LOG.handlers:
        return

    handlers: List[logging.Handler] = []
    formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    handlers.append(stream)

    if log_file:
        os.makedirs(os.path.dirname(log_file), exist_ok=True)
        file_handler = logging.FileHandler(log_file)
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)

    for handler in handlers:
        LOG.addHandler(handler)

    LOG.setLevel(logging.DEBUG)


def _read_header_schema(step_path: str) -> str:
    pattern = re.compile(r"FILE_SCHEMA\s*\(\s*\('([^']+)'\)\s*\)")
    try:
        with open(step_path, "r", encoding="utf-8", errors="ignore") as handle:
            header = handle.read(1000)
        match = pattern.search(header)
        if match:
            schema = match.group(1).strip().upper()
            LOG.info("STEP schema detected: %s", schema)
            if "AP203" in schema:
                LOG.warning(
                    "STEP file uses AP203 – face colors are often missing."
                )
            return schema
    except Exception as exc:  # pragma: no cover - diagnostics only
        LOG.warning("Failed to inspect STEP schema: %s", exc)
    return "UNKNOWN"


def _load_step_file(step_path: str, doc: FreeCAD.Document) -> Sequence[FreeCAD.DocumentObject]:
    LOG.info("Starting STEP import via Import.insert()")
    Import.insert(step_path, doc.Name)
    doc.recompute()
    return list(doc.Objects)


def _get_global_placement(obj: FreeCAD.DocumentObject) -> Optional[FreeCAD.Placement]:
    try:
        if hasattr(obj, "getGlobalPlacement"):
            placement = obj.getGlobalPlacement()
            if placement:
                return placement
    except Exception as exc:
        LOG.debug("Global placement lookup failed for %s: %s", obj.Label, exc)
    return getattr(obj, "Placement", None)


def _build_object_path(obj: FreeCAD.DocumentObject) -> List[str]:
    path_segments: List[str] = []
    visited: set = set()
    current = obj
    while current and current not in visited:
        visited.add(current)
        path_segments.append(getattr(current, "Label", getattr(current, "Name", "Unnamed")))
        parents = getattr(current, "InList", []) or []
        parent_part = None
        for parent in parents:
            type_id = getattr(parent, "TypeId", "") or ""
            if type_id.startswith("App::Part"):
                parent_part = parent
                break
        current = parent_part
    if not path_segments:
        return ["Unnamed"]
    path_segments.reverse()
    return path_segments


def _is_helper_object(obj: FreeCAD.DocumentObject) -> bool:
    type_id = getattr(obj, "TypeId", "") or ""
    if type_id in SKIP_TYPE_IDS:
        return True
    if any(type_id.startswith(prefix) for prefix in SKIP_TYPE_PREFIXES):
        return True
    label = (getattr(obj, "Label", "") or "").lower()
    for skip_name in ("axis", "plane", "origin"):
        if skip_name in label:
            return True
    if hasattr(obj, "Visibility") and not obj.Visibility:
        return True
    return False


def _shape_iter(obj: FreeCAD.DocumentObject) -> Iterable[Tuple[str, FreeCAD.Shape]]:
    shape = getattr(obj, "Shape", None)
    if not shape or shape.isNull():
        return

    # Compounds: expose child solids individually to maintain 1:1 mapping
    if hasattr(shape, "Solids") and len(shape.Solids) > 1:
        for index, solid in enumerate(shape.Solids, start=1):
            yield f"{obj.Label}_Solid{index}", solid
        return

    if hasattr(shape, "Shells") and len(shape.Shells) > 1:
        for index, shell in enumerate(shape.Shells, start=1):
            yield f"{obj.Label}_Shell{index}", shell
        return

    yield obj.Label, shape


def _face_colors_from_viewobject(obj: FreeCAD.DocumentObject, shape: FreeCAD.Shape) -> Tuple[List[Tuple[float, float, float, float]], str]:
    if not hasattr(obj, "ViewObject"):
        return [DEFAULT_COLOR] * len(shape.Faces), "default"

    vo = obj.ViewObject
    # Face-level diffuse colors (tuple of tuple)
    diffuse = getattr(vo, "DiffuseColor", None)
    shape_color = getattr(vo, "ShapeColor", DEFAULT_COLOR[:3])

    colors: List[Tuple[float, float, float, float]] = []
    color_source = "default"

    if diffuse and len(diffuse) == len(shape.Faces):
        colors = [(c[0], c[1], c[2], getattr(c, "w", 1.0) if hasattr(c, "w") else 1.0) for c in diffuse]
        color_source = "face"
    elif diffuse and len(diffuse) == 1:
        colors = [(diffuse[0][0], diffuse[0][1], diffuse[0][2], 1.0)] * len(shape.Faces)
        color_source = "uniform"
    else:
        rgbs = getattr(vo, "DiffuseColor", None)
        if isinstance(rgbs, (tuple, list)) and rgbs:
            ref_color = rgbs[0]
            colors = [(ref_color[0], ref_color[1], ref_color[2], 1.0)] * len(shape.Faces)
            color_source = "viewobject"

    if not colors:
        colors = [(shape_color[0], shape_color[1], shape_color[2], 1.0)] * len(shape.Faces)
        color_source = "shape"

    return colors, color_source


def _rgba_to_bytes(rgba: Tuple[float, float, float, float]) -> Tuple[int, int, int, int]:
    r, g, b, a = rgba
    return (
        max(0, min(255, int(round(r * 255.0)))),
        max(0, min(255, int(round(g * 255.0)))),
        max(0, min(255, int(round(b * 255.0)))),
        max(0, min(255, int(round(a * 255.0)))),
    )


def _tessellate_shape_to_mesh(shape: FreeCAD.Shape, colors: Sequence[Tuple[float, float, float, float]], quality: float) -> MeshBundle:
    vertices: List[Tuple[float, float, float]] = []
    vertex_map: Dict[Tuple[float, float, float], int] = {}
    faces: List[FaceTriangle] = []

    def _get_index(pt: Tuple[float, float, float]) -> int:
        key = (round(pt[0], 6), round(pt[1], 6), round(pt[2], 6))
        if key not in vertex_map:
            vertex_map[key] = len(vertices)
            vertices.append(pt)
        return vertex_map[key]

    for face_index, face in enumerate(shape.Faces):
        rgba = colors[min(face_index, len(colors) - 1)] if colors else DEFAULT_COLOR
        color_bytes = _rgba_to_bytes(rgba)
        try:
            tess = face.tessellate(quality)
        except Exception as exc:
            LOG.warning("Face tessellation failed at index %s: %s", face_index, exc)
            continue

        if not tess or len(tess) < 2:
            continue

        face_vertices, face_tris = tess
        if not face_vertices or not face_tris:
            continue

        indices = [_get_index((v.x, v.y, v.z)) for v in face_vertices]
        for tri in face_tris:
            if len(tri) != 3:
                continue
            tri_indices = tuple(indices[idx] for idx in tri)
            faces.append(FaceTriangle(tri_indices, color_bytes))

    return MeshBundle(
        name=shape.Label if hasattr(shape, "Label") else "shape",
        display_path="",
        vertices=vertices,
        faces=faces,
        color_source="face",
    )


def _build_mesh_bundles(objects: Sequence[FreeCAD.DocumentObject], quality: float) -> List[MeshBundle]:
    bundles: List[MeshBundle] = []
    seen_hashes: set = set()

    for obj in objects:
        if _is_helper_object(obj):
            continue

        type_id = getattr(obj, "TypeId", "") or ""
        if type_id == "App::Part":
            group_children = getattr(obj, "Group", []) or []
            if any(getattr(child, "Shape", None) and not child.Shape.isNull() for child in group_children):
                LOG.debug("Skipping App::Part container with child geometry: %s", obj.Label)
                continue

        for child_label, shape in _shape_iter(obj) or []:
            if not shape or shape.isNull():
                LOG.debug("Skipping null shape: %s", child_label)
                continue

            try:
                topo_hash = shape.hashCode()
                if topo_hash in seen_hashes:
                    LOG.debug("Skipping duplicate solid (hash %s): %s", topo_hash, child_label)
                    continue
                seen_hashes.add(topo_hash)
            except Exception:
                # hashCode might fail for certain shapes; ignore and proceed
                pass

            colors, color_source = _face_colors_from_viewobject(obj, shape)
            bundle = _tessellate_shape_to_mesh(shape, colors, quality)
            bundle.name = child_label
            bundle.display_path = " / ".join(_build_object_path(obj) + [child_label])
            bundle.color_source = color_source
            bundles.append(bundle)

    LOG.info("Prepared %s mesh bundles for export", len(bundles))
    return bundles


def _write_ply(output_path: str, bundles: Sequence[MeshBundle]) -> None:
    total_vertices = sum(len(bundle.vertices) for bundle in bundles)
    total_faces = sum(len(bundle.faces) for bundle in bundles)

    LOG.info(
        "Writing PLY (ascii) with %s vertices and %s faces to %s",
        total_vertices,
        total_faces,
        output_path,
    )

    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, "w", encoding="ascii") as ply:
        ply.write("ply\n")
        ply.write("format ascii 1.0\n")
        ply.write("comment Generated by freecad_color_export.py\n")
        for bundle in bundles:
            ply.write(f"comment object {bundle.name} path {bundle.display_path}\n")
        ply.write(f"element vertex {total_vertices}\n")
        ply.write("property float x\n")
        ply.write("property float y\n")
        ply.write("property float z\n")
        ply.write(f"element face {total_faces}\n")
        ply.write("property list uchar int vertex_indices\n")
        ply.write("property uchar red\n")
        ply.write("property uchar green\n")
        ply.write("property uchar blue\n")
        ply.write("property uchar alpha\n")
        ply.write("end_header\n")

        # Vertices: we output bundle by bundle; indices must be offset accordingly
        vertex_offset = 0
        for bundle in bundles:
            for vx, vy, vz in bundle.vertices:
                ply.write(f"{vx:.6f} {vy:.6f} {vz:.6f}\n")
            vertex_offset += len(bundle.vertices)

        vertex_offset = 0
        for bundle in bundles:
            for face in bundle.faces:
                i0, i1, i2 = face.vertex_indices
                r, g, b, a = face.color_rgba
                ply.write(f"3 {i0 + vertex_offset} {i1 + vertex_offset} {i2 + vertex_offset} {r} {g} {b} {a}\n")
            vertex_offset += len(bundle.vertices)

    LOG.info("PLY written successfully")


def export_step_to_ply(step_path: str, output_path: str, quality: float = 0.1) -> None:
    _configure_logging(os.environ.get("STEP_LOG_FILE"))
    LOG.info("STEP → PLY export (color preserving)")
    LOG.info("Input STEP: %s", step_path)
    LOG.info("Output PLY: %s", output_path)
    LOG.info("Quality: %s", quality)

    schema = _read_header_schema(step_path)

    doc = FreeCAD.newDocument("StepColorExport")
    try:
        objects = _load_step_file(step_path, doc)
        bundles = _build_mesh_bundles(objects, quality)
        if not bundles:
            raise RuntimeError("No exportable shapes found in STEP document")
        _write_ply(output_path, bundles)
    finally:
        FreeCAD.closeDocument(doc.Name)
        LOG.info("Closed FreeCAD document")

    status_path = os.environ.get("STEP_STATUS_PATH")
    if status_path:
        payload = {
            "schema": schema,
            "output": output_path,
            "bundles": len(bundles),
            "notes": [],
        }
        with open(status_path, "w", encoding="utf-8") as status_file:
            json.dump(payload, status_file, indent=2)
        LOG.info("Status file written: %s", status_path)


def _env_export_main() -> None:
    step_path = os.environ.get("STEP_INPUT_FILE")
    output_path = os.environ.get("STEP_OUTPUT_FILE")
    quality = float(os.environ.get("STEP_TESSELLATION", "0.1"))

    if not step_path or not output_path:
        raise RuntimeError("Environment variables STEP_INPUT_FILE and STEP_OUTPUT_FILE are required")

    if not output_path.lower().endswith(".ply"):
        output_path = os.path.splitext(output_path)[0] + ".ply"

    export_step_to_ply(step_path, output_path, quality)


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    _env_export_main()
