#!/usr/bin/env python3
"""
macOS FreeCAD Script for STEP to OBJ Conversion
Optimized for macOS FreeCAD.app installation
"""

import sys
import os
import json
import logging
import re
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# Setup persistent logging to workspace
import FreeCAD
log_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "freecad_step_debug.log")

logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

# Add FreeCAD lib path for macOS
freecad_lib_path = "/Applications/FreeCAD.app/Contents/Resources/lib"
if os.path.exists(freecad_lib_path):
    sys.path.insert(0, freecad_lib_path)
    logger.info(f"Added FreeCAD lib path: {freecad_lib_path}")

# Track STEP color extraction status for optional reporting back to caller
status_path = os.environ.get('STEP_STATUS_PATH')
status_payload = {
    'script': 'macos',
    'colorFallback': False,
    'colorlessObjects': [],
    'notes': [],
    'colorParseFailed': False
}

# Certain FreeCAD container/helper types should never be exported because they
# either duplicate child solids (App::Part/App::Link) or represent construction
# geometry (origins, reference axes/planes, etc.). Skipping them early prevents
# phantom meshes further down the pipeline.
SKIP_TYPE_IDS = {
    'App::Link',
}
SKIP_TYPE_PREFIXES = (
    'App::Origin',
    'App::Line',
    'App::Plane',
    'App::CoordinateSystem',
    'App::Annotation',
)


def _load_exclude_label_patterns() -> set:
    """Collect label substrings that should be ignored during export.

    Order of precedence:
      1. Environment variable STEP_EXCLUDE_LABELS (comma separated list)
      2. JSON file referenced by STEP_EXCLUDE_FILE
      3. Optional default JSON next to this script (step_exclude_labels.json)
    """


def _get_global_placement(obj):
    """Return the accumulated placement for an object, including parent containers."""
    try:
        if hasattr(obj, 'getGlobalPlacement'):
            placement = obj.getGlobalPlacement()
            if placement:
                return placement
    except Exception as err:  # pragma: no cover - best-effort diagnostic
        label = getattr(obj, 'Label', '<unnamed>')
        logger.debug(f"  Global placement lookup failed for {label}: {err}")
    return getattr(obj, 'Placement', None)


def _build_object_path(obj):
    """Collect human-readable path from root App::Part containers down to obj."""
    path_segments = []
    current = obj
    visited = set()

    while current and current not in visited:
        visited.add(current)
        label = getattr(current, 'Label', None) or getattr(current, 'Name', 'Unnamed')
        path_segments.append(label)

        parents = getattr(current, 'InList', []) or []
        parent_part = None
        for parent in parents:
            type_id = getattr(parent, 'TypeId', '') or ''
            if type_id.startswith('App::Part'):
                parent_part = parent
                break
        current = parent_part

    if not path_segments:
        return ['Unnamed']

    return list(reversed(path_segments))


def _sanitize_path_segments(path_segments, fallback_prefix):
    sanitized = []
    for idx, segment in enumerate(path_segments):
        cleaned = segment.replace(' ', '_')
        cleaned = re.sub(r'[^0-9A-Za-z_]+', '_', cleaned)
        cleaned = cleaned.strip('_') or f"{fallback_prefix}_{idx}"
        sanitized.append(cleaned)
    return sanitized


def _normalize_rgb(value):
    if value is None:
        return None

    if hasattr(value, 'r') and hasattr(value, 'g') and hasattr(value, 'b'):
        try:
            return float(value.r), float(value.g), float(value.b)
        except Exception:
            pass

    if hasattr(value, 'Red') and hasattr(value, 'Green') and hasattr(value, 'Blue'):
        try:
            return float(value.Red), float(value.Green), float(value.Blue)
        except Exception:
            pass

    if hasattr(value, 'x') and hasattr(value, 'y') and hasattr(value, 'z'):
        try:
            return float(value.x), float(value.y), float(value.z)
        except Exception:
            pass

    seq = None
    try:
        seq = list(value)
    except TypeError:
        try:
            if hasattr(value, '__getitem__'):
                seq = [value[0], value[1], value[2]]
        except Exception:
            seq = None

    if not seq:
        return None

    comps = []
    for idx in range(min(3, len(seq))):
        try:
            comps.append(float(seq[idx]))
        except Exception:
            comps.append(0.0)

    if not comps or len(comps) < 3:
        return None

    max_comp = max(abs(c) for c in comps)
    if max_comp > 1.0 + 1e-4:
        comps = [c / 255.0 for c in comps]

    return comps[0], comps[1], comps[2]


def _is_default_rgb(rgb_tuple, default=(0.8, 0.8, 0.8), tol=1e-4):
    if not rgb_tuple or len(rgb_tuple) < 3:
        return True
    return all(abs(rgb_tuple[i] - default[i]) <= tol for i in range(3))


def _extract_view_color(obj):
    vo = getattr(obj, 'ViewObject', None)
    if not vo:
        return None

    label = getattr(obj, 'Label', '<unnamed>')

    try:
        diffuse = getattr(vo, 'DiffuseColor', None)
    except Exception:
        diffuse = None

    if not diffuse:
        try:
            diffuse = getattr(vo, 'DiffuseColors', None)
        except Exception:
            diffuse = None

    try:
        if diffuse:
            parsed = False
            try:
                for entry in diffuse:
                    color = _normalize_rgb(entry)
                    if color and not _is_default_rgb(color):
                        parsed = True
                        return color
                    if color:
                        parsed = True
            except Exception:
                pass
            try:
                color = _normalize_rgb(diffuse[0])
                if color and not _is_default_rgb(color):
                    parsed = True
                    return color
                if color:
                    parsed = True
            except Exception:
                pass
            if not parsed:
                logger.debug(f"  DiffuseColor present but no usable color for {label}: {type(diffuse)}")

        shape_color = getattr(vo, 'ShapeColor', None)
        if shape_color:
            color = _normalize_rgb(shape_color)
            if color and not _is_default_rgb(color):
                return color

        material = getattr(vo, 'Material', None)
        if material:
            for attr in ('DiffuseColor', 'Color', 'Diffuse'):
                if hasattr(material, attr):
                    color = _normalize_rgb(getattr(material, attr))
                    if color and not _is_default_rgb(color):
                        return color

        shape_mat = getattr(vo, 'ShapeMaterial', None)
        if shape_mat:
            for attr in ('DiffuseColor', 'Color', 'Diffuse'):
                if hasattr(shape_mat, attr):
                    color = _normalize_rgb(getattr(shape_mat, attr))
                    if color and not _is_default_rgb(color):
                        return color
    except Exception as err:
        logger.debug(f"  View color extraction failed for {label}: {err}")

    return None


def _map_colors_by_geometry(doc_objects, step_shape_colors, step_shape_names):
    """Map STEP colors to FreeCAD objects by comparing geometry (bounding boxes and names)"""
    logger.info("Mapping STEP colors by geometry comparison...")
    geometry_color_map = {}
    
    for obj in doc_objects:
        type_id = getattr(obj, 'TypeId', '') or ''
        if any(type_id.startswith(prefix) for prefix in SKIP_TYPE_PREFIXES) or type_id in SKIP_TYPE_IDS:
            continue
            
        if not hasattr(obj, 'Shape') or not obj.Shape:
            continue
            
        obj_label = getattr(obj, 'Label', '')
        if not obj_label:
            continue
        
        # Skip hidden reference objects
        skip_names = ['axis', 'plane', 'origin', 'X-axis', 'Y-axis', 'Z-axis', 'XY-plane', 'XZ-plane', 'YZ-plane']
        if any(skip_name.lower() in obj_label.lower() for skip_name in skip_names):
            continue
        
        # Try to match by name to STEP shape representation
        best_match_id = None
        best_match_score = 0
        
        for rep_id, rep_name in step_shape_names.items():
            if not rep_name:
                continue
                
            # Calculate match score (substring + component matching)
            score = 0
            if rep_name == obj_label:
                score = 100  # Perfect match
            elif rep_name in obj_label:
                score = 80
            elif obj_label in rep_name:
                score = 70
            else:
                # Check for common parts (split by _ or -)
                rep_parts = set(rep_name.replace('-', '_').split('_'))
                obj_parts = set(obj_label.replace('-', '_').split('_'))
                common = rep_parts & obj_parts
                if common:
                    score = len(common) * 10
            
            if score > best_match_score:
                best_match_score = score
                best_match_id = rep_id
        
        # If we found a match, assign the color
        if best_match_id and best_match_id in step_shape_colors:
            rgb = step_shape_colors[best_match_id]
            geometry_color_map[obj_label] = (rgb[0], rgb[1], rgb[2], 1.0)
            logger.debug(f"  ✓ Matched '{obj_label}' to STEP shape (score {best_match_score}): RGB({rgb[0]:.3f}, {rgb[1]:.3f}, {rgb[2]:.3f})")
            
            # Also map child solids if this is a compound
            if hasattr(obj.Shape, 'Solids') and len(obj.Shape.Solids) > 1:
                for j in range(len(obj.Shape.Solids)):
                    solid_key = f"{obj_label}_Solid{j+1}"
                    geometry_color_map[solid_key] = (rgb[0], rgb[1], rgb[2], 1.0)
                    logger.debug(f"    → Propagated to {solid_key}")
    
    logger.info(f"  ✓ Mapped {len(geometry_color_map)} objects via geometry matching")
    return geometry_color_map


EXCLUDE_LABEL_PATTERNS = set()

logger.info("="*80)
logger.info("macOS FreeCAD STEP to OBJ Converter")
logger.info(f"Working directory: {os.getcwd()}")
logger.info(f"Log file: {log_file}")

# Read from environment variables
input_file = os.environ.get('STEP_INPUT_FILE')
output_file = os.environ.get('STEP_OUTPUT_FILE')  
tessellation_quality = float(os.environ.get('STEP_TESSELLATION', '0.1'))
mesh_gtin = (os.environ.get('STEP_GTIN') or '').strip()
mesh_article_number = (os.environ.get('STEP_ARTICLE_NUMBER') or '').strip()
color_export_mode = (os.environ.get('STEP_COLOR_EXPORT') or '').strip().lower()

logger.info(f"Input: {input_file}")
logger.info(f"Output: {output_file}")
logger.info(f"Quality: {tessellation_quality}")
if color_export_mode:
    logger.info(f"Color export mode requested: {color_export_mode}")

if not input_file or not output_file:
    logger.error("ERROR: Environment variables STEP_INPUT_FILE and STEP_OUTPUT_FILE must be set")
    sys.exit(1)

if not mesh_gtin or not mesh_article_number:
    filename_match = re.match(r'^(\d{8,14})_(.+)$', Path(input_file).stem)
    if filename_match:
        mesh_gtin = mesh_gtin or filename_match.group(1)
        mesh_article_number = mesh_article_number or filename_match.group(2)

mesh_gtin = re.sub(r'[^0-9A-Za-z.-]+', '_', mesh_gtin).strip('_') or 'KeineEAN'
mesh_article_number = re.sub(r'[^0-9A-Za-z.-]+', '_', mesh_article_number).strip('_') or 'KeineArtikelnummer'


def _extract_drawing_number(path_segments):
    for segment in reversed(path_segments):
        match = re.search(r'(?<!\d)(\d{2}-\d{5})(?!\d)', str(segment))
        if match:
            return match.group(1)
    return 'KeineZeichnungsnummer'


def _read_step_component_drawing_numbers(step_file_path):
    """Return component drawing numbers in their declared STEP assembly order."""
    try:
        with open(step_file_path, 'r', encoding='utf-8', errors='ignore') as step_file:
            content = step_file.read()
    except OSError as error:
        logger.warning(f"Unable to read STEP component structure: {error}")
        return []

    products = {
        int(match.group(1)): match.group(2)
        for match in re.finditer(r"#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'", content)
    }
    formations = {
        int(match.group(1)): int(match.group(2))
        for match in re.finditer(r"#(\d+)\s*=\s*PRODUCT_DEFINITION_FORMATION[^(]*\([^,]*,\s*'[^']*',\s*#(\d+)", content, re.DOTALL)
    }
    definitions = {
        int(match.group(1)): int(match.group(2))
        for match in re.finditer(r"#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\([^,]*,\s*'[^']*',\s*#(\d+)", content, re.DOTALL)
    }

    drawing_numbers = []
    for occurrence in re.finditer(r"NEXT_ASSEMBLY_USAGE_OCCURRENCE\s*\([^;]*?;", content, re.DOTALL):
        references = [int(ref) for ref in re.findall(r"#(\d+)", occurrence.group(0))]
        if not references:
            continue
        product_name = products.get(formations.get(definitions.get(references[-1])))
        drawing_number = _extract_drawing_number([product_name]) if product_name else None
        if drawing_number:
            drawing_numbers.append(drawing_number)

    return drawing_numbers

if color_export_mode in {'ply', 'color', 'true'}:
    try:
        from freecad_color_export import export_step_to_ply
    except Exception as color_exc:  # pragma: no cover - optional dependency
        logger.error("Unable to import freecad_color_export module: %s", color_exc)
        logger.error("Continuing with legacy OBJ exporter")
    else:
        os.environ.setdefault('STEP_LOG_FILE', log_file)
        target_path = output_file if output_file.lower().endswith('.ply') else output_file.replace('.obj', '.ply')
        logger.info(f"Color export active – writing PLY to {target_path}")
        export_step_to_ply(input_file, target_path, tessellation_quality)
        logger.info("Color export completed successfully")
        sys.exit(0)

if not os.path.exists(input_file):
    logger.error(f"ERROR: Input file does not exist: {input_file}")
    sys.exit(1)

# STEP file validation and diagnostics
try:
    file_size = os.path.getsize(input_file)
    logger.info(f"STEP file size: {file_size:,} bytes ({file_size/1024:.2f} KB)")
    
    if file_size == 0:
        logger.error("ERROR: STEP file is empty (0 bytes)")
        sys.exit(1)
    
    # Detect STEP format by reading header
    with open(input_file, 'r', encoding='utf-8', errors='ignore') as f:
        header = f.read(500)
        logger.debug(f"STEP file header (first 500 chars):\n{header[:500]}")
        
except Exception as e:
    logger.error(f"Error validating STEP file: {e}")
    sys.exit(1)


def parse_step_colors(step_file_path):
    """
    Parse STEP file to extract COLOUR_RGB definitions and STYLED_ITEM mappings.
    Returns a dictionary mapping entity IDs to RGB color tuples.
    
    STEP color structure:
    #ID = COLOUR_RGB ('', R, G, B);
    #ID = FILL_AREA_STYLE_COLOUR ('', #COLOR_ID);
    #ID = FILL_AREA_STYLE (#STYLE_ID);
    #ID = SURFACE_STYLE_FILL_AREA (#FILL_STYLE_ID);
    #ID = SURFACE_SIDE_STYLE ('', (#SURFACE_STYLE_ID));
    #ID = SURFACE_STYLE_USAGE (.BOTH., #SIDE_STYLE_ID);
    #ID = PRESENTATION_STYLE_ASSIGNMENT ((#STYLE_USAGE_ID));
    #ID = STYLED_ITEM ('', (#PRESENTATION_ID), #SHAPE_REP_ID);
    """
    global status_payload
    logger.info("Parsing STEP file for color definitions...")
    
    color_registry = {}  # {entity_id: (r, g, b)}
    fill_area_style_color = {}  # {style_id: color_id}
    fill_area_style = {}  # {fas_id: style_color_id}
    surface_style_fill_area = {}  # {ssfa_id: fill_area_style_id}
    surface_side_style = {}  # {sss_id: [surface_style_ids]}
    surface_style_usage = {}  # {ssu_id: side_style_id}
    surface_style_shading = {}  # {sss_id: color_ref_id}
    surface_style_rendering = {}  # {ssr_id: [color_ref_ids]}
    surface_colour = {}  # {surface_colour_id: color_ref_id}
    presentation_style_assignment = {}  # {psa_id: [style_usage_ids]}
    styled_items = {}  # {shape_rep_id: [presentation_ids]}
    
    shape_representations = {}  # {rep_id: product_name}
    shape_geometries = {}  # {rep_id: [geometry_ids]} - maps SHAPE_REP to contained geometry
    
    # PRODUCT hierarchy mappings
    products = {}  # {product_id: product_name}
    product_def_formations = {}  # {formation_id: product_id}
    product_definitions = {}  # {definition_id: formation_id}
    product_def_shapes = {}  # {shape_id: definition_id}
    shape_def_reps = {}  # {shape_rep_id: product_def_shape_id}
    
    # Regex patterns for STEP entities (handle British/US spelling variants)
    colour_rgb_pattern = re.compile(r"#(\d+)\s*=\s*(?:COLOUR|COLOR)_RGB\s*\(\s*'[^']*'\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)")
    predefined_colour_pattern = re.compile(r"#(\d+)\s*=\s*DRAUGHTING_PRE_DEFINED_(?:COLOUR|COLOR)\s*\(\s*'([^']+)'\s*\)")
    fill_area_style_colour_pattern = re.compile(r"#(\d+)\s*=\s*FILL_AREA_STYLE_(?:COLOUR|COLOR)\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)")
    fill_area_style_pattern = re.compile(r"#(\d+)\s*=\s*FILL_AREA_STYLE\s*\(\s*'[^']*'\s*,\s*\(([^)]*)\)\s*\)")
    surface_style_fill_area_pattern = re.compile(r"#(\d+)\s*=\s*SURFACE_STYLE_FILL_AREA\s*\(\s*#(\d+)\s*\)")
    surface_side_style_pattern = re.compile(r"#(\d+)\s*=\s*SURFACE_SIDE_STYLE\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)")
    surface_style_usage_pattern = re.compile(r"#(\d+)\s*=\s*SURFACE_STYLE_USAGE\s*\([^,]+,\s*#(\d+)\s*\)")
    surface_style_shading_pattern = re.compile(r"#(\d+)\s*=\s*SURFACE_STYLE_SHADING\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)")
    surface_style_rendering_pattern = re.compile(r"#(\d+)\s*=\s*SURFACE_STYLE_RENDERING\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*\)")
    surface_colour_pattern = re.compile(r"#(\d+)\s*=\s*SURFACE_(?:COLOUR|COLOR)\s*\(\s*'[^']*'\s*,\s*#(\d+)\s*\)")
    presentation_style_assignment_pattern = re.compile(r"#(\d+)\s*=\s*PRESENTATION_STYLE_ASSIGNMENT\s*\(\s*\(([^)]+)\)\s*\)")
    styled_item_pattern = re.compile(r"#(\d+)\s*=\s*STYLED_ITEM\s*\(\s*'[^']*'\s*,\s*\(([^)]+)\)\s*,\s*#(\d+)\s*\)")
    
    # Parse PRODUCT hierarchy for name-to-color mapping
    product_pattern = re.compile(r"#(\d+)\s*=\s*PRODUCT\s*\(\s*'([^']*)'")
    product_def_formation_pattern = re.compile(r"#(\d+)\s*=\s*PRODUCT_DEFINITION_FORMATION[^(]*\([^,]*,\s*'[^']*',\s*#(\d+)")
    product_definition_pattern = re.compile(r"#(\d+)\s*=\s*PRODUCT_DEFINITION\s*\([^,]*,\s*'[^']*',\s*#(\d+)")
    product_def_shape_pattern = re.compile(r"#(\d+)\s*=\s*PRODUCT_DEFINITION_SHAPE\s*\([^,]*,\s*'[^']*',\s*#(\d+)\s*\)")
    shape_def_rep_pattern = re.compile(r"#(\d+)\s*=\s*SHAPE_DEFINITION_REPRESENTATION\s*\(\s*#(\d+)\s*,\s*#(\d+)\s*\)")
    shape_rep_pattern = re.compile(r"#(\d+)\s*=\s*(?:ADVANCED_BREP_SHAPE_REPRESENTATION|SHAPE_REPRESENTATION|MANIFOLD_SURFACE_SHAPE_REPRESENTATION)\s*\(\s*'([^']*)'[^,]*,\s*\(([^)]+)\)")
    manifold_solid_brep_pattern = re.compile(r"#(\d+)\s*=\s*MANIFOLD_SOLID_BREP\s*\(\s*'([^']*)'")
    
    try:
        with open(step_file_path, 'r', encoding='utf-8', errors='ignore') as f:
            logger.info(f"  Reading STEP file: {os.path.basename(step_file_path)}")
            
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                
                # Parse COLOUR_RGB
                match = colour_rgb_pattern.search(line)
                if match:
                    entity_id = int(match.group(1))
                    r, g, b = float(match.group(2)), float(match.group(3)), float(match.group(4))
                    color_registry[entity_id] = (r, g, b)
                    continue

                # Parse predefined draughting colours
                match = predefined_colour_pattern.search(line)
                if match:
                    entity_id = int(match.group(1))
                    name = match.group(2).upper()
                    predefined_lookup = {
                        'BLACK': (0.0, 0.0, 0.0),
                        'RED': (1.0, 0.0, 0.0),
                        'GREEN': (0.0, 1.0, 0.0),
                        'BLUE': (0.0, 0.0, 1.0),
                        'YELLOW': (1.0, 1.0, 0.0),
                        'MAGENTA': (1.0, 0.0, 1.0),
                        'CYAN': (0.0, 1.0, 1.0),
                        'WHITE': (1.0, 1.0, 1.0)
                    }
                    if name in predefined_lookup:
                        color_registry[entity_id] = predefined_lookup[name]
                    continue
                
                # Parse FILL_AREA_STYLE_COLOUR
                match = fill_area_style_colour_pattern.search(line)
                if match:
                    style_id = int(match.group(1))
                    color_id = int(match.group(2))
                    fill_area_style_color[style_id] = color_id
                    continue
                
                # Parse FILL_AREA_STYLE
                match = fill_area_style_pattern.search(line)
                if match:
                    fas_id = int(match.group(1))
                    refs = re.findall(r"#(\d+)", match.group(2))
                    if refs:
                        style_color_id = int(refs[0])
                        fill_area_style[fas_id] = style_color_id
                    continue
                
                # Parse SURFACE_STYLE_FILL_AREA
                match = surface_style_fill_area_pattern.search(line)
                if match:
                    ssfa_id = int(match.group(1))
                    fill_area_id = int(match.group(2))
                    surface_style_fill_area[ssfa_id] = fill_area_id
                    continue
                
                # Parse SURFACE_SIDE_STYLE
                match = surface_side_style_pattern.search(line)
                if match:
                    sss_id = int(match.group(1))
                    refs = [int(x.strip().strip('#')) for x in match.group(2).split(',') if '#' in x]
                    surface_side_style[sss_id] = refs
                    continue
                
                # Parse SURFACE_STYLE_USAGE
                match = surface_style_usage_pattern.search(line)
                if match:
                    ssu_id = int(match.group(1))
                    side_style_id = int(match.group(2))
                    surface_style_usage[ssu_id] = side_style_id
                    continue
                
                # Parse SURFACE_STYLE_SHADING
                match = surface_style_shading_pattern.search(line)
                if match:
                    sss_id = int(match.group(1))
                    color_ref_id = int(match.group(2))
                    surface_style_shading[sss_id] = color_ref_id
                    continue

                # Parse SURFACE_STYLE_RENDERING
                match = surface_style_rendering_pattern.search(line)
                if match:
                    ssr_id = int(match.group(1))
                    refs = [int(x.strip().strip('#')) for x in match.group(2).split(',') if '#' in x]
                    surface_style_rendering[ssr_id] = refs
                    continue

                # Parse SURFACE_COLOUR
                match = surface_colour_pattern.search(line)
                if match:
                    sc_id = int(match.group(1))
                    color_ref_id = int(match.group(2))
                    surface_colour[sc_id] = color_ref_id
                    continue

                # Parse PRESENTATION_STYLE_ASSIGNMENT
                match = presentation_style_assignment_pattern.search(line)
                if match:
                    psa_id = int(match.group(1))
                    refs = [int(x.strip().strip('#')) for x in match.group(2).split(',') if '#' in x]
                    presentation_style_assignment[psa_id] = refs
                    continue
                
                # Parse STYLED_ITEM (links presentation to shape)
                match = styled_item_pattern.search(line)
                if match:
                    styled_id = int(match.group(1))
                    presentation_ids = [int(x.strip().strip('#')) for x in match.group(2).split(',') if '#' in x]
                    shape_rep_id = int(match.group(3))
                    
                    if shape_rep_id not in styled_items:
                        styled_items[shape_rep_id] = []
                    styled_items[shape_rep_id].extend(presentation_ids)
                    continue
                
                # Parse shape representation names
                match = shape_rep_pattern.search(line)
                if match:
                    rep_id = int(match.group(1))
                    name = match.group(2)
                    geom_ids_str = match.group(3)
                    
                    # Store name if non-empty
                    if name:
                        shape_representations[rep_id] = name
                    
                    # Store geometry references
                    if geom_ids_str:
                        geom_ids = [int(x.strip().strip('#')) for x in geom_ids_str.split(',') if '#' in x]
                        if geom_ids:
                            shape_geometries[rep_id] = geom_ids
                    continue
                
                # Parse MANIFOLD_SOLID_BREP (simpler syntax: name, shell_id)
                match = manifold_solid_brep_pattern.search(line)
                if match:
                    rep_id = int(match.group(1))
                    name = match.group(2)
                    if name:
                        shape_representations[rep_id] = name
                    continue
                
                # Parse PRODUCT hierarchy
                match = product_pattern.search(line)
                if match:
                    products[int(match.group(1))] = match.group(2)
                    continue
                
                match = product_def_formation_pattern.search(line)
                if match:
                    product_def_formations[int(match.group(1))] = int(match.group(2))
                    continue
                
                match = product_definition_pattern.search(line)
                if match:
                    product_definitions[int(match.group(1))] = int(match.group(2))
                    continue
                
                match = product_def_shape_pattern.search(line)
                if match:
                    product_def_shapes[int(match.group(1))] = int(match.group(2))
                    continue
                
                match = shape_def_rep_pattern.search(line)
                if match:
                    shape_def_reps[int(match.group(3))] = int(match.group(2))
                    continue
        
        logger.info(f"  ✓ Parsed {len(color_registry)} COLOUR_RGB definitions")
        logger.info(f"  ✓ Found {len(styled_items)} STYLED_ITEM mappings")
        logger.info(f"  ✓ Found {len(shape_representations)} shape representations")
        logger.info(f"  ✓ Found {len(products)} PRODUCT entities")
        logger.info(f"  ✓ Found {len(surface_style_shading)} SURFACE_STYLE_SHADING entries")
        logger.info(f"  ✓ Found {len(surface_style_rendering)} SURFACE_STYLE_RENDERING entries")
        
        # Helper to resolve chained colour references
        def resolve_color_ref(color_ref_id):
            visited = set()
            current_id = color_ref_id
            while current_id and current_id not in visited:
                visited.add(current_id)

                if current_id in color_registry:
                    return color_registry[current_id]

                if current_id in surface_colour:
                    current_id = surface_colour[current_id]
                    continue

                if current_id in fill_area_style_color:
                    current_id = fill_area_style_color[current_id]
                    continue

                break

            return None

        # Build color map by tracing references
        shape_colors = {}  # {shape_rep_id: (r, g, b)}
        
        for shape_rep_id, presentation_ids in styled_items.items():
            for psa_id in presentation_ids:
                if psa_id in presentation_style_assignment:
                    for ssu_id in presentation_style_assignment[psa_id]:
                        if ssu_id in surface_style_usage:
                            sss_id = surface_style_usage[ssu_id]
                            if sss_id in surface_side_style:
                                for ssfa_id in surface_side_style[sss_id]:
                                    if ssfa_id in surface_style_fill_area:
                                        fas_id = surface_style_fill_area[ssfa_id]
                                        if fas_id in fill_area_style:
                                            fasc_id = fill_area_style[fas_id]
                                            if fasc_id in fill_area_style_color:
                                                color_id = fill_area_style_color[fasc_id]
                                                if color_id in color_registry:
                                                    rgb = color_registry[color_id]
                                                    shape_colors[shape_rep_id] = rgb
                                                    
                                                    name = shape_representations.get(shape_rep_id, f"#{shape_rep_id}")
                                                    logger.debug(f"    Traced color for '{name}': RGB({rgb[0]:.3f}, {rgb[1]:.3f}, {rgb[2]:.3f})")
                            else:
                                rgb = None

                                if sss_id in surface_style_shading:
                                    rgb = resolve_color_ref(surface_style_shading[sss_id])

                                if rgb is None and sss_id in surface_style_rendering:
                                    for ref_id in surface_style_rendering[sss_id]:
                                        rgb = resolve_color_ref(ref_id)
                                        if rgb:
                                            break

                                if rgb:
                                    shape_colors[shape_rep_id] = rgb
                                    name = shape_representations.get(shape_rep_id, f"#{shape_rep_id}")
                                    logger.debug(f"    Traced shading color for '{name}': RGB({rgb[0]:.3f}, {rgb[1]:.3f}, {rgb[2]:.3f})")
        
        # Link colors from ADVANCED_BREP to named SHAPE_REPRESENTATION via shared geometry
        # Build geometry → colored shapes mapping (can have multiple colors per geometry!)
        geom_to_colored = {}  # {geom_id: [(colored_rep_id, color)]}
        for rep_id, geom_ids in shape_geometries.items():
            if rep_id in shape_colors:  # This is a colored ADVANCED_BREP
                color = shape_colors[rep_id]
                for geom_id in geom_ids:
                    if geom_id not in geom_to_colored:
                        geom_to_colored[geom_id] = []
                    # Avoid duplicates
                    if not any(c == color for _, c in geom_to_colored[geom_id]):
                        geom_to_colored[geom_id].append((rep_id, color))
        
        # Find named shapes sharing same geometry and copy colors
        # If multiple colors exist for same geometry, prefer based on name similarity
        colors_linked = 0
        for rep_id, geom_ids in shape_geometries.items():
            if rep_id in shape_representations and rep_id not in shape_colors:
                # This is a named SHAPE_REP without direct color
                target_name = shape_representations[rep_id]
                
                for geom_id in geom_ids:
                    if geom_id in geom_to_colored:
                        # Multiple colored shapes share this geometry
                        candidates = geom_to_colored[geom_id]
                        
                        # Score each candidate by name similarity and color preference
                        best_score = -1
                        colored_rep_id, color = candidates[0]  # default
                        
                        for cand_rep_id, cand_color in candidates:
                            score = 0
                            
                            # Prefer non-white/non-blue colors
                            is_white = cand_color[0] > 0.99 and cand_color[1] > 0.99 and cand_color[2] > 0.99
                            is_blue = cand_color[2] > 0.9 and cand_color[0] < 0.1 and cand_color[1] < 0.1
                            
                            if not is_white:
                                score += 100
                            if not is_blue:
                                score += 50
                            
                            # Name similarity bonus
                            cand_name = shape_representations.get(cand_rep_id, '')
                            if cand_name:
                                # Extract common tokens (e.g., "85-20" from both names)
                                target_tokens = set(target_name.replace('_', ' ').replace('-', ' ').split())
                                cand_tokens = set(cand_name.replace('_', ' ').replace('-', ' ').split())
                                common = target_tokens & cand_tokens
                                score += len(common) * 20
                            
                            if score > best_score:
                                best_score = score
                                colored_rep_id, color = cand_rep_id, cand_color
                        
                        shape_colors[rep_id] = color
                        colors_linked += 1
                        cand_name_str = shape_representations.get(colored_rep_id, f"#{colored_rep_id}")
                        logger.debug(f"    Linked color from '{cand_name_str}' to '{target_name}' via geometry #{geom_id}: RGB({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f}) [score={best_score}]")
                        break  # Only need one geometry match
        
        if colors_linked > 0:
            logger.info(f"  ✓ Linked {colors_linked} colors via geometry matching")
        
        # Second pass: Link colors by name similarity (for shapes without geometry match, or to override poor geometry matches)
        # This helps with MANIFOLD_SOLID_BREP and other internal shapes
        name_colors_linked = 0
        name_colors_overridden = 0
        
        logger.info(f"  Starting name-based color linking: {len(shape_representations)} total shapes, {len(shape_colors)} already have colors")
        
        for rep_id in list(shape_representations.keys()):
            if rep_id not in shape_representations:
                continue  # No name
            
            target_name = shape_representations[rep_id]
            if not target_name:
                continue
            
            # Extract tokens from target name (include both words AND numbers)
            target_name_clean = target_name.lower().replace('_', ' ').replace('-', ' ').replace('/', ' ')
            target_tokens = set(target_name_clean.split())
            # Also extract numeric tokens separately (e.g., "85", "20" from "85-20" or "gung85/20")
            target_numbers = set(re.findall(r'\d+', target_name))
            target_tokens.update(target_numbers)
            
            # Find best matching colored shape by name
            best_score = 0
            best_color = None
            best_source = None
            
            for colored_rep_id, color in shape_colors.items():
                if colored_rep_id == rep_id:
                    continue  # Don't match with self
                
                colored_name = shape_representations.get(colored_rep_id, '')
                if not colored_name:
                    continue
                
                # Extract tokens from colored shape name (include both words AND numbers)
                colored_name_clean = colored_name.lower().replace('_', ' ').replace('-', ' ').replace('/', ' ')
                colored_tokens = set(colored_name_clean.split())
                # Also extract numeric tokens separately
                colored_numbers = set(re.findall(r'\d+', colored_name))
                colored_tokens.update(colored_numbers)
                
                common_tokens = target_tokens & colored_tokens
                
                if len(common_tokens) > 0:
                    # Score based on common tokens
                    score = len(common_tokens) * 20
                    
                    # Bonus for numeric matches (like "85-20", "2700")
                    for token in common_tokens:
                        if any(c.isdigit() for c in token):
                            score += 30
                    
                    # Penalty for white/blue
                    is_white = color[0] > 0.99 and color[1] > 0.99 and color[2] > 0.99
                    is_blue = color[2] > 0.9 and color[0] < 0.1 and color[1] < 0.1
                    if is_white:
                        score -= 100
                    if is_blue:
                        score -= 50
                    
                    if score > best_score:
                        best_score = score
                        best_color = color
                        best_source = colored_name
            
            # Apply best match if score is good enough
            if best_score > 20:  # Minimum threshold
                if rep_id in shape_colors:
                    # Override existing color if new match is significantly better
                    old_color = shape_colors[rep_id]
                    old_is_blue = old_color[2] > 0.9 and old_color[0] < 0.1 and old_color[1] < 0.1
                    old_is_white = old_color[0] > 0.99 and old_color[1] > 0.99 and old_color[2] > 0.99
                    
                    # Override if old color is blue/white and new is better
                    if (old_is_blue or old_is_white) and best_score > 40:
                        shape_colors[rep_id] = best_color
                        name_colors_overridden += 1
                        logger.info(f"    OVERRIDE: '{best_source}' → '{target_name}': RGB({best_color[0]:.3f}, {best_color[1]:.3f}, {best_color[2]:.3f}) [score={best_score}] (was blue/white)")
                else:
                    shape_colors[rep_id] = best_color
                    name_colors_linked += 1
                    logger.info(f"    Linked color by name from '{best_source}' to '{target_name}': RGB({best_color[0]:.3f}, {best_color[1]:.3f}, {best_color[2]:.3f}) [score={best_score}]")
        
        if name_colors_linked > 0:
            logger.info(f"  ✓ Linked {name_colors_linked} colors via name matching")
        if name_colors_overridden > 0:
            logger.info(f"  ✓ Overrode {name_colors_overridden} poor geometry matches with name-based colors")
        
        # Build PRODUCT → SHAPE_REP → Color mapping via full hierarchy
        # This handles cases where PRODUCT has multiple SHAPE_REPs (named + colored)
        product_to_shapes = {}  # {product_id: [shape_rep_ids]}
        
        logger.debug(f"  Building PRODUCT→SHAPE hierarchy: {len(shape_def_reps)} SHAPE_DEF_REPs, {len(product_def_shapes)} PRODUCT_DEF_SHAPEs")
        
        try:
            for shape_rep_id, prod_def_shape_id in shape_def_reps.items():
                if prod_def_shape_id in product_def_shapes:
                    definition_id = product_def_shapes[prod_def_shape_id]
                    if definition_id in product_definitions:
                        formation_id = product_definitions[definition_id]
                        if formation_id in product_def_formations:
                            product_id = product_def_formations[formation_id]
                            if product_id not in product_to_shapes:
                                product_to_shapes[product_id] = []
                            product_to_shapes[product_id].append(shape_rep_id)
        except Exception as e:
            logger.error(f"  ✗ Error building PRODUCT hierarchy: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        # For each PRODUCT, find colored and named SHAPE_REPs and link them
        product_colors_linked = 0
        try:
            for product_id, shape_rep_ids in product_to_shapes.items():
                product_name = products.get(product_id, f"#{product_id}")
                
                # Find colored SHAPE_REP (usually ADVANCED_BREP/MANIFOLD_SOLID_BREP)
                colored_rep_id = None
                for rep_id in shape_rep_ids:
                    if rep_id in shape_colors:
                        colored_rep_id = rep_id
                        break
                
                if colored_rep_id:
                    # Apply color to all SHAPE_REPs of this PRODUCT
                    color = shape_colors[colored_rep_id]
                    for rep_id in shape_rep_ids:
                        if rep_id not in shape_colors:
                            shape_colors[rep_id] = color
                            product_colors_linked += 1
                            rep_name = shape_representations.get(rep_id, f"#{rep_id}")
                            logger.debug(f"    Linked PRODUCT color to '{rep_name}': RGB({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f}) from '{product_name}'")
        except Exception as e:
            logger.error(f"  ✗ Error linking PRODUCT colors: {e}")
            import traceback
            logger.debug(traceback.format_exc())
        
        if product_colors_linked > 0:
            logger.info(f"  ✓ Linked {product_colors_linked} colors via PRODUCT hierarchy")
        
        logger.info(f"  ✓ Successfully traced colors for {len(shape_colors)} shapes")

        if not shape_colors:
            status_payload['colorFallback'] = True
            status_payload['notes'].append('Keine STEP-Farben im Datensatz gefunden – es werden Standardfarben genutzt.')

        # Log unique colors found
        unique_colors = set(shape_colors.values())
        logger.info(f"  Color palette ({len(unique_colors)} unique colors):")
        for color in sorted(unique_colors):
            count = sum(1 for c in shape_colors.values() if c == color)
            logger.info(f"    RGB({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f}) - used by {count} shapes")
        
        return shape_colors, shape_representations
        
    except Exception as e:
        logger.error(f"  ✗ Failed to parse STEP colors: {e}")
        status_payload['colorParseFailed'] = True
        status_payload['notes'].append(f"STEP-Farbinformationen konnten nicht gelesen werden: {e}")
        status_payload['colorFallback'] = True
        import traceback
        logger.debug(traceback.format_exc())
        return {}, {}


# Parse STEP file for colors before FreeCAD import
step_shape_colors, step_shape_names = parse_step_colors(input_file)

# Import FreeCAD modules
try:
    import FreeCAD
    import Import
    import Mesh
    import Part
    
    freecad_version = '.'.join(FreeCAD.Version()[:3])
    logger.info(f"✓ FreeCAD loaded successfully, version: {freecad_version}")
    logger.info(f"FreeCAD build: {FreeCAD.Version()[3] if len(FreeCAD.Version()) > 3 else 'Unknown'}")

    # Create new document  
    doc = FreeCAD.newDocument("StepConversion")
    logger.info("✓ Created FreeCAD document")
    
    # Import STEP file - use Part.insert instead of Import.insert
    logger.info("Starting STEP file import...")
    import_successful = False
    import_method = None
    imported_objects = []  # FIX: Track only objects from successful import
    
    try:
        # Method 1: Use Import.insert with color support
        logger.info("[Method 1/3] Trying Import.insert() with color support...")
        Import.insert(input_file, doc.Name)
        
        if len(doc.Objects) > 0:
            logger.info(f"  ✓ Import.insert completed, {len(doc.Objects)} objects created")
            import_successful = True
            import_method = "Import.insert()"
            imported_objects = list(doc.Objects)  # FIX: Snapshot imported objects
        else:
            raise Exception("Import.insert returned no objects")
            
    except Exception as e:
        logger.error(f"  ✗ Import.insert failed: {e}")
        logger.debug(f"  Exception type: {type(e).__name__}")
        
        try:
            # Method 2: Use Part.read as fallback
            logger.info("[Method 2/3] Trying Part.read()...")
            shape = Part.read(input_file)
            
            # Detailed shape diagnostics
            if shape:
                is_null = shape.isNull()
                logger.debug(f"  Shape object exists: True")
                logger.debug(f"  Shape.isNull(): {is_null}")
                
                if not is_null:
                    shape_type = shape.ShapeType if hasattr(shape, 'ShapeType') else 'Unknown'
                    logger.info(f"  ✓ SUCCESS! Loaded shape type: {shape_type}")
                    
                    # Detailed geometry information
                    try:
                        vertex_count = len(shape.Vertexes) if hasattr(shape, 'Vertexes') else 0
                        edge_count = len(shape.Edges) if hasattr(shape, 'Edges') else 0
                        face_count = len(shape.Faces) if hasattr(shape, 'Faces') else 0
                        solid_count = len(shape.Solids) if hasattr(shape, 'Solids') else 0
                        
                        logger.info(f"  Geometry details:")
                        logger.info(f"    - Vertexes: {vertex_count}")
                        logger.info(f"    - Edges: {edge_count}")
                        logger.info(f"    - Faces: {face_count}")
                        logger.info(f"    - Solids: {solid_count}")
                        
                        if face_count == 0 and solid_count == 0:
                            logger.warning("  ⚠ Shape has no faces or solids - may be invalid geometry")
                    except Exception as geo_error:
                        logger.warning(f"  Could not extract geometry details: {geo_error}")
                    
                    obj = doc.addObject("Part::Feature", "ImportedStep")
                    obj.Shape = shape
                    logger.info(f"  ✓ Created object: {obj.Label}")
                    import_successful = True
                    import_method = "Part.read()"
                    imported_objects = [obj]  # FIX: Track only the newly created object
                else:
                    logger.error(f"  ✗ FAILED: shape.isNull() returned True")
                    raise Exception("Part.read returned null shape")
            else:
                logger.error(f"  ✗ FAILED: Part.read() returned None")
                raise Exception("Part.read returned None")
        
        except Exception as e2:
            logger.error(f"  ✗ Part.read failed: {e2}")
                
        except Exception as e2:
            logger.error(f"  ✗ Part.read failed: {e2}")
            logger.debug(f"  Exception type: {type(e2).__name__}")
            
            try:
                # Method 3: Try importStep function if available
                logger.info("[Method 3/3] Trying Part.Shape.importStep()...")
                shapes = Part.Shape()
                shapes.importStep(input_file)
                
                if not shapes.isNull():
                    logger.info(f"  ✓ importStep succeeded, shape type: {shapes.ShapeType}")
                    obj = doc.addObject("Part::Feature", "ImportedStep")
                    obj.Shape = shapes
                    logger.info(f"  ✓ Created object from importStep: {obj.Label}")
                    import_successful = True
                    import_method = "Part.Shape.importStep()"
                    imported_objects = [obj]  # FIX: Track only the newly created object
                else:
                    logger.error(f"  ✗ importStep returned null shape")
            except Exception as e3:
                logger.error(f"  ✗ importStep failed: {e3}")
                logger.debug(f"  Exception type: {type(e3).__name__}")
    
    if import_successful:
        logger.info(f"✓ Import successful using: {import_method}")
    else:
        logger.error(f"✗ All three import methods failed")
    
    # Refresh document and ensure colors are loaded
    logger.info("Recomputing document...")
    doc.recompute()
    
    # CRITICAL: Read and apply colors from STEP file
    # FreeCAD stores STEP colors but doesn't always apply them to ViewObject
    logger.info("Extracting colors from STEP file...")
    try:
        # Force GUI mode temporarily to enable color reading
        import FreeCADGui
        has_gui = True
        logger.info("  FreeCADGui available - colors should be loaded")
    except:
        has_gui = False
        logger.warning("  FreeCADGui not available - colors may not be fully loaded")
    
    # Apply colors to objects if they exist in the STEP data
    for obj in doc.Objects:
        if hasattr(obj, 'Shape') and obj.Shape:
            try:
                # Check if object has color information
                if hasattr(obj, 'ViewObject'):
                    vo = obj.ViewObject
                    # Ensure ViewObject is initialized
                    if hasattr(vo, 'ShapeColor'):
                        color = vo.ShapeColor
                        if color != (0.8, 0.8, 0.8):  # Not default gray
                            logger.info(f"  ✓ Object '{obj.Label}' has STEP color: RGB({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f})")
            except Exception as color_check:
                pass
    
    # Get imported objects - FIX: Use only objects from successful import to avoid duplicates
    objects = imported_objects if imported_objects else doc.Objects
    logger.info(f"Document contains {len(objects)} objects after import (from {import_method})")
    
    # Debug: List all objects with details
    if objects:
        logger.info("Object inventory:")
        for i, obj in enumerate(objects):
            obj_type = obj.TypeId if hasattr(obj, 'TypeId') else 'Unknown'
            has_shape = hasattr(obj, 'Shape') and obj.Shape and not obj.Shape.isNull()
            logger.info(f"  [{i+1}] {obj.Label} (Type: {obj_type}, Has valid shape: {has_shape})")
            
            if has_shape:
                try:
                    shape = obj.Shape
                    logger.debug(f"      Shape type: {shape.ShapeType}")
                    logger.debug(f"      Faces: {len(shape.Faces) if hasattr(shape, 'Faces') else 'N/A'}")
                except Exception as shape_error:
                    logger.warning(f"      Could not read shape details: {shape_error}")
    
    if not objects:
        logger.error("✗ ERROR: No objects found in STEP file after import")
        logger.info("Document diagnostics:")
        logger.info(f"  Document name: {doc.Name}")
        logger.info(f"  Objects count: {len(doc.Objects)}")
        logger.info(f"  Root objects: {len(doc.RootObjects) if hasattr(doc, 'RootObjects') else 'N/A'}")
        
        # Try to inspect the STEP file directly as last resort
        try:
            logger.info("[Fallback] Attempting direct STEP inspection...")
            import Part
            shape = Part.read(input_file)
            if shape and not shape.isNull():
                logger.info(f"  ✓ Direct read succeeded! Shape type: {shape.ShapeType}")
                logger.info(f"  Has solids: {len(shape.Solids) if hasattr(shape, 'Solids') else 'N/A'}")
                logger.info(f"  Has faces: {len(shape.Faces) if hasattr(shape, 'Faces') else 'N/A'}")
                
                # Create object from shape
                obj = doc.addObject("Part::Feature", "DirectImport")
                obj.Shape = shape
                objects = doc.Objects
                logger.info(f"  ✓ Created object from direct import, now have {len(objects)} objects")
            else:
                logger.error("  ✗ Direct read returned null shape")
        except Exception as e:
            logger.error(f"  ✗ Direct inspection failed: {e}")
            logger.debug(f"  Exception type: {type(e).__name__}")
            import traceback
            logger.debug(traceback.format_exc())
        
        if not doc.Objects:
            logger.error("FATAL: No objects could be imported from STEP file")
            logger.error("Possible causes:")
            logger.error("  1. STEP file is corrupted or invalid")
            logger.error("  2. STEP format version not supported by FreeCAD")
            logger.error("  3. File contains only metadata without 3D geometry")
            logger.error("  4. FreeCAD installation is missing STEP import libraries")
            FreeCAD.closeDocument("StepConversion")
            sys.exit(1)
    
    # Process objects separately to preserve object boundaries and colors
    obj_data = []  # List of (object_name, vertices, faces, color)
    drawing_number_counts = defaultdict(int)
    total_vertices = 0
    total_faces = 0
    materials = {}  # Dictionary of material_name: (r, g, b, a)
    
    # CRITICAL: Extract individual solids from compound shapes
    # STEP files often import as a single compound containing multiple solids
    shapes_to_process = []
    
    for i, obj in enumerate(objects):
        type_id = getattr(obj, 'TypeId', '') or ''

        if any(type_id.startswith(prefix) for prefix in SKIP_TYPE_PREFIXES):
            logger.debug(f"  ⊘ Skipping helper/container object: {obj.Label} (Type: {type_id})")
            continue

        if type_id in SKIP_TYPE_IDS:
            logger.debug(f"  ⊘ Skipping helper/container object: {obj.Label} (Type: {type_id})")
            continue

        if type_id == 'App::Part':
            group_children = getattr(obj, 'Group', []) or []
            child_has_geometry = any(
                getattr(child, 'Shape', None) and hasattr(child.Shape, 'isNull') and not child.Shape.isNull()
                for child in group_children
            )

            shape_attr = getattr(obj, 'Shape', None)
            if not shape_attr or not hasattr(shape_attr, 'isNull') or shape_attr.isNull():
                logger.debug(f"  ⊘ Skipping empty App::Part container: {obj.Label}")
                continue

            if child_has_geometry:
                logger.debug(f"  ⊘ Skipping App::Part container with child geometry: {obj.Label}")
                continue

        if hasattr(obj, 'Shape') and obj.Shape:
            global_placement = _get_global_placement(obj)
            object_path = _build_object_path(obj)

            try:
                local_place = getattr(obj, 'Placement', None)
                if global_placement and local_place and (
                    global_placement.Base != local_place.Base or
                    global_placement.Rotation.Q != local_place.Rotation.Q
                ):
                    gp = global_placement
                    yaw, pitch, roll = gp.Rotation.toEulerAngles("ZYX")
                    logger.debug(
                        "  Global placement → base=(%.3f, %.3f, %.3f) mm, rot_z_y_x=(%.3f°, %.3f°, %.3f°)"
                        % (gp.Base.x, gp.Base.y, gp.Base.z, yaw, pitch, roll)
                    )
            except Exception as global_log_err:
                logger.debug(f"  Global placement logging failed for {obj.Label}: {global_log_err}")

            # CRITICAL: Skip hidden reference objects (axes, planes, etc.)
            # These are helper objects and should not be exported
            skip_names = ['axis', 'plane', 'origin', 'X-axis', 'Y-axis', 'Z-axis', 'XY-plane', 'XZ-plane', 'YZ-plane']
            if any(skip_name.lower() in obj.Label.lower() for skip_name in skip_names):
                logger.debug(f"  ⊘ Skipping hidden reference object: {obj.Label}")
                continue
            
            # Check if object has Visibility property and is hidden
            if hasattr(obj, 'Visibility') and not obj.Visibility:
                logger.debug(f"  ⊘ Skipping invisible object: {obj.Label}")
                continue
            
            shape = obj.Shape
            path_str = " / ".join(object_path)
            logger.info(f"Analyzing object {i+1}: {obj.Label} (Path: {path_str})")
            logger.info(f"  Shape type: {shape.ShapeType}")

            try:
                placement = getattr(obj, 'Placement', None)
                if placement:
                    base = placement.Base
                    rot = placement.Rotation
                    yaw, pitch, roll = rot.toEulerAngles("ZYX")
                    logger.debug(
                        "  Placement → base=(%.3f, %.3f, %.3f) mm, rot_z_y_x=(%.3f°, %.3f°, %.3f°)"
                        % (base.x, base.y, base.z, yaw, pitch, roll)
                    )
            except Exception as placement_err:
                logger.debug(f"  Placement inspection failed: {placement_err}")

            try:
                bbox = shape.BoundBox
                logger.debug(
                    "  Bounding box → X[%.3f, %.3f] Y[%.3f, %.3f] Z[%.3f, %.3f] mm"
                    % (bbox.XMin, bbox.XMax, bbox.YMin, bbox.YMax, bbox.ZMin, bbox.ZMax)
                )
            except Exception as bbox_err:
                logger.debug(f"  Bounding box inspection failed: {bbox_err}")
            
            # Check if this is a compound/assembly with multiple solids
            if hasattr(shape, 'Solids') and len(shape.Solids) > 1:
                logger.info(f"  ✓ Found {len(shape.Solids)} solids in compound shape - splitting...")
                for j, solid in enumerate(shape.Solids):
                    solid_name = f"{obj.Label}_Solid{j+1}"
                    solid_path = object_path + [solid_name]
                    logger.info(f"    Solid {j+1}: {len(solid.Faces) if hasattr(solid, 'Faces') else 0} faces")
                    try:
                        bbox = solid.BoundBox
                        logger.debug(
                            "    Solid %d bounding box → X[%.3f, %.3f] Y[%.3f, %.3f] Z[%.3f, %.3f] mm"
                            % (j + 1, bbox.XMin, bbox.XMax, bbox.YMin, bbox.YMax, bbox.ZMin, bbox.ZMax)
                        )
                    except Exception:
                        pass
                    shapes_to_process.append({
                        'label': solid_name,
                        'export_path': solid_path,
                        'shape': solid,
                        'parent': obj,
                        'placement': global_placement
                    })
                # FIX: Do NOT add the compound shape itself - it's already split into individual solids
                logger.debug(f"  ⊘ Skipping compound parent (already split into {len(shape.Solids)} solids)")
            elif hasattr(shape, 'Shells') and len(shape.Shells) > 1:
                logger.info(f"  ✓ Found {len(shape.Shells)} shells - splitting...")
                for j, shell in enumerate(shape.Shells):
                    shell_name = f"{obj.Label}_Shell{j+1}"
                    shell_path = object_path + [shell_name]
                    logger.info(f"    Shell {j+1}: {len(shell.Faces) if hasattr(shell, 'Faces') else 0} faces")
                    try:
                        bbox = shell.BoundBox
                        logger.debug(
                            "    Shell %d bounding box → X[%.3f, %.3f] Y[%.3f, %.3f] Z[%.3f, %.3f] mm"
                            % (j + 1, bbox.XMin, bbox.XMax, bbox.YMin, bbox.YMax, bbox.ZMin, bbox.ZMax)
                        )
                    except Exception:
                        pass
                    shapes_to_process.append({
                        'label': shell_name,
                        'export_path': shell_path,
                        'shape': shell,
                        'parent': obj,
                        'placement': global_placement
                    })
                # FIX: Do NOT add the compound shape itself - it's already split into individual shells
                logger.debug(f"  ⊘ Skipping compound parent (already split into {len(shape.Shells)} shells)")
            else:
                # Single shape - process as-is (no splitting occurred)
                logger.info(f"  Single shape (no splitting needed)")
                shapes_to_process.append({
                    'label': obj.Label,
                    'export_path': object_path,
                    'shape': shape,
                    'parent': obj,
                    'placement': global_placement
                })
    
    logger.info(f"Total shapes to process: {len(shapes_to_process)}")
    step_component_drawing_numbers = _read_step_component_drawing_numbers(input_file)
    if len(step_component_drawing_numbers) == len(shapes_to_process):
        for shape_info, drawing_number in zip(shapes_to_process, step_component_drawing_numbers):
            shape_info['step_drawing_number'] = drawing_number
        logger.info(f"Using {len(step_component_drawing_numbers)} drawing numbers from STEP component structure")
    elif step_component_drawing_numbers:
        logger.warning(
            "STEP component count does not match export shape count "
            f"({len(step_component_drawing_numbers)} != {len(shapes_to_process)}); using FreeCAD labels as fallback"
        )
    
    # Use improved geometry-based color mapping
    step_colors = _map_colors_by_geometry(doc.Objects, step_shape_colors, step_shape_names)

    view_object_colors = {}
    logger.info("Collecting FreeCAD view colors for fallback...")
    for obj in doc.Objects:
        type_id = getattr(obj, 'TypeId', '') or ''
        if any(type_id.startswith(prefix) for prefix in SKIP_TYPE_PREFIXES) or type_id in SKIP_TYPE_IDS:
            continue
        label = getattr(obj, 'Label', None)
        if not label:
            continue
        # Skip helper names aligned with earlier logic
        skip_names = ['axis', 'plane', 'origin', 'X-axis', 'Y-axis', 'Z-axis', 'XY-plane', 'XZ-plane', 'YZ-plane']
        if any(skip_name.lower() in label.lower() for skip_name in skip_names):
            continue

        color = _extract_view_color(obj)
        if color and label not in view_object_colors:
            view_object_colors[label] = (color[0], color[1], color[2], 1.0)
            logger.debug(f"  ✓ View color for '{label}': RGB({color[0]:.3f}, {color[1]:.3f}, {color[2]:.3f})")

            shape = getattr(obj, 'Shape', None)
            if shape and hasattr(shape, 'Solids') and len(shape.Solids) > 1:
                for idx in range(len(shape.Solids)):
                    solid_key = f"{label}_Solid{idx+1}"
                    if solid_key not in view_object_colors:
                        view_object_colors[solid_key] = (color[0], color[1], color[2], 1.0)
                        logger.debug(f"    → Propagated view color to {solid_key}")

    logger.info(f"  ✓ Collected view colors for {len(view_object_colors)} objects")
    
    # Process each shape and apply colors
    for i, shape_info in enumerate(shapes_to_process):
        shape_label = shape_info['label']
        export_path = shape_info['export_path']
        shape = shape_info['shape']
        parent_obj = shape_info['parent']
        placement = shape_info.get('placement')
        display_name = " / ".join(export_path)

        logger.info(f"Processing shape {i+1}/{len(shapes_to_process)}: {display_name}")
        
        # Extract color from pre-analyzed step_colors dictionary
        obj_color = None
        
        # Priority 1: Check extracted STEP colors (from parsed STEP file)
        if shape_label in step_colors:
            obj_color = step_colors[shape_label]
            logger.info(f"  ✓ Using STEP color: RGB({obj_color[0]:.3f}, {obj_color[1]:.3f}, {obj_color[2]:.3f})")
        
        # Priority 2: Check parent object's extracted color
        elif hasattr(parent_obj, 'Label') and parent_obj.Label in step_colors:
            obj_color = step_colors[parent_obj.Label]
            logger.info(f"  ✓ Using parent STEP color: RGB({obj_color[0]:.3f}, {obj_color[1]:.3f}, {obj_color[2]:.3f})")

        # Priority 3: Use FreeCAD view colors captured from ViewObject
        elif shape_label in view_object_colors:
            obj_color = view_object_colors[shape_label]
            logger.info(f"  ✓ Using FreeCAD view color: RGB({obj_color[0]:.3f}, {obj_color[1]:.3f}, {obj_color[2]:.3f})")
        elif hasattr(parent_obj, 'Label') and parent_obj.Label in view_object_colors:
            obj_color = view_object_colors[parent_obj.Label]
            logger.info(f"  ✓ Using parent view color: RGB({obj_color[0]:.3f}, {obj_color[1]:.3f}, {obj_color[2]:.3f})")
        
        # Fallback: Use light gray/white as default (most objects in screenshot are white/light gray)
        if obj_color is None:
            obj_color = (0.9, 0.9, 0.9, 1.0)
            logger.info(f"  → Using default color: RGB(0.90, 0.90, 0.90) (no STEP color found)")
            status_payload['colorFallback'] = True
            status_payload['colorlessObjects'].append(shape_label)
        
        # Tessellate the shape
        try:
            logger.info(f"  Tessellating with quality {tessellation_quality}...")
            logger.debug(f"  Shape type: {shape.ShapeType}, isNull: {shape.isNull()}")

            shape_for_export = shape
            if placement:
                try:
                    candidate = shape.copy() if hasattr(shape, 'copy') else shape
                    candidate.Placement = placement
                    shape_for_export = candidate
                except Exception as placement_err:
                    logger.debug(f"  Applying global placement failed for {obj_name}: {placement_err}")
                    shape_for_export = shape

            try:
                bbox = shape_for_export.BoundBox
                logger.debug(
                    "  Shape bounding box (pre-tessellate) → X[%.3f, %.3f] Y[%.3f, %.3f] Z[%.3f, %.3f] mm"
                    % (bbox.XMin, bbox.XMax, bbox.YMin, bbox.YMax, bbox.ZMin, bbox.ZMax)
                )
            except Exception:
                pass
            mesh_data = shape_for_export.tessellate(tessellation_quality)

            if mesh_data and len(mesh_data) >= 2:
                vertices, faces = mesh_data[0], mesh_data[1]
                
                if vertices and faces:
                    drawing_number = shape_info.get('step_drawing_number') or _extract_drawing_number(export_path)
                    drawing_number_counts[drawing_number] += 1
                    safe_obj_name = f"{mesh_gtin}_{mesh_article_number}_{drawing_number}_{drawing_number_counts[drawing_number]}"
                    display_path = " / ".join(export_path)
                    obj_data.append({
                        'name': safe_obj_name,
                        'display_name': display_path,
                        'vertices': vertices,
                        'faces': faces,
                        'color': obj_color
                    })
                    
                    # Create material for this object
                    mat_name = f"material_{safe_obj_name}"
                    materials[mat_name] = obj_color
                    
                    total_vertices += len(vertices)
                    total_faces += len(faces)
                    logger.info(f"  ✓ Added {len(vertices)} vertices, {len(faces)} faces")
                else:
                    logger.warning(f"  ⚠ WARNING: Empty mesh data for {display_name}")
            else:
                logger.warning(f"  ⚠ WARNING: Could not tessellate {display_name}")
                
        except Exception as e:
            logger.error(f"  ✗ ERROR: Tessellation failed for {display_name}: {e}")
            logger.debug(f"  Exception type: {type(e).__name__}")
            continue
    
    if not obj_data:
        logger.error("✗ ERROR: No mesh data could be extracted from any objects")
        logger.error("All objects failed tessellation - this indicates:")
        logger.error("  - Invalid or degenerate geometry in STEP file")
        logger.error("  - Tessellation quality may be inappropriate for this model")
        FreeCAD.closeDocument("StepConversion")
        sys.exit(1)
    
    # Write MTL file with materials
    mtl_file = output_file.replace('.obj', '.mtl')
    logger.info(f"Writing MTL file with {len(materials)} materials...")
    
    with open(mtl_file, 'w') as f:
        f.write(f"# MTL file generated from {os.path.basename(input_file)}\n")
        f.write(f"# macOS FreeCAD STEP converter\n\n")
        
        for mat_name, color in materials.items():
            f.write(f"newmtl {mat_name}\n")
            f.write(f"Ka {color[0]:.6f} {color[1]:.6f} {color[2]:.6f}\n")  # Ambient
            f.write(f"Kd {color[0]:.6f} {color[1]:.6f} {color[2]:.6f}\n")  # Diffuse
            f.write(f"Ks 0.5 0.5 0.5\n")  # Specular
            f.write(f"Ns 96.0\n")  # Specular exponent
            f.write(f"d {color[3]:.6f}\n")  # Transparency (alpha)
            f.write(f"illum 2\n\n")  # Illumination model
    
    logger.info(f"✓ MTL file written: {mtl_file}")
    
    # Write OBJ file with separate objects and materials
    logger.info(f"Writing OBJ file with {len(obj_data)} objects, {total_vertices:,} vertices, {total_faces:,} faces...")
    
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    
    with open(output_file, 'w') as f:
        # Write header
        f.write(f"# OBJ file generated from {os.path.basename(input_file)}\n")
        f.write(f"# macOS FreeCAD STEP converter\n")
        f.write(f"# Objects: {len(obj_data)}\n")
        f.write(f"# Vertices: {total_vertices}\n")
        f.write(f"# Faces: {total_faces}\n")
        f.write(f"mtllib {os.path.basename(mtl_file)}\n\n")
        
        vertex_offset = 0
        
        for obj_info in obj_data:
            obj_name = obj_info['name']
            display_name = obj_info.get('display_name', obj_name)
            vertices = obj_info['vertices']
            faces = obj_info['faces']
            
            # Write object header
            f.write(f"# Object: {obj_name} ({len(vertices)} vertices, {len(faces)} faces)\n")
            f.write(f"# Path: {display_name}\n")
            f.write(f"o {obj_name}\n")
            f.write(f"g {obj_name}\n")
            
            # Write vertices for this object
            for vertex in vertices:
                f.write(f"v {vertex.x} {vertex.y} {vertex.z}\n")
            
            # Write material and faces for this object
            mat_name = f"material_{obj_name}"
            f.write(f"usemtl {mat_name}\n")
            
            for face in faces:
                face_indices = [idx + vertex_offset + 1 for idx in face]
                if len(face_indices) == 3:  # Triangle
                    f.write(f"f {face_indices[0]} {face_indices[1]} {face_indices[2]}\n")
                elif len(face_indices) == 4:  # Quad
                    f.write(f"f {face_indices[0]} {face_indices[1]} {face_indices[2]} {face_indices[3]}\n")
                elif len(face_indices) > 4:
                    # Fan triangulate n-gons so complex STEP faces are preserved.
                    for j in range(1, len(face_indices) - 1):
                        f.write(f"f {face_indices[0]} {face_indices[j]} {face_indices[j+1]}\n")
            
            f.write("\n")
            vertex_offset += len(vertices)
    
    output_size = os.path.getsize(output_file)
    mtl_size = os.path.getsize(mtl_file)
    logger.info("="*80)
    logger.info("✓ SUCCESS: STEP to OBJ conversion completed")
    logger.info(f"Output file: {output_file}")
    logger.info(f"Output size: {output_size:,} bytes ({output_size/1024:.2f} KB)")
    logger.info(f"MTL file: {mtl_file}")
    logger.info(f"MTL size: {mtl_size:,} bytes ({mtl_size/1024:.2f} KB)")
    logger.info(f"Total objects: {len(obj_data)}")
    logger.info(f"Total vertices: {total_vertices:,}")
    logger.info(f"Total faces: {total_faces:,}")
    logger.info(f"Materials: {len(materials)}")
    logger.info("="*80)

    if status_path:
        try:
            status_payload['colorlessObjects'] = sorted(set(status_payload['colorlessObjects']))
            with open(status_path, 'w', encoding='utf-8') as status_file:
                json.dump(status_payload, status_file, indent=2)
            logger.info(f"STEP status written to {status_path}")
        except Exception as status_error:
            logger.warning(f"Unable to write STEP status file: {status_error}")
    
    # Close document
    FreeCAD.closeDocument("StepConversion")
    logger.info("Cleaned up FreeCAD document")

except ImportError as e:
    logger.error(f"✗ ERROR: FreeCAD modules not available: {e}")
    logger.error("Make sure FreeCAD is installed in /Applications/FreeCAD.app")
    import traceback
    logger.error(traceback.format_exc())
    if status_path:
        try:
            status_payload['error'] = str(e)
            status_payload['colorFallback'] = True
            with open(status_path, 'w', encoding='utf-8') as status_file:
                json.dump(status_payload, status_file, indent=2)
        except Exception:
            pass
    sys.exit(1)
except Exception as e:
    logger.error(f"✗ ERROR: Conversion failed: {e}")
    logger.error(f"Exception type: {type(e).__name__}")
    import traceback
    logger.error(traceback.format_exc())
    if status_path:
        try:
            status_payload['error'] = str(e)
            status_payload['colorFallback'] = True
            with open(status_path, 'w', encoding='utf-8') as status_file:
                json.dump(status_payload, status_file, indent=2)
        except Exception:
            pass
    sys.exit(1)