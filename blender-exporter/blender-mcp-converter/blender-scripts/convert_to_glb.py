import bpy
import bmesh
import os
import sys
import argparse
import json
import re
import shlex
import subprocess
import tempfile
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import math
import mathutils
import urllib.request
import urllib.error
import urllib.parse
import colorsys

# Add the AI material module to the path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from ai_material import AIMateriaTeleRecognizer
    AI_AVAILABLE = True
except ImportError:
    print("AI material recognition not available")
    AI_AVAILABLE = False

try:
    from step_converter import StepToObjConverter, FREECAD_AVAILABLE
    STEP_CONVERTER_AVAILABLE = FREECAD_AVAILABLE
    if STEP_CONVERTER_AVAILABLE:
        print("✅ STEP converter available")
    else:
        print("⚠️ STEP converter unavailable - FreeCAD not found")
except ImportError:
    print("STEP converter not available - install FreeCAD: pip install FreeCAD")
    STEP_CONVERTER_AVAILABLE = False


class BlenderOBJToGLBConverter:
    """
    Converts OBJ/MTL models to GLB format with texture embedding and material optimization
    """
    
    def __init__(self):
        self.ai_recognizer = AIMateriaTeleRecognizer() if AI_AVAILABLE else None
        self.conversion_logs = []
        self.label_metrics = []  # Sammle Metriken pro Objekt für Auswertung
        self.mcp_api_url = os.environ.get('MCP_API_URL', 'http://localhost:8001')
        
        # === AI Metrics Tracking ===
        self.ai_metrics = {
            "totalMeshes": 0,
            "aiOverrides": 0,
            "inputTokens": 0,
            "outputTokens": 0,
            "apiCalls": 0,
            "totalCost": 0.0,
            "processingTime": 0,
            "confidenceDistribution": {
                "0.0-0.5": 0,
                "0.5-0.7": 0,
                "0.7-0.85": 0,
                "0.85-0.95": 0,
                "0.95-1.0": 0
            }
        }
        
        # === Color Mapping Configuration ===
        self.color_mapping_enabled = os.environ.get('COLOR_MAPPING_ENABLED', 'true').lower() in ('true', '1', 'yes')
        self.color_mapping_threshold = float(os.environ.get('COLOR_MAPPING_THRESHOLD', '0.20'))
        self._standard_color_palette = None  # Lazy-loaded
        self.color_mapping_stats = {'mapped': 0, 'total': 0, 'mappings': {}}
        
        # === STEP Support ===
        self.step_converter_available = STEP_CONVERTER_AVAILABLE
        self.metal_keywords = [
            'metal', 'metall', 'stahl', 'steel', 'inox', 'edelstahl', 'aluminium', 'alu',
            'galv', 'verzinkt', 'zinc', 'zink', 'chrome', 'chrom', 'inoxidable'
        ]
        self.powder_keywords = [
            'powder', 'pulver', 'pulverbeschichtet', 'beschichtet', 'coated', 'ral',
            'lack', 'paint', 'struktur', 'strukturpulver', 'polyester'
        ]

        # Track the most recent import mode to adjust downstream processing (e.g. PLY vs OBJ)
        self.last_import_type = "unknown"
        self.last_import_color_attribute = None

        # MTL als Quelle der Wahrheit: Materialien mit map_Kd (PNG/JPG) dürfen nie metallisch sein
        self._mtl_materials_with_diffuse_texture = set()
        
    def _extract_mesh_features(self, obj, dims_cache, global_min_z, global_max_z, scene_height, post_count):
        """Extract geometric features from a mesh object for Claude AI classification.
        
        Args:
            obj: Blender mesh object
            dims_cache: Dictionary with precomputed bounding boxes
            global_min_z: Minimum Z coordinate in scene
            global_max_z: Maximum Z coordinate in scene
            scene_height: Total scene height
            post_count: Number of detected posts (Pfosten)
            
        Returns:
            Dictionary with mesh features compatible with MCP AI endpoint
        """
        min_v, max_v, (dx, dy, dz) = dims_cache[obj.name]
        
        # Position ratios
        base_ratio = (min_v.z - global_min_z) / max(scene_height, 1e-6)
        top_ratio = (global_max_z - max_v.z) / max(scene_height, 1e-6)
        center_z = (min_v.z + max_v.z) / 2.0
        center_ratio = (center_z - global_min_z) / max(scene_height, 1e-6)
        
        # Aspect ratios
        horiz = max(dx, dy)
        vertical_aspect = dz / max(horiz, 1e-6)
        horizontal_aspect = horiz / max(dz, 1e-6)
        
        # Color signature
        color = self._get_object_color_signature(obj)
        color_signature = list(color) if color else [128, 128, 128]
        
        # Materials
        materials = [mat.name for mat in obj.data.materials if mat] if obj.data.materials else []
        
        # Vertex/Face count
        mesh = obj.data
        vertex_count = len(mesh.vertices)
        face_count = len(mesh.polygons)
        
        # Volume approximation
        volume = dx * dy * dz
        
        return {
            "object_name": obj.name,
            "bbox": {
                "dx": float(dx),
                "dy": float(dy),
                "dz": float(dz)
            },
            "volume": float(volume),
            "aspect_ratios": {
                "vertical": float(vertical_aspect),
                "horizontal": float(horizontal_aspect)
            },
            "position": {
                "base_ratio": float(base_ratio),
                "top_ratio": float(top_ratio),
                "center_ratio": float(center_ratio)
            },
            "color_signature": color_signature,
            "materials": materials,
            "vertex_count": vertex_count,
            "face_count": face_count,
            "scene_height": float(scene_height),
            "post_count": post_count
        }
    
    def _call_claude_classification(self, mesh_features: Dict[str, Any], timeout: int = 60) -> Optional[Dict[str, Any]]:
        """Call MCP server AI classification endpoint.
        
        Args:
            mesh_features: Extracted mesh features
            timeout: Request timeout in seconds (default 60s for Claude API)
            
        Returns:
            Classification result dict or None on error
        """
        try:
            url = f"{self.mcp_api_url}/ai/classify-mesh"
            
            request_data = {
                "mesh_features": mesh_features,
                "preview_image": None  # Optional: könnte später Blender-Render sein
            }
            
            json_data = json.dumps(request_data).encode('utf-8')
            
            req = urllib.request.Request(
                url,
                data=json_data,
                headers={'Content-Type': 'application/json'},
                method='POST'
            )
            
            with urllib.request.urlopen(req, timeout=timeout) as response:
                result = json.loads(response.read().decode('utf-8'))
                
                if result.get('status') == 'success':
                    return result.get('classification')
                else:
                    self.log(f"Claude API Fehler: {result.get('error', 'Unknown')}", "WARNING")
                    return None
                    
        except urllib.error.URLError as e:
            self.log(f"Claude API nicht erreichbar ({self.mcp_api_url}): {str(e)}", "WARNING")
            return None
        except Exception as e:
            self.log(f"Claude-Klassifikation fehlgeschlagen: {str(e)}", "WARNING")
            return None
    
    def _merge_ai_and_heuristic_labels(self, ai_result: Optional[Dict], heuristic_label: str, confidence_threshold: float = 0.85) -> tuple:
        """Merge AI classification with heuristic fallback.
        
        Args:
            ai_result: Claude API classification result (can be None)
            heuristic_label: Heuristic classification label
            confidence_threshold: Minimum confidence to accept AI result
            
        Returns:
            Tuple of (final_label, confidence, source)
        """
        if not ai_result:
            return (heuristic_label, 0.5, "heuristic")
        
        ai_label = ai_result.get('classification', heuristic_label)
        ai_confidence = ai_result.get('confidence', 0.0)
        
        # KRITISCH: Wenn Heuristik "Teil" ist, IMMER AI-Ergebnis bevorzugen
        # "Teil" ist nur ein Fallback, keine echte Klassifikation
        if heuristic_label == "Teil" and ai_label != "Teil":
            # AI hat eine spezifische Klassifikation -> verwenden, auch bei niedriger Confidence
            return (ai_label, max(ai_confidence, 0.7), "ai")
        
        # High confidence AI result -> use AI
        if ai_confidence >= confidence_threshold:
            return (ai_label, ai_confidence, "ai")
        
        # Low confidence AI -> keep heuristic
        return (heuristic_label, 0.6, "heuristic_fallback")
        
    def log(self, message: str, level: str = "INFO"):
        """Add a log message"""
        log_entry = f"[{level}] {message}"
        self.conversion_logs.append(log_entry)
        print(log_entry)
    
    def clear_scene(self):
        """Clear the default Blender scene"""
        self.log("Clearing default scene")
        
        # Delete all objects
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        
        # Delete all materials
        for material in bpy.data.materials:
            bpy.data.materials.remove(material)
        
        # Delete all textures
        for texture in bpy.data.textures:
            bpy.data.textures.remove(texture)
        
        # Delete all images
        for image in bpy.data.images:
            bpy.data.images.remove(image)

    @staticmethod
    def _clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
        try:
            return max(lo, min(hi, float(value)))
        except Exception:
            return lo

    @staticmethod
    def _normalize_hex_color(value: Any) -> Optional[str]:
        if value is None:
            return None
        s = str(value).strip().upper()

        if not s:
            return None
        if s.startswith('0X'):
            s = s[2:]
        if s.startswith('#'):
            s = s[1:]
        if len(s) == 3 and re.fullmatch(r"[0-9A-F]{3}", s):
            s = ''.join([c + c for c in s])
        if not re.fullmatch(r"[0-9A-F]{6}", s):
            return None
        return f"#{s}"

    @staticmethod
    def _derive_gtin_candidate_from_stem(stem: str) -> Optional[str]:
        """Derive a GTIN candidate from a 3-6 digit filename stem.

        Business rule: If the input filename is 3 to 6 digits (e.g. "123", "1234"),
        try GTIN="200" + stem (e.g. "20012345") against the GTIN DB.
        """
        try:
            s = str(stem or '').strip()
        except Exception:
            return None
        if not s:
            return None
        if not s.isdigit():
            return None
        if len(s) not in (3, 4, 5, 6):
            return None
        return f"200{s}"

    @staticmethod
    def _derive_gtin_candidates_from_stem(stem: str) -> List[str]:
        """Derive GTIN candidates from a filename stem.

        Rules:
        - 3-5 digits: try "200" + stem
        - 6 digits: try "200" + stem, then additionally "4026212" + stem
        """
        primary = BlenderOBJToGLBConverter._derive_gtin_candidate_from_stem(stem)
        if not primary:
            return []

        try:
            s = str(stem or '').strip()
        except Exception:
            return [primary]

        if s.isdigit() and len(s) == 6:
            return [primary, f"4026212{s}"]

        return [primary]

    @staticmethod
    def _hex_to_rgb_float(hex_color: str) -> Optional[Tuple[float, float, float]]:
        norm = BlenderOBJToGLBConverter._normalize_hex_color(hex_color)
        if not norm:
            return None
        s = norm[1:]
        try:
            r = int(s[0:2], 16) / 255.0
            g = int(s[2:4], 16) / 255.0
            b = int(s[4:6], 16) / 255.0
            return (r, g, b)
        except Exception:
            return None

    @staticmethod
    def _srgb_channel_to_linear(value: float) -> float:
        c = BlenderOBJToGLBConverter._clamp(value)
        if c <= 0.04045:
            return c / 12.92
        return ((c + 0.055) / 1.055) ** 2.4

    @staticmethod
    def _srgb_rgb_to_linear(rgb: Tuple[float, float, float]) -> Tuple[float, float, float]:
        return (
            BlenderOBJToGLBConverter._srgb_channel_to_linear(rgb[0]),
            BlenderOBJToGLBConverter._srgb_channel_to_linear(rgb[1]),
            BlenderOBJToGLBConverter._srgb_channel_to_linear(rgb[2]),
        )

    @staticmethod
    def _rgb_float_to_hex(rgb: Tuple[float, float, float]) -> Optional[str]:
        try:
            r = int(round(BlenderOBJToGLBConverter._clamp(rgb[0]) * 255))
            g = int(round(BlenderOBJToGLBConverter._clamp(rgb[1]) * 255))
            b = int(round(BlenderOBJToGLBConverter._clamp(rgb[2]) * 255))
            return f"#{r:02X}{g:02X}{b:02X}"
        except Exception:
            return None

    def _coerce_kd_rgb(self, kd: Any) -> Optional[Tuple[float, float, float]]:
        if not isinstance(kd, (list, tuple)) or len(kd) < 3:
            return None
        try:
            r = float(kd[0])
            g = float(kd[1])
            b = float(kd[2])
        except Exception:
            return None
        mx = max(r, g, b)
        if mx > 1.0:
            r, g, b = r / 255.0, g / 255.0, b / 255.0
        return (self._clamp(r), self._clamp(g), self._clamp(b))

    def _parse_rgb_triplet(self, raw: Any) -> Optional[Tuple[float, float, float]]:
        """Parse 'r,g,b' (0..1 or 0..255) or hex '#rrggbb' into (r,g,b) floats."""
        if raw is None:
            return None
        s = str(raw).strip()
        if not s:
            return None
        if s.startswith('#'):
            rgb = self._hex_to_rgb_float(s)
            if rgb is None:
                return None
            return (self._clamp(rgb[0]), self._clamp(rgb[1]), self._clamp(rgb[2]))
        try:
            parts = [p.strip() for p in s.replace(';', ',').split(',') if p.strip()]
            if len(parts) < 3:
                return None
            r = float(parts[0])
            g = float(parts[1])
            b = float(parts[2])
            if max(r, g, b) > 1.0:
                r, g, b = (r / 255.0, g / 255.0, b / 255.0)
            return (self._clamp(r), self._clamp(g), self._clamp(b))
        except Exception:
            return None

    def _env_color(self, name: str, default: Tuple[float, float, float]) -> Tuple[float, float, float]:
        parsed = self._parse_rgb_triplet((os.environ.get(name) or '').strip())
        return parsed if parsed is not None else default

    def _palette_id_to_rgb(self, palette_id: Any) -> Optional[Tuple[float, float, float]]:
        """Resolve a palette id (e.g. 'orange') to a target RGB color.

        Matches the palette ids used by the STEP preprocessor snippet.
        """
        pid = (str(palette_id or '').strip() if palette_id is not None else '').strip()
        if not pid:
            return None
        pid = pid.lower()
        if pid == 'orange':
            # Target orange from uploaded spec: #E17E00 (HSV ~ 0.046 / 1.0 / 0.75), converted to linear RGB.
            return self._env_color('COLOR_ORANGE_RGB', self._srgb_rgb_to_linear((0.882, 0.494, 0.000)))
        if pid == 'zinc':
            return self._env_color('COLOR_ZINC_RGB', (0.706, 0.706, 0.706))
        if pid == 'zinc_glossy':
            return self._env_color('COLOR_ZINC_GLOSSY_RGB', (1.0, 1.0, 1.0))
        if pid == 'light_grey':
            return self._env_color('COLOR_LIGHTGREY_RGB', (0.859, 0.859, 0.859))
        if pid == 'enzian_blue':
            # RAL 5010 Enzianblau – einheitlich #138AFF (sRGB 0–1), wird beim Setzen in linear umgerechnet
            return self._env_color('COLOR_ENZIANBLAU_RGB', (0.07451, 0.54118, 1.0))
        if pid == 'plastic_grey':
            # Match-color (for recognition) can be COLOR_PLASTIC_GREY_RGB; render-color should be PLASTIC_RENDER_RGB.
            return self._env_color('PLASTIC_RENDER_RGB', (0.663, 0.663, 0.663))
        if pid == 'ral9005':
            return self._env_color('COLOR_RAL9005_RGB', (0.05, 0.05, 0.05))
        if pid == 'dark_grey':
            return self._env_color('COLOR_DUNKELGRAU_RGB', (0.129, 0.125, 0.118))
        return None
    
    @staticmethod
    def _hex_to_linear(hex_str: str) -> Tuple[float, float, float]:
        """Convert sRGB hex string (#RRGGBB) to linear RGB tuple (0-1)."""
        h = hex_str.lstrip('#')
        r, g, b = int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0
        return (
            BlenderOBJToGLBConverter._srgb_channel_to_linear(r),
            BlenderOBJToGLBConverter._srgb_channel_to_linear(g),
            BlenderOBJToGLBConverter._srgb_channel_to_linear(b),
        )

    def _get_standard_color_palette(self) -> Dict[str, Tuple[float, float, float]]:
        """Get the standard color palette derived from ralColors.json hex values.

        Single source of truth: src/data/ralColors.json.
        Additional non-RAL entries: Verzinkt (metallic gray), Plastikkappe (matte gray).
        Cached after first call for performance.
        """
        if self._standard_color_palette is not None:
            return self._standard_color_palette

        hl = self._hex_to_linear
        self._standard_color_palette = {
            'RAL 7035': hl('#F4F4F4'),   # Lichtgrau
            'RAL 7016': hl('#383E42'),   # Anthrazitgrau
            'RAL 5010': hl('#138AFF'),   # Enzianblau
            'RAL 1003': hl('#FFFF00'),   # Signalgelb
            'RAL 3000': hl('#AB2524'),   # Feuerrot
            'RAL 6011': hl('#587246'),   # Resedagruen
            'RAL 9005': hl('#0A0A0A'),   # Tiefschwarz
            'RAL 2001': hl('#FF5F00'),   # Rotorange
            'RAL 9010': hl('#F4F4F4'),   # Reinweiss
            'RAL 9007': hl('#8C8C8C'),   # Verzinkt (metallisch)
            'Plastikkappe': (0.67, 0.67, 0.67),
        }

        return self._standard_color_palette
    
    # Legacy palette names → new RAL-based keys (for backward compatibility)
    _PALETTE_ALIASES = {
        'Verzinkt glänzend metall':              'RAL 9007',
        'Verzinkt metall':                       'RAL 9007',
        'lichtgrau Pulverbeschichtet':           'RAL 7035',
        'rotorange Pulverbeschichtet':           'RAL 2001',
        'rotorange Pulverbeschichtet (dunkel)':  'RAL 2001',
        'gelb Pulverbeschichtet':                'RAL 1003',
        'tiefschwarz Pulverbeschichtet':         'RAL 9005',
        'anthrazit Pulverbeschichtet':           'RAL 7016',
        'enzianblau Pulverbeschichtet':          'RAL 5010',
        'enzianblau Pulverbeschichtet (dunkel)': 'RAL 5010',
    }

    def _get_canonical_color_name(self, color_name: str) -> str:
        """Map legacy palette names and aliases to canonical RAL keys."""
        return self._PALETTE_ALIASES.get(color_name, color_name)

    def _infer_canonical_color_from_material_name(self, material_name: Any) -> Optional[str]:
        """Infer canonical RAL color from material name hints (e.g. RAL codes, German names)."""
        if material_name is None:
            return None

        name = str(material_name).strip().lower()
        if not name:
            return None

        compact = re.sub(r"[^a-z0-9]", "", name)

        # Verzinkt (vor anderen Grautönen prüfen)
        if any(tok in compact for tok in ('verzinkt', 'vzk', 'zink', 'galvanized')):
            return 'RAL 9007'

        # Lichtgrau RAL 7035
        if any(tok in compact for tok in ('ral7035', 'lichtgrau', 'lightgrey', 'lightgray')):
            return 'RAL 7035'
        if re.search(r"ral\s*[-_]?7035", name) or re.search(r"ral7035", compact):
            return 'RAL 7035'

        # Blue family → RAL 5010
        blue_tokens = (
            'ral5010', 'enzianblau', 'enzianblue',
            'signalblau', 'stahlblau', 'himmelblau',
        )
        if any(tok in compact for tok in blue_tokens):
            return 'RAL 5010'
        if re.search(r"ral\s*[-_]?50\d{2}", name) or re.search(r"ral50\d{2}", compact):
            return 'RAL 5010'
        if ('blau' in name) or ('blue' in name):
            return 'RAL 5010'

        # Orange → RAL 2001
        orange_tokens = ('rotorange', 'ral2001', 'ral2000', 'ral2004', 'signalorange')
        if any(tok in compact for tok in orange_tokens) or 'orange' in name:
            return 'RAL 2001'

        # Feuerrot → RAL 3000
        if any(tok in compact for tok in ('ral3000', 'feuerrot')):
            return 'RAL 3000'

        # Gelb → RAL 1003
        yellow_tokens = ('ral1003', 'signalgelb', 'gelb', 'yellow')
        if any(tok in compact for tok in yellow_tokens):
            return 'RAL 1003'
        if re.search(r"ral\s*[-_]?1003", name) or re.search(r"ral1003", compact):
            return 'RAL 1003'

        # Gruen → RAL 6011
        if any(tok in compact for tok in ('ral6011', 'resedagruen', 'resedagrün', 'gruen', 'grün', 'green')):
            return 'RAL 6011'

        # Anthrazit → RAL 7016
        if any(tok in compact for tok in ('ral7016', 'anthrazit', 'anthracite')):
            return 'RAL 7016'

        # Schwarz: Kunststoff → Plastikkappe, sonst → RAL 9005
        if any(tok in compact for tok in ('plastik', 'kunststoff', 'kappe', 'plastic', 'cap')):
            return 'Plastikkappe'
        if any(tok in compact for tok in ('ral9005', 'tiefschwarz', 'schwarz', 'black')):
            return 'RAL 9005'

        # Reinweiss → RAL 9010
        if any(tok in compact for tok in ('ral9010', 'reinweiss', 'reinweiß', 'purewhite')):
            return 'RAL 9010'

        return None
    
    def _get_standard_material_properties(self, material_name: str) -> Optional[Dict[str, Any]]:
        """Get PBR material properties (metallic, roughness) for a palette entry.

        Resolves legacy names via _PALETTE_ALIASES before lookup.
        """
        canonical = self._PALETTE_ALIASES.get(material_name, material_name)

        properties = {
            'RAL 7035': {'metallic': 0.0, 'roughness': 0.30},   # Lichtgrau Pulverbeschichtet
            'RAL 7016': {'metallic': 0.0, 'roughness': 0.50},   # Anthrazitgrau
            'RAL 5010': {'metallic': 0.0, 'roughness': 0.50},   # Enzianblau
            'RAL 1003': {'metallic': 0.0, 'roughness': 0.55},   # Signalgelb
            'RAL 3000': {'metallic': 0.0, 'roughness': 0.55},   # Feuerrot
            'RAL 6011': {'metallic': 0.0, 'roughness': 0.55},   # Resedagruen
            'RAL 9005': {'metallic': 0.0, 'roughness': 0.55},   # Tiefschwarz
            'RAL 2001': {'metallic': 0.0, 'roughness': 0.60},   # Rotorange
            'RAL 9010': {'metallic': 0.0, 'roughness': 0.30},   # Reinweiss
            'RAL 9007': {'metallic': 0.35, 'roughness': 0.35},  # Verzinkt metallisch
            'Plastikkappe': {'metallic': 0.0, 'roughness': 0.65},
        }

        return properties.get(canonical)
    
    def _find_nearest_standard_color(self, rgb: Tuple[float, float, float], threshold: Optional[float] = None) -> Optional[Dict[str, Any]]:
        """Classify an RGB color (linear, 0-1) into the nearest RAL standard color.

        Uses HSV-based rules first (reliable for all brightness levels),
        then falls back to Euclidean distance for anything not caught by rules.
        """
        if threshold is None:
            threshold = self.color_mapping_threshold

        palette = self._get_standard_color_palette()
        if not palette:
            return None

        def _make_result(name):
            target = palette.get(name)
            if not target:
                return None
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb, target)))
            return {'name': name, 'rgb': target, 'distance': d}

        try:
            r, g, b = float(rgb[0]), float(rgb[1]), float(rgb[2])
            h, s, v = colorsys.rgb_to_hsv(r, g, b)

            # Absolute spread between channels -- very small = effectively achromatic.
            # Necessary because HSV saturation is relative (S = range/max) and
            # can report high saturation for near-black colors like RAL 7016 (0.04, 0.047, 0.054).
            rgb_range = max(r, g, b) - min(r, g, b)

            # --- 1) Achromatic: tiny channel spread → classify by brightness (linear) ---
            if rgb_range < 0.05:
                if v < 0.03:
                    return _make_result('RAL 9005')   # Tiefschwarz
                if v < 0.15:
                    return _make_result('RAL 7016')   # Anthrazitgrau
                if v > 0.65:
                    return _make_result('RAL 7035')   # Lichtgrau
                return _make_result('RAL 9007')       # Verzinkt (mittleres Grau)

            is_r_dominant = (r > g) and (r > b)

            # --- 2) Blau: H 180-265° (0.50-0.74), S > 0.25 ---
            if 0.50 <= h <= 0.74 and s >= 0.25:
                return _make_result('RAL 5010')

            # --- 3) Gelb: H 40-72° (0.11-0.20), S > 0.20, V > 0.10 ---
            if 0.11 <= h <= 0.20 and s >= 0.20 and v >= 0.10:
                return _make_result('RAL 1003')

            # --- 4) Gruen: H 80-165° (0.22-0.46), S > 0.15 ---
            if 0.22 <= h <= 0.46 and s >= 0.15:
                return _make_result('RAL 6011')

            # --- 5) Warme Farben (Orange vs Rot): H 0-40° oder 340-360° ---
            is_warm = (h <= 0.11) or (h >= 0.94)
            if is_warm and is_r_dominant and s >= 0.30:
                if (g - b) > 0.03:
                    return _make_result('RAL 2001')   # Rotorange
                else:
                    return _make_result('RAL 3000')   # Feuerrot

            # --- 6) Remaining low-saturation with wider spread ---
            if s < 0.20:
                if v < 0.03:
                    return _make_result('RAL 9005')
                if v < 0.15:
                    return _make_result('RAL 7016')
                if v > 0.65:
                    return _make_result('RAL 7035')
                return _make_result('RAL 9007')

        except Exception:
            pass

        # --- Fallback: Euclidean distance for edge cases ---
        best_name = None
        best_rgb = None
        best_distance = float('inf')

        for name, std_rgb in palette.items():
            if name == 'Plastikkappe':
                continue
            d = math.sqrt(sum((a - b) ** 2 for a, b in zip(rgb, std_rgb)))
            if d < best_distance:
                best_distance = d
                best_name = name
                best_rgb = std_rgb

        if best_distance <= threshold:
            return {'name': best_name, 'rgb': best_rgb, 'distance': best_distance}

        return None

    def _apply_color_overrides(self,
                              selected_colors: Optional[List[Any]] = None,
                              color_overrides: Optional[Dict[str, Any]] = None,
                              color_materials: Optional[Dict[str, Any]] = None,
                              apply_threshold_mapping: Optional[bool] = None,
                              default_color_override: bool = False) -> Dict[str, Any]:
        """Apply user-selected solid-color overrides to Principled Base Color.
        
        Args:
            apply_threshold_mapping: If True, apply color threshold mapping before overrides.
                                    If None, use global color_mapping_enabled setting.
            default_color_override: If True, am Ende alle Materialien auf metallic=0 setzen (auch wenn color_overrides leer).
        """

        def _safe_float01(v: Any) -> Optional[float]:
            try:
                f = float(v)
            except Exception:
                return None
            return self._clamp(f, 0.0, 1.0)

        selected_set = set()
        if isinstance(selected_colors, list):
            for c in selected_colors:
                norm = self._normalize_hex_color(c)
                if norm:
                    selected_set.add(norm)

        overrides_map: Dict[str, str] = {}
        if isinstance(color_overrides, dict):
            for k, v in color_overrides.items():
                src = self._normalize_hex_color(k)
                if not src:
                    continue
                # dst can be: hex color, palette id (e.g. 'orange'), or an object with paletteId.
                overrides_map[src] = v

        materials_map: Dict[str, Any] = {}
        if isinstance(color_materials, dict):
            for k, v in color_materials.items():
                src = self._normalize_hex_color(k)
                if src:
                    materials_map[src] = v

        # Determine if threshold mapping should be applied
        do_threshold_mapping = apply_threshold_mapping if apply_threshold_mapping is not None else self.color_mapping_enabled
        
        if not selected_set and not overrides_map and not materials_map and not do_threshold_mapping:
            return {
                "enabled": False,
                "materialsScanned": 0,
                "materialsChanged": 0,
                "sourceColorsMatched": 0,
                "principledParamsChanged": 0,
                "thresholdMapped": 0
            }

        scanned = 0
        changed = 0
        params_changed = 0
        threshold_mapped = 0
        matched_sources = set()

        for mat in bpy.data.materials:
            nodes = self._iter_principled_bsdf_nodes(mat)
            if not nodes:
                continue
            node = nodes[0]
            scanned += 1

            base_in = node.inputs.get("Base Color")
            if not base_in or base_in.is_linked:
                continue

            try:
                rgba = list(base_in.default_value)
                src_rgb = (float(rgba[0]), float(rgba[1]), float(rgba[2]))
                src_hex = self._rgb_float_to_hex(src_rgb)
            except Exception:
                continue

            if not src_hex:
                continue

            name_mapped = False

            # Apply material-name mapping first (for cases where color values are wrong but names are meaningful)
            if (src_hex not in overrides_map) and (src_hex not in materials_map):
                inferred_name = self._infer_canonical_color_from_material_name(mat.name)
                if inferred_name:
                    try:
                        palette = self._get_standard_color_palette() or {}
                        inferred_rgb = palette.get(inferred_name)
                        if inferred_rgb:
                            a = float(rgba[3]) if len(rgba) > 3 else 1.0
                            base_in.default_value = (inferred_rgb[0], inferred_rgb[1], inferred_rgb[2], a)
                            self.log(f"Name mapping: {mat.name} ({src_hex}) → {inferred_name}")

                            material_props = self._get_standard_material_properties(inferred_name)
                            if material_props:
                                metallic_in = node.inputs.get('Metallic')
                                if metallic_in and not metallic_in.is_linked and ('metallic' in material_props):
                                    metallic_in.default_value = float(material_props['metallic'])
                                    params_changed += 1

                                roughness_in = node.inputs.get('Roughness')
                                if roughness_in and not roughness_in.is_linked and ('roughness' in material_props):
                                    roughness_in.default_value = float(material_props['roughness'])
                                    params_changed += 1

                            src_hex = self._rgb_float_to_hex(inferred_rgb)
                            src_rgb = (float(inferred_rgb[0]), float(inferred_rgb[1]), float(inferred_rgb[2]))
                            rgba = list(base_in.default_value)
                            matched_sources.add(src_hex)
                            changed += 1
                            threshold_mapped += 1
                            name_mapped = True
                    except Exception as e:
                        self.log(f"Name mapping failed for {mat.name}: {e}", "WARNING")

            # Apply threshold mapping first (if enabled and no explicit override exists)
            if (not name_mapped) and do_threshold_mapping and (src_hex not in overrides_map) and (src_hex not in materials_map):
                match = self._find_nearest_standard_color(src_rgb)
                if match:
                    try:
                        # Get canonical name (resolves aliases)
                        canonical_name = self._get_canonical_color_name(match['name'])
                        palette = self._get_standard_color_palette() or {}
                        canonical_rgb = palette.get(canonical_name, match['rgb'])
                        
                        a = float(rgba[3]) if len(rgba) > 3 else 1.0
                        base_in.default_value = (canonical_rgb[0], canonical_rgb[1], canonical_rgb[2], a)
                        threshold_mapped += 1
                        self.log(f"Threshold mapping: {mat.name} {src_hex} → {canonical_name} (dist={match['distance']:.3f})")
                        
                        # Apply material-specific properties (metallic, roughness)
                        material_props = self._get_standard_material_properties(canonical_name)
                        if material_props:
                            # Set metallic
                            if 'metallic' in material_props:
                                metallic_in = node.inputs.get('Metallic')
                                if metallic_in and not metallic_in.is_linked:
                                    metallic_in.default_value = float(material_props['metallic'])
                                    params_changed += 1
                            
                            # Set roughness
                            if 'roughness' in material_props:
                                roughness_in = node.inputs.get('Roughness')
                                if roughness_in and not roughness_in.is_linked:
                                    roughness_in.default_value = float(material_props['roughness'])
                                    params_changed += 1
                            
                            self.log(f"  → Applied properties: metallic={material_props.get('metallic')}, roughness={material_props.get('roughness')}")
                        
                        # Update src_hex for potential further processing
                        src_hex = self._rgb_float_to_hex(canonical_rgb)
                        rgba = list(base_in.default_value)
                        
                        matched_sources.add(src_hex)
                        changed += 1
                    except Exception as e:
                        self.log(f"Threshold mapping failed for {mat.name}: {e}", "WARNING")

            if selected_set and (src_hex not in selected_set):
                if (src_hex not in overrides_map) and (src_hex not in materials_map):
                    continue

            target_rgb = None
            target_metallic = None
            target_roughness = None

            spec = None
            if src_hex in materials_map:
                spec = materials_map.get(src_hex) or {}
                if isinstance(spec, dict):
                    target_metallic = _safe_float01(spec.get('metallic'))
                    target_roughness = _safe_float01(spec.get('roughness'))

            if src_hex in materials_map:
                kd = None
                if isinstance(spec, dict):
                    kd = spec.get('kd')
                target_rgb = self._coerce_kd_rgb(kd)

            if (target_rgb is None) and (src_hex in overrides_map):
                raw_override = overrides_map.get(src_hex)
                # 1) Object form: { paletteId: 'orange' } or { palette_id: 'orange' } or { hex: '#RRGGBB' }
                if isinstance(raw_override, dict):
                    pal = raw_override.get('paletteId') or raw_override.get('palette_id')
                    if pal:
                        target_rgb = self._palette_id_to_rgb(pal)
                    if target_rgb is None:
                        hx = raw_override.get('hex') or raw_override.get('color') or raw_override.get('to')
                        if hx:
                            target_rgb = self._hex_to_rgb_float(str(hx))
                else:
                    # 2) String form: '#rrggbb' OR 'orange'/'zinc'/...
                    if isinstance(raw_override, str):
                        # Try hex first
                        target_rgb = self._hex_to_rgb_float(raw_override)
                        if target_rgb is None:
                            target_rgb = self._palette_id_to_rgb(raw_override)
                    else:
                        # 3) Fallback: try palette id via string
                        target_rgb = self._palette_id_to_rgb(raw_override)

            # Bei reinem Farb-Override (z. B. RAL 7035 aus Dashboard): metallic=0, damit nicht metallisch gerendert
            if target_rgb is not None and target_metallic is None and (src_hex in overrides_map):
                target_metallic = 0.0
            if target_rgb is not None and target_roughness is None and (src_hex in overrides_map):
                target_roughness = 0.3

            if target_rgb is None and target_metallic is None and target_roughness is None:
                continue

            try:
                # Base Color (glTF/Blender erwartet linear; sRGB → linear damit in GLB/Blender #138AFF etc. korrekt erscheint)
                if target_rgb is not None:
                    a = float(rgba[3]) if len(rgba) > 3 else 1.0
                    linear = self._srgb_rgb_to_linear((target_rgb[0], target_rgb[1], target_rgb[2]))
                    base_in.default_value = (float(linear[0]), float(linear[1]), float(linear[2]), a)
                    changed += 1

                # Metallic / Roughness (only if unlinked)
                if target_metallic is not None:
                    metallic_in = node.inputs.get('Metallic')
                    if metallic_in and (not metallic_in.is_linked):
                        metallic_in.default_value = float(target_metallic)
                        params_changed += 1

                if target_roughness is not None:
                    roughness_in = node.inputs.get('Roughness')
                    if roughness_in and (not roughness_in.is_linked):
                        roughness_in.default_value = float(target_roughness)
                        params_changed += 1

                matched_sources.add(src_hex)
            except Exception:
                continue

        # Bei Nutzer-Overrides (z. B. RAL 7035) oder defaultColorOverride-Flag: ALLE Materialien auf metallic=0 setzen,
        # damit z. B. output-4026212077742_20060751_RAL_7035 nicht metallisch exportiert wird (auch wenn Preflight keine Farben lieferte).
        # Links an Metallic/Roughness entfernen, damit der Skalar greift.
        # Plastikkappen-Materialien überspringen – deren Eigenschaften wurden von _apply_plastic_to_caps() gesetzt.
        if overrides_map or default_color_override:
            for mat in bpy.data.materials:
                if mat and ('Plastic' in mat.name or mat.name.startswith('Kappe_')):
                    continue
                nodes = self._iter_principled_bsdf_nodes(mat)
                if not nodes:
                    continue
                node = nodes[0]
                metallic_in = node.inputs.get("Metallic")
                rough_in = node.inputs.get("Roughness")
                tree = getattr(mat, 'node_tree', None)
                if tree and tree.links and (metallic_in or rough_in):
                    to_remove = [link for link in tree.links if link.to_node == node and (link.to_socket == metallic_in or link.to_socket == rough_in)]
                    for link in to_remove:
                        tree.links.remove(link)
                if metallic_in:
                    metallic_in.default_value = 0.0
                    params_changed += 1
                if rough_in:
                    rough_in.default_value = 0.3
                    params_changed += 1

        return {
            "enabled": True,
            "materialsScanned": scanned,
            "materialsChanged": changed,
            "sourceColorsMatched": len(matched_sources),
            "principledParamsChanged": params_changed,
            "thresholdMapped": threshold_mapped
        }

    def _iter_principled_bsdf_nodes(self, material: bpy.types.Material):
        if not material or not material.use_nodes or not material.node_tree:
            return []
        return [
            node
            for node in material.node_tree.nodes
            if node and node.type == 'BSDF_PRINCIPLED'
        ]

    def _compute_mesh_signature(self, obj: bpy.types.Object, max_sample_vertices: int = 5000) -> Optional[Dict[str, Any]]:
        if not obj or obj.type != 'MESH' or not getattr(obj, 'data', None):
            return None

        mesh = obj.data
        try:
            vcount = len(mesh.vertices)
            fcount = len(mesh.polygons)
        except Exception:
            return None

        if vcount <= 0:
            return None

        stride = 1
        if max_sample_vertices and vcount > max_sample_vertices:
            stride = int(math.ceil(vcount / float(max_sample_vertices)))
            stride = max(1, stride)

            z = float(co.z)
            sum_x += x
            sum_y += y
            sum_z += z
            sampled += 1
            if x < min_x:
                min_x = x
            if y < min_y:
                min_y = y
            if z < min_z:
                min_z = z

        @staticmethod
        def _derive_gtin_candidate_from_stem(stem: str) -> Optional[str]:
            """Derive a GTIN candidate from a 5-6 digit filename stem.

            Business rule: If the input filename is 5 or 6 digits (e.g. "12345"),
            try GTIN="200" + stem (e.g. "20012345") against the GTIN DB.
            """
            try:
                s = str(stem or '').strip()
            except Exception:
                return None
            if not s:
                return None
            if not s.isdigit():
                return None
            if len(s) not in (5, 6):
                return None
            return f"200{s}"
            if x > max_x:
                max_x = x
            if y > max_y:
                max_y = y
            if z > max_z:
                max_z = z

        if sampled <= 0:
            return None

        cx = sum_x / float(sampled)
        cy = sum_y / float(sampled)
        cz = sum_z / float(sampled)

        dx = max_x - min_x
        dy = max_y - min_y
        dz = max_z - min_z
        max_dim = max(dx, dy, dz, 1e-12)
        bbox_ratios = [dx / max_dim, dy / max_dim, dz / max_dim]

        radii = []
        max_r = 0.0
        for idx, v in enumerate(mesh.vertices):
            if stride > 1 and (idx % stride) != 0:
                continue
            co = v.co
            rx = float(co.x) - cx
            ry = float(co.y) - cy
            rz = float(co.z) - cz
            r = math.sqrt(rx * rx + ry * ry + rz * rz)
            radii.append(r)
            if r > max_r:
                max_r = r

        radii.sort()
        def _q(p: float) -> float:
            if not radii:
                return 0.0
            pos = int(round(self._clamp(p, 0.0, 1.0) * (len(radii) - 1)))
            return float(radii[pos])

        radial_quantiles_raw = [_q(0.10), _q(0.25), _q(0.50), _q(0.75), _q(0.90)]
        denom = max(max_r, 1e-12)
        radial_quantiles = [r / denom for r in radial_quantiles_raw]

        # Surface area is inexpensive.
        surface_area = None
        try:
            surface_area = float(sum(float(p.area) for p in mesh.polygons))
        except Exception:
            surface_area = None

        # Volume is optional; can fail for non-manifold meshes.
        volume = None
        compactness = None
        try:
            if fcount > 0 and fcount <= 200000:
                bm = bmesh.new()
                try:
                    bm.from_mesh(mesh)
                    # calc_volume is available for closed, manifold meshes.
                    volume_val = float(bm.calc_volume(signed=False))
                    if math.isfinite(volume_val) and volume_val > 0.0:
                        volume = volume_val
                finally:
                    bm.free()
        except Exception:
            volume = None

        try:
            if surface_area is not None and volume is not None and volume > 0.0:
                compactness = float(surface_area / (pow(volume, 2.0 / 3.0) + 1e-12))
        except Exception:
            compactness = None

        return {
            "version": 1,
            "vertexCount": int(vcount),
            "faceCount": int(fcount),
            "bboxRatios": [float(x) for x in bbox_ratios],
            "radialQuantiles": [float(x) for x in radial_quantiles],
            "surfaceArea": surface_area,
            "volume": volume,
            "compactness": compactness,
            "sampledVertices": int(sampled),
            "stride": int(stride)
        }

    @staticmethod
    def _mean_abs_diff(a: List[float], b: List[float]) -> float:
        if not isinstance(a, list) or not isinstance(b, list) or not a or not b:
            return 0.0
        n = min(len(a), len(b))
        if n <= 0:
            return 0.0
        s = 0.0
        for i in range(n):
            try:
                s += abs(float(a[i]) - float(b[i]))
            except Exception:
                continue
        return s / float(n)

    def _mesh_signature_distance(self, target: Dict[str, Any], candidate: Dict[str, Any]) -> float:
        if not isinstance(target, dict) or not isinstance(candidate, dict):
            return float('inf')

        bbox_d = self._mean_abs_diff(target.get('bboxRatios') or [], candidate.get('bboxRatios') or [])
        radial_d = self._mean_abs_diff(target.get('radialQuantiles') or [], candidate.get('radialQuantiles') or [])

        comp_d = 0.0
        try:
            t = target.get('compactness')
            c = candidate.get('compactness')
            if t and c and float(t) > 0.0 and float(c) > 0.0:
                # log-ratio distance is more stable than absolute.
                comp_d = abs(math.log(float(c) / float(t)))
        except Exception:
            comp_d = 0.0

        count_d = 0.0
        try:
            tv = float(target.get('vertexCount') or 0)
            cv = float(candidate.get('vertexCount') or 0)
            tf = float(target.get('faceCount') or 0)
            cf = float(candidate.get('faceCount') or 0)
            if tv > 0 and cv > 0:
                count_d += abs(math.log(cv / tv))
            if tf > 0 and cf > 0:
                count_d += abs(math.log(cf / tf))
            count_d = count_d / 2.0
        except Exception:
            count_d = 0.0

        # Weights tuned for name/color-independent matching (geometry-only)
        return (0.35 * bbox_d) + (0.45 * radial_d) + (0.15 * comp_d) + (0.05 * count_d)

    def _match_target_mesh(self, target_signature: Optional[Dict[str, Any]], threshold: float = 0.15) -> Optional[Dict[str, Any]]:
        if not isinstance(target_signature, dict) or not target_signature:
            return None

        try:
            thr = float(threshold)
        except Exception:
            thr = 0.15

        best = None
        checked = 0

        for obj in bpy.context.scene.objects:
            if not obj or obj.type != 'MESH':
                continue
            if not getattr(obj, 'data', None) or len(obj.data.vertices) <= 0:
                continue
            checked += 1
            sig = self._compute_mesh_signature(obj)
            if not sig:
                continue
            dist = self._mesh_signature_distance(target_signature, sig)
            if best is None or dist < best.get('distance', float('inf')):
                best = {
                    'objectName': obj.name,
                    'distance': float(dist),
                    'signature': sig
                }

        found = bool(best and best.get('distance', float('inf')) <= thr)
        if found:
            try:
                obj = bpy.context.scene.objects.get(best.get('objectName'))
                if obj is not None:
                    obj['mcp_target_mesh'] = True
            except Exception:
                pass

        return {
            'enabled': True,
            'threshold': float(thr),
            'checkedMeshes': int(checked),
            'found': bool(found),
            'best': best
        }

    def _apply_material_preset_to_object(self, obj: bpy.types.Object, preset: Dict[str, Any]) -> bool:
        if not obj or obj.type != 'MESH' or not isinstance(preset, dict):
            return False

        name = str(preset.get('name') or 'TargetMesh').strip() or 'TargetMesh'
        kd = preset.get('kd')
        rgb = self._coerce_kd_rgb(kd)
        metallic = preset.get('metallic')
        roughness = preset.get('roughness')

        safe_name = re.sub(r"[^A-Za-z0-9 _.-]+", "_", name)[:80]
        mat_name = f"MCP_TargetMesh_{safe_name}"

        mat = bpy.data.materials.get(mat_name)
        if mat is None:
            mat = bpy.data.materials.new(name=mat_name)
            mat.use_nodes = True

        if not mat.use_nodes or not mat.node_tree:
            return False

        # Ensure there is a Principled BSDF
        principled = None
        for node in mat.node_tree.nodes:
            if node and node.type == 'BSDF_PRINCIPLED':
                principled = node
                break
        if principled is None:
            # fallback: create minimal principled setup
            mat.node_tree.nodes.clear()
            principled = mat.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
            out = mat.node_tree.nodes.new('ShaderNodeOutputMaterial')
            mat.node_tree.links.new(principled.outputs.get('BSDF'), out.inputs.get('Surface'))

        try:
            if rgb is not None:
                base_in = principled.inputs.get('Base Color')
                if base_in and not base_in.is_linked:
                    base_in.default_value = (float(rgb[0]), float(rgb[1]), float(rgb[2]), 1.0)

            if metallic is not None:
                m_in = principled.inputs.get('Metallic')
                if m_in and not m_in.is_linked:
                    m_in.default_value = float(self._clamp(metallic, 0.0, 1.0))

            if roughness is not None:
                r_in = principled.inputs.get('Roughness')
                if r_in and not r_in.is_linked:
                    r_in.default_value = float(self._clamp(roughness, 0.0, 1.0))
        except Exception:
            return False

        # Assign material to object (override all slots)
        try:
            if not obj.data.materials or len(obj.data.materials) == 0:
                obj.data.materials.append(mat)
            else:
                for i in range(len(obj.data.materials)):
                    obj.data.materials[i] = mat
        except Exception:
            return False

        return True

    def _build_preflight_report(self,
                               enable_preflight: bool,
                               color_saturation: float,
                               color_brightness: float,
                               roughness_multiplier: float,
                               metallic_multiplier: float) -> Dict[str, Any]:
        """Inspect materials/colors/surface params before export.

        Returns a compact report that can be shown in the UI.
        """

        report: Dict[str, Any] = {
            "enabled": bool(enable_preflight),
            "adjustments": {
                "colorSaturation": float(color_saturation),
                "colorBrightness": float(color_brightness),
                "roughnessMultiplier": float(roughness_multiplier),
                "metallicMultiplier": float(metallic_multiplier),
            },
            "summary": {},
            "warnings": [],
            "materials": []
        }

        materials = list(bpy.data.materials)
        total_materials = len(materials)
        principled_count = 0
        textured_basecolor = 0
        solid_basecolor = 0
        missing_nodes = 0

        unique_colors = set()
        roughness_values = []
        metallic_values = []

        # Map solid (unlinked) base colors to materials for later object usage aggregation.
        material_solid_color: Dict[str, Dict[str, Any]] = {}

        # Keep this bounded for large scenes
        max_material_entries = 200

        for idx, mat in enumerate(materials):
            nodes = self._iter_principled_bsdf_nodes(mat)
            if not nodes:
                missing_nodes += 1
                if idx < max_material_entries:
                    report["materials"].append({
                        "name": mat.name if mat else "<unknown>",
                        "hasPrincipled": False
                    })
                continue

            principled_count += 1
            node = nodes[0]

            base_in = node.inputs.get("Base Color")
            rough_in = node.inputs.get("Roughness")
            metal_in = node.inputs.get("Metallic")

            base_linked = bool(base_in and base_in.is_linked)
            if base_linked:
                textured_basecolor += 1
            else:
                solid_basecolor += 1

            base_color_rgba = None
            if base_in and hasattr(base_in, 'default_value'):
                try:
                    rgba = list(base_in.default_value)
                    base_color_rgba = [float(rgba[0]), float(rgba[1]), float(rgba[2]), float(rgba[3])]
                    # Quantize to keep unique colors stable
                    unique_colors.add((round(base_color_rgba[0], 3), round(base_color_rgba[1], 3), round(base_color_rgba[2], 3)))

                    if (not base_linked) and mat is not None:
                        key = (round(base_color_rgba[0], 3), round(base_color_rgba[1], 3), round(base_color_rgba[2], 3))
                        material_solid_color[mat.name] = {
                            "key": key,
                            "rgb": [float(base_color_rgba[0]), float(base_color_rgba[1]), float(base_color_rgba[2])]
                        }
                except Exception:
                    base_color_rgba = None

            rough_val = None
            if rough_in and hasattr(rough_in, 'default_value'):
                try:
                    rough_val = float(rough_in.default_value)
                    if not rough_in.is_linked:
                        roughness_values.append(rough_val)
                except Exception:
                    rough_val = None

            metal_val = None
            if metal_in and hasattr(metal_in, 'default_value'):
                try:
                    metal_val = float(metal_in.default_value)
                    if not metal_in.is_linked:
                        metallic_values.append(metal_val)
                except Exception:
                    metal_val = None

            if idx < max_material_entries:
                report["materials"].append({
                    "name": mat.name,
                    "hasPrincipled": True,
                    "baseColor": base_color_rgba,
                    "baseColorLinked": base_linked,
                    "roughness": rough_val,
                    "roughnessLinked": bool(rough_in and rough_in.is_linked),
                    "metallic": metal_val,
                    "metallicLinked": bool(metal_in and metal_in.is_linked),
                })

        if total_materials > max_material_entries:
            report["warnings"].append(f"Materialliste gekürzt: {max_material_entries}/{total_materials} Einträge")

        if principled_count == 0 and total_materials > 0:
            report["warnings"].append("Keine Principled-BSDF Materialien gefunden – Preflight kann Oberflächenwerte nur begrenzt prüfen")

        if total_materials == 0:
            report["warnings"].append("Keine Materialien gefunden – Ergebnis könnte ohne Farben/Oberflächen exportieren")

        # Summaries
        mesh_objects = 0
        try:
            mesh_objects = len([obj for obj in bpy.context.scene.objects if obj.type == 'MESH'])
        except Exception:
            mesh_objects = 0
        report["summary"] = {
            "totalObjects": mesh_objects,
            "totalMaterials": total_materials,
            "principledMaterials": principled_count,
            "materialsWithoutPrincipled": missing_nodes,
            "baseColorSolidCount": solid_basecolor,
            "baseColorLinkedCount": textured_basecolor,
            "uniqueSolidColors": len(unique_colors),
            "uniqueSolidColorsSample": list(sorted(unique_colors))[:25],
            "roughnessUnlinkedMin": min(roughness_values) if roughness_values else None,
            "roughnessUnlinkedMax": max(roughness_values) if roughness_values else None,
            "metallicUnlinkedMin": min(metallic_values) if metallic_values else None,
            "metallicUnlinkedMax": max(metallic_values) if metallic_values else None,
        }

        # Color usage: which mesh objects use which solid colors.
        usage_map: Dict[Any, Dict[str, Any]] = {}
        try:
            for obj in bpy.context.scene.objects:
                if not obj or getattr(obj, 'type', None) != 'MESH':
                    continue
                for slot in getattr(obj, 'material_slots', []) or []:
                    mat = getattr(slot, 'material', None)
                    if not mat:
                        continue
                    info = material_solid_color.get(mat.name)
                    if not info:
                        continue
                    key = info.get('key')
                    entry = usage_map.get(key)
                    if entry is None:
                        entry = {
                            "rgb": info.get('rgb'),
                            "objects": set(),
                            "materials": set(),
                        }
                        usage_map[key] = entry
                    entry["objects"].add(obj.name)
                    entry["materials"].add(mat.name)
        except Exception:
            usage_map = {}

        color_usage_list: List[Dict[str, Any]] = []
        try:
            for _, entry in usage_map.items():
                color_usage_list.append({
                    "rgb": entry.get('rgb'),
                    "objects": sorted(list(entry.get('objects') or []))[:200],
                    "materials": sorted(list(entry.get('materials') or []))[:200],
                })
            color_usage_list.sort(key=lambda e: len(e.get('objects') or []), reverse=True)
        except Exception:
            color_usage_list = []

        report["colorUsage"] = color_usage_list
        report["summary"]["colorUsageEntries"] = len(color_usage_list)

        return report

    def _apply_global_material_adjustments(self,
                                          color_saturation: float,
                                          color_brightness: float,
                                          roughness_multiplier: float,
                                          metallic_multiplier: float) -> Dict[str, Any]:
        """Apply global multipliers to solid-color Principled materials.

        Adjustments are applied only when the respective input is NOT linked.
        """
        changed_colors = 0
        changed_roughness = 0
        changed_metallic = 0
        scanned = 0

        sat = float(color_saturation)
        bri = float(color_brightness)
        r_mul = float(roughness_multiplier)
        m_mul = float(metallic_multiplier)

        for mat in bpy.data.materials:
            nodes = self._iter_principled_bsdf_nodes(mat)
            if not nodes:
                continue
            node = nodes[0]
            scanned += 1

            base_in = node.inputs.get("Base Color")
            if base_in and (not base_in.is_linked):
                try:
                    rgba = list(base_in.default_value)
                    r, g, b, a = float(rgba[0]), float(rgba[1]), float(rgba[2]), float(rgba[3])
                    h, s, v = colorsys.rgb_to_hsv(r, g, b)
                    s = self._clamp(s * sat, 0.0, 1.0)
                    v = self._clamp(v * bri, 0.0, 1.0)
                    nr, ng, nb = colorsys.hsv_to_rgb(h, s, v)
                    base_in.default_value = (nr, ng, nb, a)
                    changed_colors += 1
                except Exception:
                    pass

            rough_in = node.inputs.get("Roughness")
            if rough_in and (not rough_in.is_linked):
                try:
                    rough_in.default_value = self._clamp(float(rough_in.default_value) * r_mul, 0.0, 1.0)
                    changed_roughness += 1
                except Exception:
                    pass

            metal_in = node.inputs.get("Metallic")
            if metal_in and (not metal_in.is_linked):
                try:
                    metal_in.default_value = self._clamp(float(metal_in.default_value) * m_mul, 0.0, 1.0)
                    changed_metallic += 1
                except Exception:
                    pass

        return {
            "materialsScanned": scanned,
            "baseColorAdjusted": changed_colors,
            "roughnessAdjusted": changed_roughness,
            "metallicAdjusted": changed_metallic,
        }

    def strip_cameras_and_lights(self) -> int:
        """Remove all camera and light objects from the scene.

        Even when the glTF exporter is configured with export_cameras/export_lights=False,
        removing these objects keeps the scene clean for downstream tooling.

        Returns:
            int: Number of removed objects
        """
        removed = 0
        try:
            to_remove = [o for o in bpy.data.objects if o.type in {'CAMERA', 'LIGHT'}]
            for obj in to_remove:
                try:
                    bpy.data.objects.remove(obj, do_unlink=True)
                    removed += 1
                except Exception:
                    # Fallback for edge cases where unlinking fails
                    try:
                        obj.select_set(True)
                    except Exception:
                        pass

            if removed > 0:
                self.log(f"Removed {removed} camera/light objects before export")
        except Exception as e:
            self.log(f"Failed to remove cameras/lights: {str(e)}", "WARNING")

        return removed
    
    def _deduplicate_meshes(self):
        """
        Remove duplicate meshes that have identical geometry (same vertex count, polygon count, and bounds).
        This fixes the 2x-4x duplication bug from STEP → OBJ → GLB conversion pipeline.
        """
        from collections import defaultdict
        
        mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
        
        if len(mesh_objects) <= 1:
            return  # No duplicates possible
        
        self.log(f"Checking {len(mesh_objects)} mesh objects for duplicates...")
        
        # Group meshes by signature (vertex count, polygon count, dimensions, location)
        mesh_signatures = defaultdict(list)
        
        for obj in mesh_objects:
            vertex_count = len(obj.data.vertices)
            polygon_count = len(obj.data.polygons)

            try:
                min_v, max_v, dims = self._compute_world_bbox(obj)
                center_sig = tuple(round((min_v[i] + max_v[i]) / 2, 4) for i in range(3))
                dimension_sig = tuple(round(d, 4) for d in dims)
            except Exception:
                center_sig = tuple(round(v, 4) for v in obj.location)
                dimension_sig = tuple(round(v, 4) for v in obj.dimensions)

            signature = (vertex_count, polygon_count, center_sig, dimension_sig)
            mesh_signatures[signature].append(obj)
        
        # Remove duplicates - keep first object of each signature, delete the rest
        duplicates_removed = 0
        for signature, objects in mesh_signatures.items():
            if len(objects) > 1:
                vertex_count, polygon_count, location, dimensions = signature
                self.log(f"Found {len(objects)} duplicates: {vertex_count} verts, {polygon_count} polys", "WARNING")
                
                # Keep the first object, remove duplicates
                kept = objects[0]
                for duplicate in objects[1:]:
                    self.log(f"  Removing duplicate: {duplicate.name} (keeping {kept.name})", "WARNING")
                    bpy.data.objects.remove(duplicate, do_unlink=True)
                    duplicates_removed += 1
        
        if duplicates_removed > 0:
            self.log(f"✓ Removed {duplicates_removed} duplicate mesh(es)", "INFO")
        else:
            self.log("✓ No duplicate meshes found", "INFO")

    def _log_mesh_inventory(self, stage: str):
        """Log aggregate mesh statistics to compare OBJ and STEP pipelines."""
        mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
        total_vertices = sum(len(obj.data.vertices) for obj in mesh_objects)
        total_polygons = sum(len(obj.data.polygons) for obj in mesh_objects)
        sample_names = ', '.join(obj.name for obj in mesh_objects[:5])
        self.log(
            f"[{stage}] Meshes={len(mesh_objects)} | Vertices={total_vertices} | Polygons={total_polygons}"
        )
        if len(mesh_objects) > 5:
            self.log(f"[{stage}] First meshes: {sample_names}…")
        elif mesh_objects:
            self.log(f"[{stage}] Mesh names: {sample_names}")

    def _log_material_summary(self, stage: str):
        """Log key material color information for debugging MTL application."""
        mats = list(bpy.data.materials)
        self.log(f"[{stage}] Materials={len(mats)}")
        for mat in mats[:5]:
            base_color = None
            try:
                if mat.use_nodes and mat.node_tree:
                    principled = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
                    if principled:
                        color = principled.inputs['Base Color'].default_value
                        base_color = tuple(round(c, 3) for c in color[:3])
                elif hasattr(mat, 'diffuse_color'):
                    base_color = tuple(round(c, 3) for c in mat.diffuse_color[:3])
            except Exception:
                base_color = None
            self.log(f"[{stage}] Material {mat.name} base_color={base_color}")

    def apply_material_finish(self, finish: Optional[str]):
        """Apply global material adjustments (e.g. galvanized preset)."""
        finish_key = (finish or '').strip().lower()

        if finish_key in ('', 'standard', 'default', 'none'):
            return

        overrides = {}
        if finish_key == 'galvanized':
            overrides = {
                'metallic': 0.85,
                'roughness': 0.35,
                'specular': 0.45
            }
        elif finish_key in ('powder-coated', 'powder_coated', 'powder'):
            overrides = {
                'metallic': 0.05,
                'roughness': 0.6,
                'specular': 0.25
            }
        else:
            self.log(f"Unbekanntes Material-Finish '{finish_key}', überspringe Override", "WARNING")
            return

        applied = 0
        skipped_textured = 0
        for mat in bpy.data.materials:
            if not mat or not mat.use_nodes or not mat.node_tree:
                continue

            principled = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not principled:
                continue

            # Materialien mit verlinktem Base Color oder laut MTL map_Kd (PNG/JPG) überspringen –
            # Bildbasierte Oberflächen (Holz, Dekor) dürfen nie metallisch werden.
            base_input = principled.inputs.get('Base Color')
            if base_input and base_input.is_linked:
                skipped_textured += 1
                continue
            if self._is_mtl_textured_material_name(mat.name, getattr(self, '_mtl_materials_with_diffuse_texture', set())):
                skipped_textured += 1
                continue

            try:
                metallic_input = principled.inputs.get('Metallic')
                if metallic_input and 'metallic' in overrides:
                    metallic_input.default_value = overrides['metallic']

                roughness_input = principled.inputs.get('Roughness')
                if roughness_input and 'roughness' in overrides:
                    roughness_input.default_value = overrides['roughness']

                specular_input = principled.inputs.get('Specular') or principled.inputs.get('Specular IOR Level')
                if specular_input and 'specular' in overrides:
                    specular_input.default_value = overrides['specular']

                applied += 1
            except Exception as exc:
                self.log(f"Material-Finish konnte für {mat.name} nicht angewendet werden: {exc}", "WARNING")

        self.log(f"Material-Finish '{finish_key}' auf {applied} Material(e) angewendet (übersprungen: {skipped_textured} texturierte)")

    def _parse_mtl_materials_with_diffuse_texture(self, mtl_path: Optional[str]) -> set:
        """
        MTL-Datei parsen: Set von Materialnamen, die map_Kd auf eine Bilddatei (PNG/JPG) haben.
        Diese Materialien gelten als Oberfläche mit Bildtextur und dürfen nie metallisch sein.
        """
        result = set()
        if not mtl_path or not os.path.isfile(mtl_path):
            return result
        try:
            image_extensions = ('.png', '.jpg', '.jpeg')
            current = None
            with open(mtl_path, 'r', encoding='utf-8', errors='replace') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    parts = line.split(None, 1)
                    if not parts:
                        continue
                    key = parts[0].lower()
                    value = parts[1].strip() if len(parts) > 1 else ''
                    if key == 'newmtl':
                        current = value
                    elif key == 'map_kd' and current:
                        # map_Kd kann Optionen enthalten, z. B.:
                        # map_Kd -s 1 1 1 -o 0 0 0 textures/natur012.png
                        texture_candidate = ''
                        try:
                            tokens = shlex.split(value)
                        except Exception:
                            tokens = value.split()
                        for token in reversed(tokens):
                            candidate = token.strip().strip('"').strip("'")
                            base = os.path.basename(candidate).lower()
                            if any(base.endswith(ext) for ext in image_extensions):
                                texture_candidate = candidate
                                break
                        if texture_candidate:
                            result.add(current)
                            self.log(f"MTL: Material '{current}' hat map_Kd Bildtextur ({os.path.basename(texture_candidate)}) → nicht metallisch")
            return result
        except Exception as e:
            self.log(f"MTL-Parse fehlgeschlagen: {e}", "WARNING")
            return set()

    def _is_mtl_textured_material_name(self, material_name: Optional[str], mtl_textured: set) -> bool:
        """Robustes Matching zwischen Blender-Materialnamen und MTL-newmtl Namen.

        Blender hängt bei Duplikaten oft .001/.002 an.
        """
        if not material_name or not mtl_textured:
            return False

        name = str(material_name).strip()
        if not name:
            return False
        if name in mtl_textured:
            return True

        # Blender duplicate suffix, z. B. "Steel.001" -> "Steel"
        base_name = re.sub(r"\.\d{3}$", "", name)
        if base_name in mtl_textured:
            return True

        # Defensive compare without surrounding spaces in MTL names
        stripped_set = {str(x).strip() for x in mtl_textured}
        return name in stripped_set or base_name in stripped_set

    def import_obj_file(self, obj_path: str, mtl_path: Optional[str] = None, import_up_axis: str = 'AUTO', mtl_reference: Optional[str] = None, skip_standard_color_mapping: bool = False) -> bool:
        """
        Import OBJ file with optional MTL and ensure materials are loaded.
        Wenn skip_standard_color_mapping=True (z. B. bei Nutzer-Overrides aus dem Preflight),
        bleiben die MTL-Farben erhalten, damit _apply_color_overrides sie per Original-Hex treffen kann.
        Args:
            obj_path: Path to OBJ file
            mtl_path: Optional MTL file path
            import_up_axis: 'AUTO', 'X', 'Y', or 'Z' - welche Achse in der OBJ nach oben zeigt
            skip_standard_color_mapping: Wenn True, kein Mapping auf Standardfarben (MTL bleibt für Override-Matching).
        """
        self.last_import_type = 'obj'
        self.last_import_color_attribute = None
        try:
            self.log(f"Importiere OBJ: {obj_path}")
            if not os.path.exists(obj_path):
                self.log("OBJ Datei nicht gefunden", "ERROR")
                return False

            # Ensure MTL is in the same directory as OBJ for proper material loading
            obj_dir = os.path.dirname(obj_path)
            if mtl_path and os.path.exists(mtl_path):
                import shutil
                desired_name = os.path.basename(mtl_reference) if mtl_reference else os.path.basename(mtl_path)
                desired_name = re.sub(r"[^a-zA-Z0-9._-]", "_", desired_name)
                if not desired_name.lower().endswith('.mtl'):
                    desired_name = f"{desired_name}.mtl"
                target_mtl = os.path.join(obj_dir, desired_name)
                if desired_name != os.path.basename(mtl_path):
                    self.log(f"MTL rename applied: {os.path.basename(mtl_path)} → {desired_name}")
                elif mtl_reference:
                    self.log(f"MTL reference already matches stored filename: {desired_name}")
                
                # Copy MTL to OBJ directory if it's not already there
                if os.path.abspath(mtl_path) != os.path.abspath(target_mtl):
                    shutil.copy2(mtl_path, target_mtl)
                    self.log(f"MTL kopiert nach: {target_mtl}")
                elif mtl_reference:
                    self.log(f"MTL bereits im OBJ Verzeichnis: {target_mtl}")
                mtl_path = target_mtl
            elif mtl_reference:
                self.log(f"MTL reference angegeben, aber Datei fehlt: {mtl_reference}", "WARNING")

            # MTL als Quelle der Wahrheit: Welche Materialien haben map_Kd (PNG/JPG)?
            self._mtl_materials_with_diffuse_texture = self._parse_mtl_materials_with_diffuse_texture(mtl_path)
            if self._mtl_materials_with_diffuse_texture:
                self.log(f"MTL: {len(self._mtl_materials_with_diffuse_texture)} Material(ien) mit Bildtextur (map_Kd) → werden nicht metallisch gesetzt")

            # Import durchführen (Blender 4.x bevorzugt neuen Operator)
            # Unterstützt manuelle Achsen-Auswahl oder AUTO für Standard (Y-Up)
            
            # Bestimme Import-Achsen basierend auf Parameter
            if import_up_axis == 'AUTO':
                # Standard: SolidWorks verwendet Y-Up
                up_axis = 'Y'
                self.log("Import: AUTO → Y-Up (SolidWorks Standard)")
            elif import_up_axis in ['X', 'Y', 'Z']:
                up_axis = import_up_axis
                self.log(f"Import: Manuell → {up_axis}-Up")
            else:
                up_axis = 'Y'
                self.log(f"Import: Ungültiger Wert '{import_up_axis}' → Fallback auf Y-Up")

            # Wähle passende Forward-Achse, damit bei Z-Up X/Y nicht getauscht werden
            if up_axis == 'X':
                forward_axis_new = 'Z'
                forward_axis_old = 'Z'
            elif up_axis == 'Z':
                forward_axis_new = 'Y'
                forward_axis_old = 'Y'
            else:  # Y oder Fallback
                forward_axis_new = 'NEGATIVE_Z'
                forward_axis_old = '-Z'

            self.log(f"Import-Achsen: Forward={forward_axis_new}, Up={up_axis}")
            
            imported = False
            try:
                if bpy.app.version >= (4, 0, 0):
                    bpy.ops.wm.obj_import(
                        filepath=obj_path,
                        up_axis=up_axis,            # Dynamisch: X, Y oder Z
                        forward_axis=forward_axis_new
                    )
                    imported = True
                else:
                    bpy.ops.import_scene.obj(
                        filepath=obj_path,
                        axis_up=up_axis,            # Dynamisch: X, Y oder Z
                        axis_forward=forward_axis_old
                    )
                    imported = True
            except Exception as e:
                self.log(f"Primärer OBJ Import fehlgeschlagen: {str(e)}", "WARNING")

            if not imported:
                return False

            # Reihenfolge: (1) MTL bereits von Blender angewendet; (2) optional Standardfarben-Mapping
            # Override (color_overrides) erfolgt erst später in _apply_color_overrides (nur aus Request).
            imported_objects = bpy.context.selected_objects
            material_count = 0
            mapped_colors = 0

            for obj in imported_objects:
                if obj.type == 'MESH' and obj.data.materials:
                    for mat in obj.data.materials:
                        if mat:
                            material_count += 1
                            # Convert to node-based material if not already
                            if not mat.use_nodes:
                                mat.use_nodes = True
                                nodes = mat.node_tree.nodes
                                
                                # Check if we have a Principled BSDF
                                principled = None
                                for node in nodes:
                                    if node.type == 'BSDF_PRINCIPLED':
                                        principled = node
                                        break
                                
                                # If no Principled BSDF, create basic setup
                                if not principled:
                                    nodes.clear()
                                    principled = nodes.new('ShaderNodeBsdfPrincipled')
                                    output = nodes.new('ShaderNodeOutputMaterial')
                                    principled.location = (0, 0)
                                    output.location = (300, 0)
                                    mat.node_tree.links.new(principled.outputs[0], output.inputs[0])
                                    
                                    # Try to preserve diffuse color if it exists
                                    if hasattr(mat, 'diffuse_color'):
                                        principled.inputs['Base Color'].default_value = mat.diffuse_color
                                        self.log(f"Material {mat.name}: Farbe übernommen {mat.diffuse_color[:3]}")
                            
                            # Apply color mapping if enabled (überspringen wenn Nutzer-Overrides, damit Preflight-Farben greifen)
                            if (not skip_standard_color_mapping) and self.color_mapping_enabled and mat.use_nodes:
                                principled = None
                                for node in mat.node_tree.nodes:
                                    if node.type == 'BSDF_PRINCIPLED':
                                        principled = node
                                        break
                                
                                if principled:
                                    base_color_input = principled.inputs.get('Base Color')
                                    if base_color_input and not base_color_input.is_linked:
                                        current_color = base_color_input.default_value[:3]
                                        match = self._find_nearest_standard_color(current_color)
                                        
                                        if match:
                                            canonical_name = self._get_canonical_color_name(match['name'])
                                            palette = self._get_standard_color_palette() or {}
                                            canonical_rgb = palette.get(canonical_name, match['rgb'])
                                            base_color_input.default_value = (canonical_rgb[0], canonical_rgb[1], canonical_rgb[2], 1.0)
                                            mapped_colors += 1
                                            source_hex = self._rgb_float_to_hex(current_color)
                                            self.log(f"Color mapping: {mat.name} {source_hex} → {canonical_name} (dist={match['distance']:.3f})")
                                            # RAL/Pulverbeschichtet: metallic=0, damit Lichtgrau etc. nicht metallisch gerendert werden
                                            material_props = self._get_standard_material_properties(canonical_name)
                                            if material_props:
                                                metallic_in = principled.inputs.get('Metallic')
                                                if metallic_in and not metallic_in.is_linked:
                                                    metallic_in.default_value = float(material_props.get('metallic', 0))
                                                rough_in = principled.inputs.get('Roughness')
                                                if rough_in and not rough_in.is_linked:
                                                    rough_in.default_value = float(material_props.get('roughness', 0.5))
                                            
                                            # Track statistics
                                            self.color_mapping_stats['mapped'] += 1
                                            mapping_key = f"{canonical_name}"
                                            self.color_mapping_stats['mappings'][mapping_key] = self.color_mapping_stats['mappings'].get(mapping_key, 0) + 1

            # MTL-Textur-Materialien sofort auf nicht-metallisch setzen (MTL ist Quelle der Wahrheit)
            for mat in bpy.data.materials:
                if not mat or not self._is_mtl_textured_material_name(mat.name, self._mtl_materials_with_diffuse_texture):
                    continue
                if not mat.use_nodes or not mat.node_tree:
                    continue
                for node in mat.node_tree.nodes:
                    if node.type != 'BSDF_PRINCIPLED':
                        continue
                    metal_in = node.inputs.get('Metallic')
                    if metal_in:
                        for link in [l for l in mat.node_tree.links if l.to_socket == metal_in]:
                            mat.node_tree.links.remove(link)
                        metal_in.default_value = 0.0
                    rough_in = node.inputs.get('Roughness')
                    if rough_in and not rough_in.is_linked:
                        rough_in.default_value = 0.85
                    spec_in = node.inputs.get('Specular') or node.inputs.get('Specular IOR Level')
                    if spec_in and not spec_in.is_linked:
                        spec_in.default_value = 0.15
                    self.log(f"MTL-Textur Material '{mat.name}': Metallic=0, Roughness=0.85 (laut MTL map_Kd)")
                    break
            
            self.color_mapping_stats['total'] += material_count
            
            if material_count > 0:
                self.log(f"MTL Import erfolgreich: {material_count} Materialien geladen")
                if mapped_colors > 0:
                    self.log(f"Color mapping: {mapped_colors} Materialien auf Standardfarben gemappt")
            else:
                self.log("Keine MTL Datei oder Pfad ungültig – Materialien werden generiert", "INFO")

            # Replace missing texture references with chipboard fallback
            self._fix_missing_textures()
            
            # Auto-Holzzuweisung via Geometrie-Heuristik deaktiviert:
            # Texturen sollen ausschließlich aus der MTL-Zuordnung (map_Kd) kommen.

            # Textured surfaces must never be metallic
            self._ensure_non_metallic_for_textured_materials()

            # FIX: Deduplicate identical meshes to prevent 2x-4x overlapping geometry in GLB
            self._deduplicate_meshes()
            self._log_mesh_inventory("OBJ-IMPORT")
            self._log_material_summary("OBJ-IMPORT")

            return True
        except Exception as e:
            self.log(f"OBJ Import fehlgeschlagen: {str(e)}", "ERROR")
            return False
    
    def _fix_missing_textures(self):
        """
        Find materials with missing texture references and replace them.
        Prefers uploaded texture files (matched by filename) over chipboard fallback.
        """
        try:
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            fallback_texture = os.path.join(project_root, 'data', 'textures', 'chipboard_1k.png')

            uploaded = getattr(self, '_uploaded_texture_files', None) or []
            uploaded_by_name: Dict[str, str] = {}
            for tp in uploaded:
                uploaded_by_name[os.path.basename(tp).lower()] = tp

            if not os.path.exists(fallback_texture):
                self.log(f"Chipboard fallback texture not found: {fallback_texture}", "WARNING")
                if not uploaded:
                    return
            
            fixed_count = 0
            missing_count = 0
            
            for mat in bpy.data.materials:
                if not mat.use_nodes:
                    continue
                    
                for node in mat.node_tree.nodes:
                    if node.type == 'TEX_IMAGE':
                        if node.image is None or node.image.filepath == '' or not os.path.exists(bpy.path.abspath(node.image.filepath)):
                            missing_count += 1
                            missing_name = ''
                            if node.image:
                                missing_name = os.path.basename(node.image.filepath or node.image.name or '').lower()
                                self.log(f"Material '{mat.name}': Fehlende Textur '{node.image.filepath or '<no path>'}'", "WARNING")

                            # 1. Try to match by filename against uploaded textures
                            replacement = uploaded_by_name.get(missing_name) if missing_name else None

                            # 2. If only one uploaded texture, use it as universal fallback
                            if not replacement and len(uploaded) == 1:
                                replacement = uploaded[0]

                            if replacement and os.path.exists(replacement):
                                try:
                                    img = bpy.data.images.load(replacement)
                                    node.image = img
                                    fixed_count += 1
                                    self.log(f"Material '{mat.name}': Hochgeladene Textur '{os.path.basename(replacement)}' zugewiesen")
                                    continue
                                except Exception as e:
                                    self.log(f"Laden der hochgeladenen Textur fehlgeschlagen: {e}", "WARNING")

                            # 3. Chipboard fallback
                            if os.path.exists(fallback_texture):
                                try:
                                    chipboard_image = bpy.data.images.load(fallback_texture)
                                    node.image = chipboard_image
                                    fixed_count += 1
                                    self.log(f"Material '{mat.name}': Chipboard-Fallback angewendet")
                                except Exception as e:
                                    self.log(f"Failed to load chipboard texture: {e}", "ERROR")
            
            if fixed_count > 0:
                self.log(f"{fixed_count} fehlende Texturen ersetzt (von {missing_count} fehlenden Referenzen)")
                
        except Exception as e:
            self.log(f"Failed to fix missing textures: {e}", "WARNING")
            import traceback
            traceback.print_exc()

    def _ensure_non_metallic_for_textured_materials(self):
        """
        Enforce physically correct PBR for all materials with:
        - ANY linked Base Color input, ODER
        - Materialname laut MTL map_Kd (PNG/JPG) – MTL ist Quelle der Wahrheit.
        Diese Materialien → dielektrisch: Metallic=0, Roughness=0.85, Specular=0.15.
        """
        try:
            adjusted = 0
            mtl_textured = getattr(self, '_mtl_materials_with_diffuse_texture', set())
            for mat in bpy.data.materials:
                if not mat or not mat.use_nodes or not mat.node_tree:
                    continue

                for node in mat.node_tree.nodes:
                    if node.type != 'BSDF_PRINCIPLED':
                        continue

                    base_in = node.inputs.get("Base Color")
                    has_texture = (base_in and base_in.is_linked) or self._is_mtl_textured_material_name(mat.name, mtl_textured)
                    if not has_texture:
                        continue

                    changes = []

                    metal_in = node.inputs.get("Metallic")
                    if metal_in and not metal_in.is_linked:
                        val = float(metal_in.default_value)
                        if val > 0.001:
                            metal_in.default_value = 0.0
                            changes.append(f"Metallic {val:.3f}→0")

                    rough_in = node.inputs.get("Roughness")
                    if rough_in and not rough_in.is_linked:
                        val = float(rough_in.default_value)
                        if val < 0.85:
                            rough_in.default_value = 0.85
                            changes.append(f"Roughness {val:.2f}→0.85")

                    spec_in = node.inputs.get("Specular") or node.inputs.get("Specular IOR Level")
                    if spec_in and not spec_in.is_linked:
                        val = float(spec_in.default_value)
                        if val > 0.15:
                            spec_in.default_value = 0.15
                            changes.append(f"Specular {val:.2f}→0.15")

                    if changes:
                        adjusted += 1
                        reason = "MTL map_Kd" if self._is_mtl_textured_material_name(mat.name, mtl_textured) else "Base Color verlinkt"
                        self.log(f"Material '{mat.name}': {', '.join(changes)} ({reason} → dielektrisch)")

            if adjusted > 0:
                self.log(f"PBR korrigiert: {adjusted} texturierte(s) Material(ien) auf dielektrisch gesetzt")
        except Exception as e:
            self.log(f"Failed to enforce non-metallic for textured materials: {e}", "WARNING")
    
    def _apply_wood_to_chipboard_panels(self):
        """
        Detect and apply wood material to chipboard panels.
        Chipboard panels are typically:
        - Large flat surfaces (large XY area, small Z height)
        - White/light colored materials in OBJ files
        - High aspect ratio of base area to height
        
        This runs BEFORE scaling, so it works with proportions not absolute values.
        """
        try:
            # Environment configuration
            enabled = os.getenv('CHIPBOARD_DETECTION_ENABLED', 'true').lower() == 'true'
            if not enabled:
                return
            
            debug = os.getenv('CHIPBOARD_DETECTION_DEBUG', 'false').lower() == 'true'
            min_aspect_ratio = float(os.getenv('CHIPBOARD_MIN_ASPECT_RATIO', '10.0'))  # base/height ratio
            min_lightness = float(os.getenv('CHIPBOARD_MIN_LIGHTNESS', '0.75'))  # RGB average threshold
            min_relative_area = float(os.getenv('CHIPBOARD_MIN_RELATIVE_AREA', '2.0'))  # relative to average
            
            self.log(f"Chipboard detection: aspect_ratio>{min_aspect_ratio}, lightness>{min_lightness}, relative_area>{min_relative_area}")
            
            # Get chipboard texture
            script_dir = os.path.dirname(os.path.abspath(__file__))
            project_root = os.path.dirname(script_dir)
            chipboard_texture = os.path.join(project_root, 'data', 'textures', 'chipboard_1k.png')
            
            if not os.path.exists(chipboard_texture):
                self.log(f"Chipboard texture not found: {chipboard_texture}", "WARNING")
                return
            
            # Analyze all mesh objects
            mesh_objects = [obj for obj in bpy.data.objects if obj.type == 'MESH']
            if not mesh_objects:
                return
            
            # Calculate average base area for relative comparison
            total_area = 0
            for obj in mesh_objects:
                dims = obj.dimensions
                area = dims.x * dims.y
                total_area += area
            avg_area = total_area / len(mesh_objects) if mesh_objects else 1.0
            
            # If there are very few objects, relative area check is not meaningful
            use_relative_area = len(mesh_objects) >= 3
            
            if debug:
                self.log(f"Scene analysis: {len(mesh_objects)} mesh objects, avg_area={avg_area:.1f}, use_relative_area={use_relative_area}")
            
            candidates = []
            
            for obj in mesh_objects:
                dims = obj.dimensions
                
                # Skip objects with zero dimensions
                if dims.x < 0.001 or dims.y < 0.001 or dims.z < 0.001:
                    if debug:
                        self.log(f"Skipping '{obj.name}': zero dimensions {dims}")
                    continue
                
                # Calculate base area and aspect ratio
                base_area = dims.x * dims.y
                height = dims.z
                aspect_ratio = min(dims.x, dims.y) / height if height > 0 else 0
                relative_area = base_area / avg_area if avg_area > 0 else 0
                
                if debug:
                    self.log(f"Analyzing '{obj.name}': dims={dims}, aspect={aspect_ratio:.1f}, rel_area={relative_area:.1f}")
                
                # Check if ANY material is light colored
                is_light = False
                material_color = None
                light_materials = []
                
                for mat_slot in obj.material_slots:
                    mat = mat_slot.material
                    if mat and mat.use_nodes:
                        bsdf = mat.node_tree.nodes.get('Principled BSDF')
                        if bsdf:
                            base_color_input = bsdf.inputs.get('Base Color')
                            if base_color_input and hasattr(base_color_input, 'default_value'):
                                color = base_color_input.default_value
                                avg_lightness = (color[0] + color[1] + color[2]) / 3.0
                                if debug:
                                    self.log(f"  Material '{mat.name}': lightness={avg_lightness:.3f}, color={color[0]:.2f},{color[1]:.2f},{color[2]:.2f}")
                                if avg_lightness >= min_lightness:
                                    is_light = True
                                    material_color = (color[0], color[1], color[2])
                                    light_materials.append(mat.name)
                
                if debug:
                    self.log(f"  is_light={is_light}, aspect_ok={aspect_ratio >= min_aspect_ratio}, area_ok={relative_area >= min_relative_area or not use_relative_area}")
                
                # Candidate if: has light material AND flat (high aspect ratio) AND (relatively large OR few objects in scene)
                area_ok = not use_relative_area or relative_area >= min_relative_area
                if is_light and aspect_ratio >= min_aspect_ratio and area_ok:
                    candidates.append({
                        'object': obj,
                        'aspect_ratio': aspect_ratio,
                        'relative_area': relative_area,
                        'material_color': material_color,
                        'light_materials': light_materials,
                        'dimensions': dims
                    })
                    self.log(f"Chipboard candidate: '{obj.name}' - aspect_ratio={aspect_ratio:.1f}, relative_area={relative_area:.1f}, light_mats={light_materials}")


            
            # Apply wood material to candidates
            applied_count = 0
            for candidate in candidates:
                obj = candidate['object']
                light_mat_names = candidate['light_materials']
                
                # Create or get wood material
                wood_mat_name = "Chipboard_Wood"
                wood_mat = bpy.data.materials.get(wood_mat_name)
                
                if not wood_mat:
                    wood_mat = bpy.data.materials.new(name=wood_mat_name)
                    wood_mat.use_nodes = True
                    nodes = wood_mat.node_tree.nodes
                    nodes.clear()
                    
                    # Create nodes
                    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
                    tex_node = nodes.new('ShaderNodeTexImage')
                    output = nodes.new('ShaderNodeOutputMaterial')
                    
                    # Load texture
                    try:
                        chipboard_image = bpy.data.images.load(chipboard_texture)
                        tex_node.image = chipboard_image
                    except Exception as e:
                        self.log(f"Failed to load chipboard texture: {e}", "ERROR")
                        continue
                    
                    # Set material properties (light wood – komplett matt)
                    bsdf.inputs['Base Color'].default_value = (0.78, 0.67, 0.51, 1.0)  # Light wood tone
                    bsdf.inputs['Roughness'].default_value = 0.85
                    bsdf.inputs['Metallic'].default_value = 0.0
                    
                    # Connect nodes
                    links = wood_mat.node_tree.links
                    links.new(tex_node.outputs['Color'], bsdf.inputs['Base Color'])
                    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
                    
                    # Position nodes
                    tex_node.location = (-300, 0)
                    bsdf.location = (0, 0)
                    output.location = (300, 0)
                
                # Replace light materials with wood material
                replaced_count = 0
                for i, mat_slot in enumerate(obj.material_slots):
                    if mat_slot.material and mat_slot.material.name in light_mat_names:
                        mat_slot.material = wood_mat
                        replaced_count += 1
                
                if replaced_count > 0:
                    applied_count += 1
                    self.log(f"Applied chipboard wood material to '{obj.name}' ({replaced_count} material slot(s) replaced)")

            
            if applied_count > 0:
                self.log(f"Applied chipboard wood material to {applied_count} panel(s)")
            else:
                self.log("No chipboard panels detected")
                
        except Exception as e:
            self.log(f"Failed to detect/apply chipboard panels: {e}", "WARNING")
            import traceback
            traceback.print_exc()
    
    def import_ply_file(self, ply_path: str) -> bool:
        """Importiere einen farbigen PLY-Mesh und übertrage Face-Farben als Vertex-Colors."""
        self.last_import_type = 'ply'
        self.last_import_color_attribute = None

        try:
            self.log(f"Importiere PLY: {ply_path}")
            if not os.path.exists(ply_path):
                self.log("PLY Datei nicht gefunden", "ERROR")
                return False

            vertices: List[Tuple[float, float, float]] = []
            faces: List[List[int]] = []
            face_colors: List[Tuple[int, int, int, int]] = []
            color_histogram: Dict[Tuple[int, int, int, int], int] = {}  # Count occurrences

            with open(ply_path, 'r', encoding='utf-8') as handle:
                vertex_count: Optional[int] = None
                face_count: Optional[int] = None

                while True:
                    line = handle.readline()
                    if not line:
                        raise ValueError("Unerwartetes Dateiende im PLY-Header vor 'end_header'")
                    stripped = line.strip()
                    if stripped.startswith('element vertex'):
                        parts = stripped.split()
                        vertex_count = int(parts[2])
                    elif stripped.startswith('element face'):
                        parts = stripped.split()
                        face_count = int(parts[2])
                    elif stripped == 'end_header':
                        break

                if vertex_count is None or face_count is None:
                    raise ValueError("PLY-Header enthält keine Vertex/Face-Anzahl")

                for idx in range(vertex_count):
                    line = handle.readline()
                    if not line:
                        raise ValueError("PLY-Datei endet vor Abschluss der Vertex-Liste")
                    parts = line.strip().split()
                    if len(parts) < 3:
                        raise ValueError(f"Ungültige Vertex-Zeile bei Index {idx}: {line!r}")
                    x, y, z = map(float, parts[:3])
                    vertices.append((x, y, z))

                for idx in range(face_count):
                    line = handle.readline()
                    if not line:
                        raise ValueError("PLY-Datei endet vor Abschluss der Face-Liste")
                    parts = line.strip().split()
                    if len(parts) < 4:
                        continue
                    corner_count = int(parts[0])
                    if corner_count < 3:
                        continue
                    indices = [int(parts[i + 1]) for i in range(corner_count)]
                    color_values = parts[1 + corner_count:]
                    if len(color_values) >= 4:
                        r, g, b, a = (int(color_values[0]), int(color_values[1]), int(color_values[2]), int(color_values[3]))
                    else:
                        r = g = b = 230
                        a = 255

                    if corner_count == 3:
                        faces.append(indices)
                        face_colors.append((r, g, b, a))
                    else:
                        # Dreiecke per Fächerbildung erzeugen
                        for fan_idx in range(1, corner_count - 1):
                            faces.append([indices[0], indices[fan_idx], indices[fan_idx + 1]])
                            face_colors.append((r, g, b, a))

            if not vertices or not faces:
                self.log("PLY-Datei enthält keine verwertbare Geometrie", "ERROR")
                return False

            mesh_name = Path(ply_path).stem or "PLYMesh"
            mesh = bpy.data.meshes.new(f"{mesh_name}_Mesh")
            mesh.from_pydata(vertices, [], faces)
            mesh.validate()
            mesh.update()

            # Apply color mapping to face colors if enabled
            mapped_face_colors = face_colors
            if self.color_mapping_enabled and face_colors:
                # Build color histogram
                for color in face_colors:
                    color_histogram[color] = color_histogram.get(color, 0) + 1
                
                # Find dominant colors (top 10 for performance)
                dominant_colors = sorted(color_histogram.items(), key=lambda x: x[1], reverse=True)[:10]
                
                # Create color mapping for dominant colors
                color_map = {}
                mapped_count = 0
                
                for dom_color, count in dominant_colors:
                    # Convert byte color to float [0-1]
                    rgb_float = (dom_color[0] / 255.0, dom_color[1] / 255.0, dom_color[2] / 255.0)
                    match = self._find_nearest_standard_color(rgb_float)
                    
                    if match:
                        # Store mapping as byte color
                        mapped_byte = (
                            int(match['rgb'][0] * 255),
                            int(match['rgb'][1] * 255),
                            int(match['rgb'][2] * 255),
                            dom_color[3]  # Preserve alpha
                        )
                        color_map[dom_color] = mapped_byte
                        mapped_count += count
                        
                        source_hex = self._rgb_float_to_hex(rgb_float)
                        self.log(f"PLY Color mapping: {source_hex} → {match['name']} ({count} faces, dist={match['distance']:.3f})")
                        
                        # Track statistics
                        self.color_mapping_stats['mapped'] += count
                        mapping_key = f"{match['name']}"
                        self.color_mapping_stats['mappings'][mapping_key] = self.color_mapping_stats['mappings'].get(mapping_key, 0) + count
                
                # Apply mapping to all face colors
                if color_map:
                    mapped_face_colors = [color_map.get(c, c) for c in face_colors]
                    self.log(f"PLY Color mapping: {mapped_count}/{len(face_colors)} faces mapped to standard colors")
                    self.color_mapping_stats['total'] += len(face_colors)
            
            attr_name = "face_color"
            use_vertex_colors = not hasattr(mesh, 'color_attributes')

            if not use_vertex_colors:
                try:
                    color_layer = mesh.color_attributes.new(name=attr_name, type='BYTE_COLOR', domain='CORNER')
                except RuntimeError:
                    color_layer = mesh.color_attributes.new(name=attr_name, type='FLOAT_COLOR', domain='CORNER')
                data_layer = color_layer.data
            else:
                color_layer = mesh.vertex_colors.new(name=attr_name)
                data_layer = color_layer.data

            for poly_index, poly in enumerate(mesh.polygons):
                color = mapped_face_colors[min(poly_index, len(mapped_face_colors) - 1)]
                normalized = (color[0] / 255.0, color[1] / 255.0, color[2] / 255.0, color[3] / 255.0)
                start = poly.loop_start
                end = start + poly.loop_total
                for loop_idx in range(start, end):
                    data_layer[loop_idx].color = normalized

            if not use_vertex_colors:
                try:
                    mesh.color_attributes.active_color = color_layer
                    mesh.color_attributes.active = color_layer
                    mesh.color_attributes.active_render = color_layer
                except Exception:
                    pass
            else:
                try:
                    mesh.vertex_colors.active = color_layer
                except Exception:
                    pass

            obj = bpy.data.objects.new(mesh_name, mesh)
            bpy.context.collection.objects.link(obj)

            material = bpy.data.materials.new(name=f"{mesh_name}_Mat")
            material.use_nodes = True
            nodes = material.node_tree.nodes
            links = material.node_tree.links
            nodes.clear()

            output = nodes.new('ShaderNodeOutputMaterial')
            output.location = (300, 0)
            principled = nodes.new('ShaderNodeBsdfPrincipled')
            principled.location = (0, 0)

            attr_identifier = getattr(color_layer, 'name', attr_name)

            try:
                if not use_vertex_colors:
                    attr_node = nodes.new('ShaderNodeAttribute')
                    attr_node.attribute_name = attr_identifier
                else:
                    attr_node = nodes.new('ShaderNodeVertexColor')
                    attr_node.layer_name = attr_identifier
            except Exception:
                attr_node = nodes.new('ShaderNodeVertexColor')
                attr_node.layer_name = attr_identifier

            attr_node.location = (-300, 0)
            links.new(attr_node.outputs['Color'], principled.inputs['Base Color'])
            links.new(principled.outputs['BSDF'], output.inputs['Surface'])
            principled.inputs['Specular'].default_value = 0.05
            principled.inputs['Roughness'].default_value = 0.45

            obj.data.materials.append(material)

            self.last_import_color_attribute = attr_identifier

            try:
                bpy.context.view_layer.objects.active = obj
                obj.select_set(True)
                bpy.ops.object.shade_smooth()
                obj.select_set(False)
            except Exception:
                pass

            self._log_mesh_inventory("PLY-IMPORT")
            self._log_material_summary("PLY-IMPORT")
            return True
        except Exception as exc:
            self.log(f"PLY Import fehlgeschlagen: {exc}", "ERROR")
            return False

    def setup_texture_node(self, nodes, links, principled_node, tex_type: str, texture_path: str, x_offset: int):
        """
        Create and setup a texture node for the given texture type.
        Falls back to standard chipboard texture if the referenced texture is missing.
        """
        # Check if texture file exists
        if not os.path.exists(texture_path):
            self.log(f"Texture not found: {texture_path}", "WARNING")
            
            # Use fallback chipboard texture for diffuse/base color
            if tex_type == 'diffuse':
                script_dir = os.path.dirname(os.path.abspath(__file__))
                project_root = os.path.dirname(script_dir)
                fallback_texture = os.path.join(project_root, 'data', 'textures', 'chipboard_1k.png')
                
                if os.path.exists(fallback_texture):
                    self.log(f"Using fallback chipboard texture: {fallback_texture}")
                    texture_path = fallback_texture
                else:
                    self.log(f"Fallback texture not found: {fallback_texture}", "ERROR")
                    return
            else:
                # For other texture types, skip if file doesn't exist
                return
        
        self.log(f"Setting up {tex_type} texture: {Path(texture_path).name}")
        
        # Load image
        try:
            image = bpy.data.images.load(texture_path)
        except Exception as e:
            self.log(f"Failed to load texture {texture_path}: {str(e)}", "ERROR")
            return
        
        # Create texture node
        tex_node = nodes.new(type='ShaderNodeTexImage')
        tex_node.image = image
        tex_node.location = (x_offset, 0)
        
        # Connect texture based on type
        if tex_type == 'diffuse':
            links.new(tex_node.outputs['Color'], principled_node.inputs['Base Color'])
        elif tex_type == 'normal':
            # Create normal map node
            normal_map = nodes.new(type='ShaderNodeNormalMap')
            normal_map.location = (x_offset + 200, -200)
            links.new(tex_node.outputs['Color'], normal_map.inputs['Color'])
            links.new(normal_map.outputs['Normal'], principled_node.inputs['Normal'])
            # Set texture to non-color data
            image.colorspace_settings.name = 'Non-Color'
        elif tex_type == 'roughness':
            links.new(tex_node.outputs['Color'], principled_node.inputs['Roughness'])
            image.colorspace_settings.name = 'Non-Color'
        elif tex_type == 'metallic':
            links.new(tex_node.outputs['Color'], principled_node.inputs['Metallic'])
            image.colorspace_settings.name = 'Non-Color'
        elif tex_type == 'emission':
            links.new(tex_node.outputs['Color'], principled_node.inputs['Emission'])
        elif tex_type == 'specular':
            links.new(tex_node.outputs['Color'], principled_node.inputs['Specular'])
            image.colorspace_settings.name = 'Non-Color'
        elif tex_type == 'displacement':
            # Create displacement setup
            disp_node = nodes.new(type='ShaderNodeDisplacement')
            disp_node.location = (x_offset + 200, -400)
            links.new(tex_node.outputs['Color'], disp_node.inputs['Height'])
            # Note: Displacement would be connected to Material Output displacement input
            image.colorspace_settings.name = 'Non-Color'
    
    def apply_ai_material_properties(self, principled_node, ai_properties: Dict[str, Any]):
        """
        Apply AI-suggested material properties to Principled BSDF
        """
        self.log(f"Applying AI material properties: {ai_properties}")
        
        if 'roughness' in ai_properties:
            principled_node.inputs['Roughness'].default_value = ai_properties['roughness']
        
        if 'metallic' in ai_properties:
            principled_node.inputs['Metallic'].default_value = ai_properties['metallic']
        
        if 'specular' in ai_properties:
            principled_node.inputs['Specular'].default_value = ai_properties['specular']
        
        if 'base_color' in ai_properties:
            color = ai_properties['base_color']
            if isinstance(color, list) and len(color) >= 3:
                principled_node.inputs['Base Color'].default_value = (*color, 1.0)
    
    def create_default_material(self):
        """
        Create a default PBR material for objects without materials
        """
        self.log("Creating default PBR material")
        
        material = bpy.data.materials.new(name="Default_PBR")
        material.use_nodes = True
        
        nodes = material.node_tree.nodes
        principled = nodes.get("Principled BSDF")
        
        if principled:
            principled.inputs['Roughness'].default_value = 0.5
            principled.inputs['Metallic'].default_value = 0.0
        
        # Apply to all objects without materials
        for obj in bpy.context.scene.objects:
            if obj.type == 'MESH' and not obj.data.materials:
                obj.data.materials.append(material)

    def process_materials_and_textures(self, texture_files: List[str], use_ai: bool):
        """Erzeuge/vereinheitliche Principled Materialien und mappe übergebene Texturen heuristisch.
        texture_files: Liste von Dateipfaden
        use_ai: falls AI Materialerkennung aktiv ist.
        """
        try:
            # Falls keine Materialien existieren -> Default erstellen
            if not bpy.data.materials:
                self.create_default_material()

            # Texturen nach Typ klassifizieren (einfacher Namens-Check)
            classified: Dict[str, str] = {}
            unclassified: List[str] = []
            for path in texture_files:
                fn = os.path.basename(path).lower()
                if 'diff' in fn or 'albedo' in fn or 'basecolor' in fn:
                    classified.setdefault('diffuse', path)
                elif 'norm' in fn:
                    classified.setdefault('normal', path)
                elif 'rough' in fn:
                    classified.setdefault('roughness', path)
                elif 'metal' in fn:
                    classified.setdefault('metallic', path)
                elif 'emit' in fn or 'emiss' in fn or 'glow' in fn:
                    classified.setdefault('emission', path)
                elif 'spec' in fn:
                    classified.setdefault('specular', path)
                elif 'disp' in fn or 'height' in fn:
                    classified.setdefault('displacement', path)
                else:
                    unclassified.append(path)

            # Fallback: unklassifizierte Bilder als Diffuse/Base Color verwenden
            if 'diffuse' not in classified and unclassified:
                classified['diffuse'] = unclassified[0]
                self.log(f"Textur ohne Typ-Erkennung als Diffuse/Base Color zugeordnet: {os.path.basename(unclassified[0])}")

            # Für jedes Material Principled sicherstellen & Texturen verbinden
            for mat in bpy.data.materials:
                if not mat.use_nodes:
                    mat.use_nodes = True
                nodes = mat.node_tree.nodes
                links = mat.node_tree.links
                principled = None
                for n in nodes:
                    if n.type == 'BSDF_PRINCIPLED':
                        principled = n
                        break
                if principled is None:
                    principled = nodes.new(type='ShaderNodeBsdfPrincipled')
                    principled.location = (0,0)
                # AI Eigenschaften anwenden falls möglich
                if use_ai and self.ai_recognizer and classified.get('diffuse'):
                    try:
                        props = self.ai_recognizer.analyze_material(classified['diffuse'])
                        self.apply_ai_material_properties(principled, props)
                    except Exception as e:
                        self.log(f"AI Analyse fehlgeschlagen: {str(e)}", "WARNING")
                # Texturknoten aufbauen – MTL-Zuordnung respektieren:
                # Diffuse-Textur nur auf Materialien anwenden, deren Base Color
                # bereits verknüpft ist (= MTL hatte map_Kd). Materialien mit
                # reinem Farbwert (Kd) werden nicht überschrieben.
                x_offset = -800
                for tex_type, tex_path in classified.items():
                    if tex_type == 'diffuse':
                        base_input = principled.inputs.get('Base Color')
                        if base_input and not base_input.is_linked:
                            # Nur Farbwert (MTL: Kd ohne map_Kd) → nicht überschreiben
                            self.log(f"Material '{mat.name}': Base Color ist reiner Farbwert – Textur wird nicht aufgezwungen")
                            x_offset += 300
                            continue
                        if base_input and base_input.is_linked:
                            src_node = base_input.links[0].from_node
                            if src_node.type == 'TEX_IMAGE' and src_node.image:
                                img_path = src_node.image.filepath or ''
                                img_name = (src_node.image.name or '').lower()
                                is_chipboard = 'chipboard' in img_name or 'chipboard' in img_path.lower()
                                if not is_chipboard and os.path.exists(bpy.path.abspath(img_path)):
                                    self.log(f"Material '{mat.name}': Base Color hat bereits gültige Textur '{src_node.image.name}' – überspringe")
                                    x_offset += 300
                                    continue
                                # Chipboard-Fallback oder fehlende Textur → ersetzen
                                self.log(f"Material '{mat.name}': Ersetze {'Chipboard-Fallback' if is_chipboard else 'fehlende Textur'} durch hochgeladene Textur")
                                links.remove(base_input.links[0])
                                nodes.remove(src_node)
                    self.setup_texture_node(nodes, links, principled, tex_type, tex_path, x_offset)
                    x_offset += 300
                # Materialien ohne Textur auf Base Color: Verzinkt-Look setzen
                # (typisch für Metallteile die laut MTL nur Kd-Farbwert haben).
                # Materialien MIT Textur bekommen nur dezente Nicht-Metall-Defaults.
                base_input = principled.inputs.get('Base Color')
                has_texture = base_input and base_input.is_linked
                if has_texture:
                    # Bild-Textur (Holz/Dekor) → dielektrisch, komplett matt
                    principled.inputs['Metallic'].default_value = 0.0
                    principled.inputs['Roughness'].default_value = 0.85
                    spec_in = principled.inputs.get('Specular') or principled.inputs.get('Specular IOR Level')
                    if spec_in:
                        spec_in.default_value = 0.15
                else:
                    principled.inputs['Metallic'].default_value = 0.35
                    principled.inputs['Roughness'].default_value = 0.35
                    specular_input = principled.inputs.get('Specular') or principled.inputs.get('Specular IOR Level')
                    if specular_input:
                        specular_input.default_value = 0.45
            self.log(f"Materialverarbeitung abgeschlossen (Materialien: {len(bpy.data.materials)}, Texturen klassifiziert: {len(classified)})")
        except Exception as e:
            self.log(f"Material/Textur Verarbeitung fehlgeschlagen: {str(e)}", "WARNING")
    
    def rotate_to_y_up(self):
        """
        Rotate all mesh objects 90 degrees around X-axis to convert from Z-up to Y-up coordinate system.
        This is needed for engines like Unity, Unreal, etc. that use Y-up instead of Z-up.
        """
        try:
            import math
            
            mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
            
            for obj in mesh_objects:
                # Apply -90 degree rotation around X-axis (changed from +90)
                obj.rotation_euler[0] += math.radians(-90)
            
            # Apply rotation to make it permanent
            if mesh_objects:
                bpy.ops.object.select_all(action='DESELECT')
                for obj in mesh_objects:
                    obj.select_set(True)
                bpy.context.view_layer.objects.active = mesh_objects[0]
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
            
            self.log(f"Applied -90° X-rotation to {len(mesh_objects)} objects (Z-up → Y-up conversion)")
            
        except Exception as e:
            self.log(f"Failed to rotate objects to Y-up: {str(e)}", "ERROR")
            raise

    def apply_export_axis_rotation(self, axis: str, degrees: int):
        """
        Apply optional export rotation around X, Y or Z axis by 90, 180, or 270 degrees.
        Mutually exclusive with rotate_y_up. Caller must ensure only one is used.
        Negative direction so that "90°" in UI corrects orientation (avoids upside-down result).
        """
        if axis not in ('X', 'Y', 'Z') or degrees not in (90, 180, 270):
            return
        try:
            mesh_objects = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
            if not mesh_objects:
                return
            rad = -math.radians(degrees)  # negative so UI "90°" gives correct upright result
            idx = 0 if axis == 'X' else (1 if axis == 'Y' else 2)
            for obj in mesh_objects:
                obj.rotation_euler[idx] += rad
            bpy.ops.object.select_all(action='DESELECT')
            for obj in mesh_objects:
                obj.select_set(True)
            bpy.context.view_layer.objects.active = mesh_objects[0]
            bpy.ops.object.transform_apply(location=True, rotation=True, scale=False)
            self.log(f"Applied {degrees}° {axis}-axis rotation to {len(mesh_objects)} objects")
        except Exception as e:
            self.log(f"Failed to apply export axis rotation: {str(e)}", "ERROR")
            raise

    def bake_root_transforms_to_meshes(self):
        """
        Einbrennen aller Root-/Parent-Transforms in die Mesh-Daten, damit das exportierte
        GLB echtes Y-up hat (keine Root-Node-Rotation). Alle Mesh-Objekte werden
        entparentet (behalten Welt-Transform), dann wird der Transform auf die
        Vertex-Daten angewendet und die Node-Transform auf Identity gesetzt.
        """
        try:
            scene = bpy.context.scene
            mesh_objects = [obj for obj in scene.objects if obj.type == 'MESH']
            if not mesh_objects:
                self.log("bake_root_transforms: Keine Mesh-Objekte vorhanden", "WARNING")
                return
            # Entparenten: jedes Mesh behält seine Welt-Transform (matrix_local wird = ehemalige matrix_world)
            for obj in mesh_objects:
                obj.parent = None
            self.log(f"bake_root_transforms: {len(mesh_objects)} Meshes entparentet, wende Transform an …")
            for obj in mesh_objects:
                bpy.ops.object.select_all(action='DESELECT')
                obj.select_set(True)
                scene.view_layers[0].objects.active = obj
                bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            self.log(f"bake_root_transforms: Root-Anpassung in {len(mesh_objects)} Meshes eingebrannt (echtes Y-up)")
        except Exception as e:
            self.log(f"bake_root_transforms fehlgeschlagen: {str(e)}", "ERROR")
            raise

    def optimize_for_export(self, scale: float = 1.0, decimate_ratio: float = 1.0):
        """
        Optimize the scene for GLB export
        Args:
            scale: Scale factor for the model (e.g., 0.01 for 1% size)
            decimate_ratio: Polygon reduction ratio (0.1 = 10%, 1.0 = 100% keep all)
        """
        self.log("Optimizing scene for GLB export")
        
        # Apply scaling if needed
        if scale != 1.0:
            self.log(f"Applying scale factor: {scale}")
            import mathutils

            # Helper: compute scene bounds (for diagnostics)
            def _scene_bounds():
                from mathutils import Vector
                min_v = Vector((float('inf'), float('inf'), float('inf')))
                max_v = Vector((float('-inf'), float('-inf'), float('-inf')))
                any_mesh = False
                for o in bpy.context.scene.objects:
                    if o.type != 'MESH':
                        continue
                    any_mesh = True
                    for corner in o.bound_box:
                        world_corner = o.matrix_world @ mathutils.Vector(corner)
                        min_v.x = min(min_v.x, world_corner.x)
                        min_v.y = min(min_v.y, world_corner.y)
                        min_v.z = min(min_v.z, world_corner.z)
                        max_v.x = max(max_v.x, world_corner.x)
                        max_v.y = max(max_v.y, world_corner.y)
                        max_v.z = max(max_v.z, world_corner.z)
                return any_mesh, min_v, max_v

            had_mesh, pre_min, pre_max = _scene_bounds()
            if had_mesh:
                pre_size = (pre_max.x - pre_min.x, pre_max.y - pre_min.y, pre_max.z - pre_min.z)
                self.log(f"Bounds before scale: size={pre_size} min={tuple(round(v,4) for v in pre_min)} max={tuple(round(v,4) for v in pre_max)}")

            # Create a 4x4 scale matrix and apply to object transforms
            scale_m4 = mathutils.Matrix.Scale(scale, 4)

            mesh_objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
            for o in mesh_objects:
                o.matrix_world = scale_m4 @ o.matrix_world

            # Bake the object scale into mesh data to make it permanent
            if mesh_objects:
                bpy.ops.object.select_all(action='DESELECT')
                for o in mesh_objects:
                    o.select_set(True)
                bpy.context.view_layer.objects.active = mesh_objects[0]
                try:
                    bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)
                except Exception as e:
                    self.log(f"Failed to apply object transforms: {str(e)}", "WARNING")

            had_mesh, post_min, post_max = _scene_bounds()
            if had_mesh:
                post_size = (post_max.x - post_min.x, post_max.y - post_min.y, post_max.z - post_min.z)
                self.log(f"Bounds after scale:  size={post_size} min={tuple(round(v,4) for v in post_min)} max={tuple(round(v,4) for v in post_max)}")
                self.log(f"Scaled {len(mesh_objects)} mesh objects by updating transforms and applying scale")
        else:
            self.log("Scale is 1.0 (no scaling applied). If you expected scaling, ensure the 'scale' parameter is forwarded correctly.")
        
        # Apply decimation if needed
        if decimate_ratio < 1.0:
            self.log(f"Applying mesh decimation: {decimate_ratio * 100}% polygons")
            for obj in bpy.context.scene.objects:
                if obj.type == 'MESH':
                    # Add decimate modifier
                    decimate_mod = obj.modifiers.new(name="Decimate", type='DECIMATE')
                    decimate_mod.ratio = decimate_ratio
                    decimate_mod.use_collapse_triangulate = True
                    
                    # Apply the modifier
                    bpy.context.view_layer.objects.active = obj
                    bpy.ops.object.select_all(action='DESELECT')
                    obj.select_set(True)
                    bpy.ops.object.modifier_apply(modifier=decimate_mod.name)
                    
                    poly_count = len(obj.data.polygons)
                    self.log(f"Decimated {obj.name}: {poly_count} polygons")

    def separate_loose_parts(self):
        """Separate loose mesh islands into individual objects if a single mesh contains multiple parts."""
        try:
            mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
            if len(mesh_objs) != 1:
                return
            o = mesh_objs[0]
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.separate(type='LOOSE')
            bpy.ops.object.mode_set(mode='OBJECT')
            self.log("Separated loose parts into individual objects")
        except Exception as e:
            self.log(f"Separate loose parts failed: {str(e)}", "WARNING")

    def _compute_world_bbox(self, obj):
        import mathutils
        corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
        xs = [c.x for c in corners]
        ys = [c.y for c in corners]
        zs = [c.z for c in corners]
        min_v = mathutils.Vector((min(xs), min(ys), min(zs)))
        max_v = mathutils.Vector((max(xs), max(ys), max(zs)))
        dims = (max_v.x - min_v.x, max_v.y - min_v.y, max_v.z - min_v.z)
        return min_v, max_v, dims

    def _get_material_avg_color(self, material):
        """Ermittle eine grobe Durchschnittsfarbe eines Materials.
        Priorität: verbundene Textur(en) → sonst Principled Base Color → None.
        """
        try:
            if not material:
                return None
            # Nodes durchsuchen
            if getattr(material, 'use_nodes', False) and material.node_tree:
                nodes = material.node_tree.nodes
                # Versuche Principled zu finden
                principled = nodes.get("Principled BSDF")
                if principled is None:
                    for n in nodes:
                        if getattr(n, 'type', '') == 'BSDF_PRINCIPLED':
                            principled = n
                            break
                # Falls Textur-Knoten vorhanden, sample einige Pixel
                tex_images = [n for n in nodes if getattr(n, 'type', '') == 'TEX_IMAGE' and getattr(n, 'image', None)]
                for tex in tex_images:
                    img = tex.image
                    try:
                        # pixels ist RGBA float-array [0..1]
                        px = img.pixels
                        length = len(px) // 4
                        if length <= 0:
                            continue
                        sample_count = min(64, length)
                        step = max(1, length // sample_count)
                        r = g = b = 0.0
                        cnt = 0
                        # gleichmäßig verteilt sampeln
                        for i in range(0, length, step):
                            base = i * 4
                            r += px[base]
                            g += px[base + 1]
                            b += px[base + 2]
                            cnt += 1
                            if cnt >= sample_count:
                                break
                        if cnt > 0:
                            return (r / cnt, g / cnt, b / cnt)
                    except Exception:
                        # Sampling auslassen und weiter
                        pass
                # Fallback: Principled Base Color
                if principled is not None:
                    try:
                        col = principled.inputs['Base Color'].default_value
                        if col and len(col) >= 3:
                            return (float(col[0]), float(col[1]), float(col[2]))
                    except Exception:
                        pass
                # Attribute-/Vertex-Color Materialien → Mittelwert aus Mesh-Attribut ermitteln
                try:
                    attr_nodes = [n for n in nodes if getattr(n, 'type', '') in ('ATTRIBUTE', 'VERTEX_COLOR')]
                    if attr_nodes:
                        attr_name = None
                        for candidate in attr_nodes:
                            attr_name = getattr(candidate, 'attribute_name', None) or getattr(candidate, 'layer_name', None)
                            if attr_name:
                                break
                        if attr_name:
                            for obj in bpy.data.objects:
                                if obj.type != 'MESH':
                                    continue
                                if not getattr(obj.data, 'materials', None):
                                    continue
                                if material not in obj.data.materials:
                                    continue
                                avg = self._get_mesh_color_attribute_avg(obj.data)
                                if avg:
                                    return avg
                except Exception:
                    pass
            # Kein Nodesetup → Alt: diffuse_color (älteres Blender)
            if hasattr(material, 'diffuse_color') and material.diffuse_color is not None:
                col = material.diffuse_color
                if len(col) >= 3:
                    return (float(col[0]), float(col[1]), float(col[2]))
        except Exception:
            pass
        return None

    def _get_mesh_color_attribute_avg(self, mesh):
        """Calculate an average RGB color from a mesh color attribute if present."""
        try:
            data_iter = None

            color_attrs = getattr(mesh, 'color_attributes', None)
            if color_attrs:
                color_layer = getattr(color_attrs, 'active_color', None)
                if color_layer is None and self.last_import_color_attribute:
                    try:
                        color_layer = color_attrs.get(self.last_import_color_attribute)
                    except Exception:
                        color_layer = None
                if color_layer is None and len(color_attrs) > 0:
                    color_layer = color_attrs[0]
                if color_layer and getattr(color_layer, 'data', None):
                    data_iter = color_layer.data

            if data_iter is None:
                vertex_colors = getattr(mesh, 'vertex_colors', None)
                if vertex_colors:
                    color_layer = getattr(vertex_colors, 'active', None)
                    if color_layer is None and self.last_import_color_attribute:
                        try:
                            color_layer = vertex_colors.get(self.last_import_color_attribute)
                        except Exception:
                            color_layer = None
                    if color_layer is None and len(vertex_colors) > 0:
                        color_layer = vertex_colors[0]
                    if color_layer and getattr(color_layer, 'data', None):
                        data_iter = color_layer.data

            if data_iter is None:
                return None

            total_r = total_g = total_b = 0.0
            count = 0
            for item in data_iter:
                col = getattr(item, 'color', None)
                if not col:
                    continue
                total_r += float(col[0])
                total_g += float(col[1])
                total_b += float(col[2])
                count += 1

            if count == 0:
                return None

            return (total_r / count, total_g / count, total_b / count)
        except Exception:
            return None

    def _score_material_finish(self, material):
        """Calculate heuristic scores for metallic vs powder-coated appearance."""
        if not material:
            return None

        signals = []
        metal_score = 0.0
        powder_score = 0.0

        name_lower = material.name.lower() if getattr(material, 'name', None) else ''
        for keyword in self.metal_keywords:
            if keyword in name_lower:
                metal_score += 3.0
                signals.append(f"metal-keyword:{keyword}")

        for keyword in self.powder_keywords:
            if keyword in name_lower:
                powder_score += 3.0
                signals.append(f"powder-keyword:{keyword}")

        principled = None
        if getattr(material, 'use_nodes', False) and material.node_tree:
            principled = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)

        metallic_value = 0.0
        roughness_value = 0.5
        specular_value = 0.25

        if principled:
            metallic_input = principled.inputs.get('Metallic')
            if metallic_input:
                metallic_value = float(metallic_input.default_value)
            roughness_input = principled.inputs.get('Roughness')
            if roughness_input:
                roughness_value = float(roughness_input.default_value)
            specular_input = principled.inputs.get('Specular') or principled.inputs.get('Specular IOR Level')
            if specular_input:
                specular_value = float(specular_input.default_value)

        base_color = self._get_material_avg_color(material)
        saturation = None
        value = None

        if base_color:
            try:
                hsv = colorsys.rgb_to_hsv(*base_color[:3])
                saturation = float(hsv[1])
                value = float(hsv[2])
            except Exception:
                saturation = None
                value = None

        if metallic_value >= 0.35:
            metal_score += 1.5
            signals.append('metallic>=0.35')
        elif metallic_value <= 0.1:
            powder_score += 0.2
            signals.append('metallic<=0.10')

        if roughness_value >= 0.55:
            powder_score += 1.0
            signals.append('roughness>=0.55')
        elif roughness_value <= 0.3:
            metal_score += 0.8
            signals.append('roughness<=0.30')

        if specular_value >= 0.5:
            metal_score += 0.4
            signals.append('specular>=0.50')
        elif specular_value <= 0.2:
            powder_score += 0.3
            signals.append('specular<=0.20')

        if saturation is not None:
            if saturation >= 0.25:
                powder_score += 1.2
                signals.append('saturation>=0.25')
            elif saturation <= 0.12:
                metal_score += 0.7
                signals.append('saturation<=0.12')

        if value is not None:
            if value >= 0.75 and (saturation or 0.0) >= 0.18:
                powder_score += 0.4
                signals.append('bright-colored')
            elif value <= 0.35 and (saturation or 0.0) <= 0.2:
                metal_score += 0.3
                signals.append('dark-neutral')

        return {
            'name': material.name,
            'baseColor': [round(c, 4) for c in base_color] if base_color else None,
            'metallicInput': round(metallic_value, 4),
            'roughnessInput': round(roughness_value, 4),
            'specularInput': round(specular_value, 4),
            'saturation': round(saturation, 4) if saturation is not None else None,
            'value': round(value, 4) if value is not None else None,
            'scores': {
                'metallic': round(metal_score, 3),
                'powderCoated': round(powder_score, 3)
            },
            'signals': signals
        }

    def analyze_material_finish(self):
        """Aggregate material heuristics to recommend a finish."""
        summaries = []
        total_metal = 0.0
        total_powder = 0.0

        for material in bpy.data.materials:
            summary = self._score_material_finish(material)
            if not summary:
                continue
            summaries.append(summary)
            total_metal += summary['scores']['metallic']
            total_powder += summary['scores']['powderCoated']

        dominant = 'unknown'
        recommended = 'standard'
        confidence = 0.0

        if total_metal > total_powder and total_metal > 0:
            dominant = 'metallic'
            recommended = 'galvanized'
        elif total_powder > total_metal and total_powder > 0:
            dominant = 'powder_coated'
            recommended = 'powder-coated'

        difference = abs(total_metal - total_powder)
        total = total_metal + total_powder
        if total > 0:
            confidence = round(min(max(difference / total, 0.0), 1.0), 3)

        return {
            'materialsAnalyzed': len(summaries),
            'dominantFinish': dominant,
            'recommendedFinish': recommended,
            'confidence': confidence,
            'scores': {
                'metallic': round(total_metal, 3),
                'powderCoated': round(total_powder, 3)
            },
            'materials': summaries
        }

    def _get_object_color_signature(self, obj):
        """Grobe Farb-Signatur des Objekts aus seinem (aktiven/ersten) Material."""
        try:
            mat = None
            if getattr(obj, 'active_material', None):
                mat = obj.active_material
            elif getattr(obj.data, 'materials', None) and len(obj.data.materials) > 0:
                mat = obj.data.materials[0]
            color = self._get_material_avg_color(mat)
            if color is None:
                color = self._get_mesh_color_attribute_avg(obj.data)
            return color
        except Exception:
            return None

    def _apply_plastic_to_caps(self):
        """Apply plastic material to detected cap objects (Kappe_*).
        
        This function scans for objects that have been labeled as caps by
        label_structural_parts() and applies a non-metallic plastic material
        to visually distinguish them from metallic posts and beams.
        
        Environment Variables:
            AUTO_PLASTIC_CAPS: Enable/disable automatic plastic material (default: true)
            PLASTIC_CAP_COLOR_R: Red component 0.0-1.0 (default: 0.8 - bright red for testing)
            PLASTIC_CAP_COLOR_G: Green component 0.0-1.0 (default: 0.1 - bright red for testing)
            PLASTIC_CAP_COLOR_B: Blue component 0.0-1.0 (default: 0.1 - bright red for testing)
            PLASTIC_CAP_FALLBACK: Also apply to small flat objects that weren't labeled as caps (default: false)
            PLASTIC_CAP_MAX_SIZE: Max size in mm for fallback detection (default: 60)
            PLASTIC_CAP_MAX_ASPECT: Max aspect ratio for fallback detection (default: 2.5)
        """
        print("[INFO] _apply_plastic_to_caps() called")
        try:
            # Check if feature is enabled
            auto_plastic = os.environ.get('AUTO_PLASTIC_CAPS', 'true').lower() in ('true', '1', 'yes')
            if not auto_plastic:
                print("[INFO] Plastic caps feature is disabled (AUTO_PLASTIC_CAPS=false)")
                return
            
            # Hellgrau-Plastik (ca. RAL 7035 Lichtgrau, sRGB ~0.84 → linear ~0.67)
            cap_color = (
                float(os.environ.get('PLASTIC_CAP_COLOR_R', '0.67')),
                float(os.environ.get('PLASTIC_CAP_COLOR_G', '0.67')),
                float(os.environ.get('PLASTIC_CAP_COLOR_B', '0.67')),
                1.0  # Alpha
            )
            
            # Default material properties for plastic (very matte, non-metallic)
            plastic_metallic = 0.0
            plastic_roughness = 0.9  # Very high roughness for matte plastic look
            
            # Fallback mode: also treat small flat objects as caps
            fallback_mode = os.environ.get('PLASTIC_CAP_FALLBACK', 'false').lower() in ('true', '1', 'yes')
            fallback_max_size = float(os.environ.get('PLASTIC_CAP_MAX_SIZE', '60.0'))  # mm
            fallback_max_aspect = float(os.environ.get('PLASTIC_CAP_MAX_ASPECT', '2.5'))
            
            cap_count = 0
            fallback_count = 0
            
            # First pass: Apply to labeled caps (Kappe_*)
            for obj in bpy.context.scene.objects:
                # Check if object is a mesh and has been labeled as a cap
                if obj.type != 'MESH':
                    continue
                    
                if not obj.name.startswith('Kappe_'):
                    continue
                
                # Apply plastic material
                # Ensure the object has a material slot
                if len(obj.data.materials) == 0:
                    mat = bpy.data.materials.new(name=f"{obj.name}_Plastic")
                    obj.data.materials.append(mat)
                else:
                    mat = obj.data.materials[0]
                    if mat is None:
                        mat = bpy.data.materials.new(name=f"{obj.name}_Plastic")
                        obj.data.materials[0] = mat
                
                # Ensure material uses nodes
                mat.use_nodes = True
                nodes = mat.node_tree.nodes
                links = mat.node_tree.links
                
                # Find or create Principled BSDF
                bsdf = None
                for node in nodes:
                    if node.type == 'BSDF_PRINCIPLED':
                        bsdf = node
                        break
                
                if bsdf is None:
                    bsdf = nodes.new('ShaderNodeBsdfPrincipled')
                    output = nodes.get('Material Output')
                    if output:
                        links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
                
                # Set plastic properties
                bsdf.inputs['Base Color'].default_value = cap_color
                bsdf.inputs['Metallic'].default_value = plastic_metallic
                bsdf.inputs['Roughness'].default_value = plastic_roughness
                
                cap_count += 1
                print(f"Applied plastic material to cap: {obj.name} (color: RGB{cap_color[:3]}, metallic: {plastic_metallic}, roughness: {plastic_roughness})")
            
            # Second pass: Fallback for small flat objects if enabled
            if fallback_mode:
                print(f"[INFO] Fallback mode enabled - checking for small flat objects (max_size={fallback_max_size}mm, max_aspect={fallback_max_aspect})")
                for obj in bpy.context.scene.objects:
                    if obj.type != 'MESH':
                        continue
                    
                    # Skip if already processed as labeled cap
                    if obj.name.startswith('Kappe_'):
                        continue
                    
                    # Skip posts and beams
                    if obj.name.startswith('Pfosten_') or obj.name.startswith('Strebe_'):
                        continue
                    
                    # Check geometry: small and relatively flat
                    dims = obj.dimensions
                    if dims.length == 0:
                        continue
                    
                    # Get dimensions in mm (assuming scene units)
                    dx, dy, dz = abs(dims.x), abs(dims.y), abs(dims.z)
                    sorted_dims = sorted([dx, dy, dz])
                    smallest, mid, largest = sorted_dims[0], sorted_dims[1], sorted_dims[2]
                    
                    # Check if it's small enough
                    if largest > fallback_max_size:
                        continue
                    
                    # Check if it's relatively flat (smallest dimension much smaller than others)
                    if smallest > 0 and largest / smallest > fallback_max_aspect:
                        # This is a flat object, apply plastic material
                        if len(obj.data.materials) == 0:
                            mat = bpy.data.materials.new(name=f"{obj.name}_Plastic")
                            obj.data.materials.append(mat)
                        else:
                            mat = obj.data.materials[0]
                            if mat is None:
                                mat = bpy.data.materials.new(name=f"{obj.name}_Plastic")
                                obj.data.materials[0] = mat
                        
                        mat.use_nodes = True
                        nodes = mat.node_tree.nodes
                        links = mat.node_tree.links
                        
                        bsdf = None
                        for node in nodes:
                            if node.type == 'BSDF_PRINCIPLED':
                                bsdf = node
                                break
                        
                        if bsdf is None:
                            bsdf = nodes.new('ShaderNodeBsdfPrincipled')
                            output = nodes.get('Material Output')
                            if output:
                                links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
                        
                        bsdf.inputs['Base Color'].default_value = cap_color
                        bsdf.inputs['Metallic'].default_value = plastic_metallic
                        bsdf.inputs['Roughness'].default_value = plastic_roughness
                        
                        fallback_count += 1
                        print(f"Applied plastic material to small flat object (fallback): {obj.name} (dims: {dx:.1f}x{dy:.1f}x{dz:.1f}mm, aspect: {largest/smallest:.1f})")
            
            # Log results
            total_mesh_objects = len([o for o in bpy.context.scene.objects if o.type == 'MESH'])
            if cap_count > 0:
                print(f"[INFO] Total labeled caps with plastic material: {cap_count} (out of {total_mesh_objects} mesh objects)")
            if fallback_count > 0:
                print(f"[INFO] Total fallback caps with plastic material: {fallback_count}")
            if cap_count == 0 and fallback_count == 0:
                print(f"[INFO] No caps found to apply plastic material (searched {total_mesh_objects} mesh objects)")
                if not fallback_mode:
                    print(f"[INFO] Hint: Set PLASTIC_CAP_FALLBACK=true to also treat small flat objects as caps")
        
        except Exception as e:
            print(f"Warning: Failed to apply plastic to caps: {e}")
            import traceback
            traceback.print_exc()

    def label_structural_parts(self):
        """Assign heuristic labels (Pfosten, Strebe, Fuß, Kappe) to mesh objects based on geometry and placement.
        Tuning-Hinweise:
          - LABEL_DEBUG=1 in Env: mehr Detail-Logs pro Objekt
        """
        try:
            import math
            mesh_objs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
            if not mesh_objs:
                return
            # Global bounds
            global_min_z = math.inf
            global_max_z = -math.inf
            dims_cache = {}
            colors_cache = {}
            for o in mesh_objs:
                min_v, max_v, dims = self._compute_world_bbox(o)
                dims_cache[o.name] = (min_v, max_v, dims)
                # Farbsignatur erfassen (optional, kann None sein)
                colors_cache[o.name] = self._get_object_color_signature(o)
                global_min_z = min(global_min_z, min_v.z)
                global_max_z = max(global_max_z, max_v.z)
            scene_h = max(global_max_z - global_min_z, 1e-6)

            # Pfosten-Kandidaten (vertikal, schlank, startet nahe Boden)
            pfosten = []
            for o in mesh_objs:
                min_v, max_v, (dx, dy, dz) = dims_cache[o.name]
                horiz = max(dx, dy)
                # etwas toleranter am Boden, und geringere Schlankheitsanforderung
                if dz > 2.5 * horiz and (min_v.z - global_min_z) < 0.10 * scene_h:
                    pfosten.append(o)

            def nearest_pfosten(xy):
                best, best_d = None, math.inf
                for p in pfosten:
                    pm, pM, _ = dims_cache[p.name]
                    pc = ((pm.x + pM.x) / 2.0, (pm.y + pM.y) / 2.0)
                    d = math.dist(xy, pc)
                    if d < best_d:
                        best, best_d = p, d
                return best, best_d

            # Zähler für eindeutige Namen
            counters = {"Pfosten": 0, "Strebe": 0, "Fuß": 0, "Kappe": 0, "Wand": 0, "Teil": 0}

            # Vorberechnungen für Pfosten-Fußabdrücke und Volumen (grobe Näherung)
            post_info = {}
            for p in pfosten:
                pm, pM, (pdx, pdy, pdz) = dims_cache[p.name]
                post_info[p.name] = {
                    "center_xy": ((pm.x + pM.x) / 2.0, (pm.y + pM.y) / 2.0),
                    "footprint": max(pdx, pdy),
                    "vol": max(pdx, 1e-6) * max(pdy, 1e-6) * max(pdz, 1e-6)
                }

            debug = os.environ.get('LABEL_DEBUG', '0') == '1'
            use_material = os.environ.get('LABEL_USE_MATERIAL', '1') == '1'
            color_diff_thresh = float(os.environ.get('LABEL_COLOR_DIFF_THRESHOLD', '0.18'))
            # Neue Fuß-Erkennungs-Parameter (anpassbar über Env)
            foot_max_scene_ratio = float(os.environ.get('LABEL_FUSS_MAX_SCENE_RATIO', '0.22'))  # maximale Fußhöhe relativ zur Szenenhöhe
            foot_base_max_ratio = float(os.environ.get('LABEL_FUSS_BASE_MAX_RATIO', '0.06'))      # wie nah am Boden der Fuß beginnen darf
            foot_xy_margin_ratio = float(os.environ.get('LABEL_FUSS_XY_MARGIN', '0.15'))         # Erweiterung des Pfosten-XY-Rahmens für Überlappprüfung
            foot_center_dist_ratio = float(os.environ.get('LABEL_FUSS_CENTER_DIST_RATIO', '0.6')) # erlaubte Distanz zum Pfosten-Zentrum (Fallback ohne Overlap)
            foot_top_max_ratio = float(os.environ.get('LABEL_FUSS_TOP_MAX_RATIO', '0.14'))        # maximale Oberkante des Fußes relativ zur Szenenhöhe
            # Kappen-Parameter (anpassbar über Env)
            kappe_max_scene_ratio = float(os.environ.get('LABEL_KAPPE_MAX_SCENE_RATIO', '0.25'))
            kappe_top_max_ratio = float(os.environ.get('LABEL_KAPPE_TOP_MAX_RATIO', '0.08'))
            kappe_xy_margin_ratio = float(os.environ.get('LABEL_KAPPE_XY_MARGIN', '0.20'))
            kappe_z_penetration = float(os.environ.get('LABEL_KAPPE_Z_PENETRATION', '0.02'))
            kappe_max_aspect = float(os.environ.get('LABEL_KAPPE_MAX_ASPECT', '2.0'))
            kappe_max_horiz_mult = float(os.environ.get('LABEL_KAPPE_MAX_HORIZ_MULT', '1.6'))
            kappe_center_dist_ratio = float(os.environ.get('LABEL_KAPPE_CENTER_DIST_RATIO', '0.8'))
            # Streben-Parameter (anpassbar über Env)
            strebe_aspect_long = float(os.environ.get('LABEL_STREBE_ASPECT_LONG', '3.8'))
            strebe_center_min = float(os.environ.get('LABEL_STREBE_CENTER_MIN', '0.04'))
            strebe_center_max = float(os.environ.get('LABEL_STREBE_CENTER_MAX', '0.96'))
            strebe_between_margin_ratio = float(os.environ.get('LABEL_STREBE_BETWEEN_MARGIN', '0.2'))
            strebe_max_depth_ratio = float(os.environ.get('LABEL_STREBE_MAX_DEPTH_RATIO', '0.95'))
            
            def color_distance(c1, c2):
                if not c1 or not c2:
                    return None
                # euklidisch in RGB [0..1]
                return math.sqrt((c1[0]-c2[0])**2 + (c1[1]-c2[1])**2 + (c1[2]-c2[2])**2)

            # Hilfsfunktion: zwei nächste Pfosten (in XY)
            def two_nearest_pfosten(xy):
                best1, best2 = None, None
                d1, d2 = math.inf, math.inf
                for p in pfosten:
                    pm, pM, _ = dims_cache[p.name]
                    pc = ((pm.x + pM.x) / 2.0, (pm.y + pM.y) / 2.0)
                    d = math.dist(xy, pc)
                    if d < d1:
                        best2, d2 = best1, d1
                        best1, d1 = p, d
                    elif d < d2:
                        best2, d2 = p, d
                return best1, best2, d1, d2

            # Durchschnittsfarbe der Pfosten (falls Farben vorhanden)
            avg_post_color = None
            if pfosten and use_material:
                cols = [colors_cache[p.name] for p in pfosten if colors_cache.get(p.name) is not None]
                if cols:
                    ar = sum(c[0] for c in cols) / len(cols)
                    ag = sum(c[1] for c in cols) / len(cols)
                    ab = sum(c[2] for c in cols) / len(cols)
                    avg_post_color = (ar, ag, ab)

            # Rücksetzen der Metriken-Liste
            self.label_metrics = []

            for idx, o in enumerate(mesh_objs):
                min_v, max_v, (dx, dy, dz) = dims_cache[o.name]
                base_d = min_v.z - global_min_z
                top_d = global_max_z - max_v.z
                center_xy = ((min_v.x + max_v.x) / 2.0, (min_v.y + max_v.y) / 2.0)
                center_z_ratio = ((min_v.z + max_v.z) / 2.0 - global_min_z) / scene_h

                # Geometriekennwerte
                dims_sorted = sorted([dx, dy, dz], reverse=True)
                L, M, S = dims_sorted[0], dims_sorted[1], max(dims_sorted[2], 1e-6)
                aspect_long = L / S  # Langseiten-zu-Dünnseiten-Verhältnis
                horiz = max(dx, dy)

                label = None
                obj_color = colors_cache.get(o.name)
                dist_to_post = color_distance(obj_color, avg_post_color) if avg_post_color is not None else None
                color_differs = (dist_to_post is not None and dist_to_post >= color_diff_thresh)
                # Pfosten (vertikal schlank, nahe Boden) – zweite Pfosten mit ähnlicher Logik
                if dz > 2.4 * horiz and base_d < 0.12 * scene_h:
                    label = "Pfosten"

                # Kappe: nur am oberen Ende eines Pfostens, mit XY-Überlapp und leichter Z-Penetration in den Pfosten
                if label is None and dz < kappe_max_scene_ratio * scene_h and top_d < kappe_top_max_ratio * scene_h:
                    near_p, d = nearest_pfosten(center_xy)
                    if near_p:
                        p_min_v, p_max_v, (pdx, pdy, pdz) = dims_cache[near_p.name]
                        # XY-Überlapp mit Pfosten
                        margin = kappe_xy_margin_ratio * max(pdx, pdy)
                        overlap_xy = not (
                            max_v.x < (p_min_v.x - margin) or
                            min_v.x > (p_max_v.x + margin) or
                            max_v.y < (p_min_v.y - margin) or
                            min_v.y > (p_max_v.y + margin)
                        )
                        # Z-Penetration: Kappe ragt etwas in den Pfosten hinein
                        z_pen = (p_max_v.z - min_v.z)
                        horiz_size = max(dx, dy)
                        post_footprint = max(pdx, pdy)
                        near_center = (d <= max(margin, kappe_center_dist_ratio * (post_footprint + horiz_size)))
                        if overlap_xy and near_center and z_pen >= kappe_z_penetration * scene_h \
                           and not (dz > 2.2 * horiz) and aspect_long <= kappe_max_aspect \
                           and horiz_size <= (kappe_max_horiz_mult * post_footprint):
                            label = "Kappe"
                # Material-Fallback für Kappe: deutlich andere Farbe, aber weiterhin Top-Nähe und XY-Überlapp erforderlich
                if label is None and use_material and color_differs and dz < kappe_max_scene_ratio * scene_h and top_d < (kappe_top_max_ratio + 0.02) * scene_h:
                    near_p, d = nearest_pfosten(center_xy)
                    if near_p:
                        p_min_v, p_max_v, (pdx, pdy, pdz) = dims_cache[near_p.name]
                        margin = kappe_xy_margin_ratio * max(pdx, pdy)
                        overlap_xy = not (
                            max_v.x < (p_min_v.x - margin) or
                            min_v.x > (p_max_v.x + margin) or
                            max_v.y < (p_min_v.y - margin) or
                            min_v.y > (p_max_v.y + margin)
                        )
                        z_pen = (p_max_v.z - min_v.z)
                        horiz_size = max(dx, dy)
                        post_footprint = max(pdx, pdy)
                        near_center = (d <= max(margin, kappe_center_dist_ratio * (post_footprint + horiz_size)))
                        if overlap_xy and near_center and z_pen >= kappe_z_penetration * scene_h \
                           and not (dz > 2.2 * horiz) and aspect_long <= kappe_max_aspect \
                           and horiz_size <= (kappe_max_horiz_mult * post_footprint):
                            label = "Kappe"

                # Hilfsfunktion: XY-Überlapp zwischen Objekt und Pfosten (mit Margin)
                def _xy_overlap(obj_min, obj_max, post_min, post_max, margin):
                    return not (
                        obj_max.x < (post_min.x - margin) or
                        obj_min.x > (post_max.x + margin) or
                        obj_max.y < (post_min.y - margin) or
                        obj_min.y > (post_max.y + margin)
                    )

                # Fuß-Erkennung: direkter XY-Überlapp unter dem Pfosten statt nur Distanzschwelle
                if label is None:
                    # Kandidat: niedrige Höhe & nahe Boden
                    if dz < foot_max_scene_ratio * scene_h and base_d < foot_base_max_ratio * scene_h and (max_v.z - global_min_z) < foot_top_max_ratio * scene_h:
                        near_p, d = nearest_pfosten(center_xy)
                        if near_p:
                            p_min_v, p_max_v, (pdx, pdy, pdz) = dims_cache[near_p.name]
                            margin = foot_xy_margin_ratio * max(pdx, pdy)
                            overlap = _xy_overlap(min_v, max_v, p_min_v, p_max_v, margin)
                            vol = max(dx, 1e-6) * max(dy, 1e-6) * max(dz, 1e-6)
                            vol_min = 0.0005 * (scene_h ** 3)
                            if overlap and not (dz > 2.0 * max(dx, dy)) and vol >= vol_min:
                                label = "Fuß"
                            if label is None:
                                post_footprint = max(pdx, pdy)
                                near_center = (d <= foot_center_dist_ratio * (post_footprint + max(dx, dy)))
                                if near_center and not (dz > 2.0 * max(dx, dy)) and vol >= vol_min:
                                    label = "Fuß"
                    # Material-Fallback: Farbe unterscheidet sich deutlich, etwas großzügigerer Bodenbereich
                    if label is None and use_material and color_differs and dz < foot_max_scene_ratio * scene_h and base_d < (foot_base_max_ratio + 0.02) * scene_h and (max_v.z - global_min_z) < (foot_top_max_ratio + 0.02) * scene_h:
                        near_p, d = nearest_pfosten(center_xy)
                        if near_p:
                            p_min_v, p_max_v, (pdx, pdy, pdz) = dims_cache[near_p.name]
                            margin = foot_xy_margin_ratio * max(pdx, pdy)
                            overlap = _xy_overlap(min_v, max_v, p_min_v, p_max_v, margin)
                            vol = max(dx, 1e-6) * max(dy, 1e-6) * max(dz, 1e-6)
                            vol_min = 0.0005 * (scene_h ** 3)
                            if overlap and not (dz > 2.0 * max(dx, dy)) and vol >= vol_min:
                                label = "Fuß"
                            if label is None:
                                post_footprint = max(pdx, pdy)
                                near_center = (d <= foot_center_dist_ratio * (post_footprint + max(dx, dy)))
                                if near_center and not (dz > 2.0 * max(dx, dy)) and vol >= vol_min:
                                    label = "Fuß"

                # Strebe (Fachwerk/Quer- oder Diagonalteil): lang und dünn, zwischen zwei Pfosten und nicht so tief (horiz. Dicke) wie Pfosten
                if label is None and aspect_long >= strebe_aspect_long and strebe_center_min <= center_z_ratio <= strebe_center_max:
                    # kein Pfosten: nicht stark z-dominant
                    if not (dz > 2.2 * horiz and base_d < 0.10 * scene_h):
                        assigned = False
                        if len(pfosten) >= 2:
                            p1, p2, dp1, dp2 = two_nearest_pfosten(center_xy)
                            if p1 and p2 and p1 != p2:
                                p1m, p1M, (p1dx, p1dy, p1dz) = dims_cache[p1.name]
                                p2m, p2M, (p2dx, p2dy, p2dz) = dims_cache[p2.name]
                                # XY-Union der beiden Pfosten und Margin nach Abstand
                                sep = math.dist(((p1m.x+p1M.x)/2.0, (p1m.y+p1M.y)/2.0), ((p2m.x+p2M.x)/2.0, (p2m.y+p2M.y)/2.0))
                                margin = strebe_between_margin_ratio * sep + max(dx, dy)
                                union_min_x = min(p1m.x, p2m.x)
                                union_max_x = max(p1M.x, p2M.x)
                                union_min_y = min(p1m.y, p2m.y)
                                union_max_y = max(p1M.y, p2M.y)
                                # Wiederverwendung der Überlappprüfung
                                if _xy_overlap(min_v, max_v,
                                               mathutils.Vector((union_min_x, union_min_y, 0.0)),
                                               mathutils.Vector((union_max_x, union_max_y, 0.0)),
                                               margin):
                                    # Dickenvergleich: Strebe dünner als Pfosten (horizontale Dicke)
                                    strebe_depth = min(dx, dy)
                                    post_thick1 = min(p1dx, p1dy)
                                    post_thick2 = min(p2dx, p2dy)
                                    ref_thick = max(post_thick1, post_thick2)
                                    if strebe_depth <= ref_thick * strebe_max_depth_ratio:
                                        label = "Strebe"
                                        assigned = True
                        # Fallback: wenn zu wenige Pfosten erkannt, nutze alte Regel
                        if not assigned:
                            label = "Strebe"

                # Wand-Erkennung: große flache Platte zwischen Pfosten
                # Charakteristik: eine Dimension sehr dünn (Wandstärke), zwei Dimensionen groß
                if label is None:
                    # Sortiere Dimensionen: L (größte), M (mittlere), S (kleinste)
                    wall_aspect = L / M  # sollte nicht zu extrem sein (Platte, kein Stab)
                    wall_thinness = L / S  # sehr dünn in einer Richtung
                    
                    # Wand: dünn (S klein), aber nicht extrem lang (kein Stab wie Strebe)
                    # Typisch: wall_aspect < 3.0 (nicht zu lang-gestreckt), wall_thinness > 5.0 (sehr dünn)
                    if wall_thinness > 5.0 and wall_aspect < 3.5 and S < 0.15 * scene_h:
                        # Prüfe ob zwischen Pfosten (mittlere Höhe, nicht Boden/Decke)
                        if 0.15 <= center_z_ratio <= 0.85:
                            if len(pfosten) >= 2:
                                p1, p2, dp1, dp2 = two_nearest_pfosten(center_xy)
                                if p1 and p2:
                                    # Wand sollte zwischen den Pfosten liegen (in XY-Union)
                                    p1m, p1M, _ = dims_cache[p1.name]
                                    p2m, p2M, _ = dims_cache[p2.name]
                                    union_min_x = min(p1m.x, p2m.x)
                                    union_max_x = max(p1M.x, p2M.x)
                                    union_min_y = min(p1m.y, p2m.y)
                                    union_max_y = max(p1M.y, p2M.y)
                                    
                                    # Prüfe XY-Überlappung mit Union der beiden nächsten Pfosten
                                    margin = 0.1 * max(dx, dy, dz)
                                    if _xy_overlap(min_v, max_v,
                                                   mathutils.Vector((union_min_x, union_min_y, 0.0)),
                                                   mathutils.Vector((union_max_x, union_max_y, 0.0)),
                                                   margin):
                                        label = "Wand"

                if debug:
                    extra = ""
                    if use_material:
                        extra = f" color={tuple(round(c,3) for c in (obj_color or (None,None,None)))} post_avg={tuple(round(c,3) for c in (avg_post_color or (None,None,None)))} dPost={(round(dist_to_post,3) if dist_to_post is not None else None)}"
                    self.log(
                        f"DBG {o.name}: dx={dx:.4f} dy={dy:.4f} dz={dz:.4f} base_ratio={base_d/scene_h:.3f} top_ratio={top_d/scene_h:.3f} center_ratio={center_z_ratio:.3f} aspect_long={aspect_long:.2f}{extra} -> {label}",
                        "DEBUG"
                    )

                # Metriken für Auswertung sammeln
                try:
                    self.label_metrics.append({
                        "name": o.name,
                        "bbox": {
                            "dx": dx, "dy": dy, "dz": dz,
                            "base_ratio": float(base_d/scene_h),
                            "top_ratio": float(top_d/scene_h),
                            "center_ratio": float(center_z_ratio),
                            "aspect_long": float(aspect_long)
                        },
                        "color": {
                            "rgb": obj_color if obj_color else None,
                            "post_avg": avg_post_color if avg_post_color else None,
                            "dist_to_post": float(dist_to_post) if dist_to_post is not None else None
                        },
                        "assigned": label or "Teil"
                    })
                except Exception:
                    pass
                
                # === CLAUDE AI INTEGRATION ===
                # Optional: Call Claude API for intelligent classification
                use_claude_ai = os.environ.get('USE_CLAUDE_AI', '0') == '1'
                ai_confidence_threshold = float(os.environ.get('AI_CONFIDENCE_THRESHOLD', '0.85'))
                ai_classification_source = "heuristic"
                final_confidence = 0.5
                
                # Ensure all meshes have a baseline label before AI classification
                if label is None:
                    label = "Teil"  # Default fallback for unlabeled meshes
                
                if use_claude_ai:  # Call AI for ALL meshes, even without heuristic label
                    try:
                        import time
                        start_time = time.time()
                        
                        mesh_features = self._extract_mesh_features(
                            o, dims_cache, global_min_z, global_max_z, scene_h, len(pfosten)
                        )
                        ai_result = self._call_claude_classification(mesh_features)
                        
                        # Track metrics
                        self.ai_metrics["totalMeshes"] += 1
                        self.ai_metrics["apiCalls"] += 1
                        self.ai_metrics["processingTime"] += int((time.time() - start_time) * 1000)
                        
                        if ai_result:
                            # Track tokens and cost
                            usage = ai_result.get("usage", {})
                            self.ai_metrics["inputTokens"] += usage.get("input_tokens", 0)
                            self.ai_metrics["outputTokens"] += usage.get("output_tokens", 0)
                            
                            # Calculate cost (Claude 3.5 Sonnet pricing)
                            input_cost = (usage.get("input_tokens", 0) / 1_000_000) * 3.0
                            output_cost = (usage.get("output_tokens", 0) / 1_000_000) * 15.0
                            self.ai_metrics["totalCost"] += input_cost + output_cost
                        
                        # Merge AI result with heuristic
                        final_label, final_confidence, ai_classification_source = self._merge_ai_and_heuristic_labels(
                            ai_result, label, ai_confidence_threshold
                        )
                        
                        # Track confidence distribution
                        if final_confidence < 0.5:
                            self.ai_metrics["confidenceDistribution"]["0.0-0.5"] += 1
                        elif final_confidence < 0.7:
                            self.ai_metrics["confidenceDistribution"]["0.5-0.7"] += 1
                        elif final_confidence < 0.85:
                            self.ai_metrics["confidenceDistribution"]["0.7-0.85"] += 1
                        elif final_confidence < 0.95:
                            self.ai_metrics["confidenceDistribution"]["0.85-0.95"] += 1
                        else:
                            self.ai_metrics["confidenceDistribution"]["0.95-1.0"] += 1
                        
                        # Update label if AI has high confidence
                        if ai_classification_source == "ai":
                            label = final_label
                            self.ai_metrics["aiOverrides"] += 1
                            self.log(f"AI override: {o.name} -> {label} (confidence: {final_confidence:.2f})", "INFO")
                        elif ai_classification_source == "heuristic_fallback":
                            self.log(f"AI low confidence ({final_confidence:.2f}), keeping heuristic: {label}", "DEBUG")
                        
                        # Add AI metadata to metrics
                        if self.label_metrics and len(self.label_metrics) > 0:
                            self.label_metrics[-1]["ai"] = {
                                "classification": final_label,
                                "confidence": float(final_confidence),
                                "source": ai_classification_source,
                                "reasoning": ai_result.get("reasoning", "") if ai_result else ""
                            }
                    except Exception as e:
                        self.log(f"AI classification failed for {o.name}: {str(e)}", "WARNING")
                
                # Eindeutiger Name
                if label is None:
                    counters["Teil"] += 1
                    unique = f"Teil_{counters['Teil']:02d}"
                else:
                    counters[label] += 1
                    unique = f"{label}_{counters[label]:02d}"

                # Setze sowohl Objekt- als auch Mesh-Datenblock-Namen
                o.name = unique
                try:
                    if o.data and hasattr(o.data, 'name'):
                        o.data.name = f"{unique}_Mesh"
                except Exception:
                    pass
            # Zusammenfassung loggen
            summary = ", ".join([f"{k}={v}" for k, v in counters.items()])
            self.log(f"Labeled {len(mesh_objs)} mesh objects heuristically ({summary})")
        except Exception as e:
            self.log(f"Heuristic labeling failed: {str(e)}", "WARNING")
        
        # Ensure all images are packed (safe in background mode)
        try:
            for image in bpy.data.images:
                if not image.packed_file:
                    try:
                        image.pack()
                        self.log(f"Packed image: {image.name}")
                    except Exception as e:
                        self.log(f"Failed to pack image {image.name}: {str(e)}", "WARNING")
        except Exception as e:
            self.log(f"Image packing loop failed: {str(e)}", "WARNING")
        
        # Set viewport shading only when UI context exists (skip in headless/background)
        try:
            if getattr(bpy.app, 'background', False) or bpy.context.screen is None:
                return
            for area in bpy.context.screen.areas:
                if area.type == 'VIEW_3D':
                    for space in area.spaces:
                        if space.type == 'VIEW_3D':
                            space.shading.type = 'MATERIAL'
        except Exception as e:
            # Non-fatal in headless runs
            self.log(f"Skipping viewport shading setup: {str(e)}", "WARNING")
    
    def export_glb(self, output_path: str, embed_textures: bool = True, output_format: str = "glb", 
                   gtin: Optional[str] = None, article_number: Optional[str] = None,
                   use_gtin_naming: bool = False, rotate_y_up: bool = False, use_draco: bool = False,
                   strip_cameras_lights: bool = True):
        """
        Export the scene as GLB/GLTF with optional GTIN-based naming
        
        Args:
            output_path: Base output path
            embed_textures: Embed textures in GLB
            output_format: 'glb' or 'gltf'
            gtin: Optional GTIN code for filename lookup
            article_number: Optional article number for filename lookup
            use_gtin_naming: Enable GTIN-based filename generation
            rotate_y_up: If True, manual rotation was applied, so disable export_yup
            use_draco: Enable Draco mesh compression
        """
        # Apply GTIN naming if enabled
        final_output_path = output_path
        derived_candidates: List[str] = []
        if use_gtin_naming and not (gtin or article_number):
            # export_glb() doesn't know the original input filename; use output_path stem only as a best-effort fallback.
            derived_candidates = self._derive_gtin_candidates_from_stem(Path(output_path).stem)
            if derived_candidates:
                self.log(f"[GTIN Naming] Derived GTIN candidates from filename: {', '.join(derived_candidates)}")

        if use_gtin_naming and (gtin or article_number or derived_candidates):
            try:
                # Try explicit identifiers first; otherwise try derived candidates.
                attempts: List[Tuple[Optional[str], Optional[str]]] = []
                if gtin or article_number:
                    attempts.append((gtin, article_number))
                for cand in derived_candidates:
                    attempts.append((cand, None))

                best_result = None
                best_gtin = gtin
                best_article = article_number
                for cand_gtin, cand_article in attempts:
                    query_params = []
                    if cand_gtin:
                        query_params.append(("gtin", cand_gtin))
                    if cand_article:
                        query_params.append(("articleNumber", cand_article))
                    if not query_params:
                        continue
                    query_string = urllib.parse.urlencode(query_params)
                    gtin_url = f"{self.mcp_api_url}/gtin/filename?{query_string}"
                    req = urllib.request.Request(gtin_url, method='GET')

                    with urllib.request.urlopen(req, timeout=5) as response:
                        result = json.loads(response.read().decode('utf-8'))

                    best_result = result
                    best_gtin = cand_gtin
                    best_article = cand_article

                    if result.get('success') is True:
                        break

                if best_result and best_result.get('filename'):
                    output_dir = Path(output_path).parent
                    final_output_path = str(output_dir / best_result['filename'])
                    if best_result.get('success'):
                        self.log(
                            f"GTIN naming resolved filename {best_result['filename']} (GTIN: {best_gtin}, Artikel: {best_article})",
                            "INFO",
                        )
                    else:
                        self.log(
                            f"GTIN fallback filename {best_result['filename']} (GTIN: {best_gtin}, Artikel: {best_article}) - not in database",
                            "WARNING",
                        )
                else:
                    self.log(
                        f"GTIN lookup returned no filename (GTIN: {gtin}, Artikel: {article_number}), using default",
                        "WARNING",
                    )
            except Exception as e:
                self.log(
                    f"GTIN naming service unavailable ({gtin}, {article_number}): {str(e)}, using default filename",
                    "WARNING",
                )
        
        self.log(f"Exporting to {output_format.upper()}: {final_output_path}")
        
        try:
            if strip_cameras_lights:
                self.strip_cameras_and_lights()

            # Ensure all materials are properly set up before export
            material_count = 0
            for obj in bpy.context.scene.objects:
                if obj.type == 'MESH':
                    for mat_slot in obj.material_slots:
                        mat = mat_slot.material
                        if mat:
                            material_count += 1
                            # Ensure material uses nodes
                            if not mat.use_nodes:
                                mat.use_nodes = True
                                nodes = mat.node_tree.nodes
                                nodes.clear()
                                
                                # Create Principled BSDF setup
                                principled = nodes.new('ShaderNodeBsdfPrincipled')
                                output = nodes.new('ShaderNodeOutputMaterial')
                                principled.location = (0, 0)
                                output.location = (300, 0)
                                mat.node_tree.links.new(principled.outputs[0], output.inputs[0])
                                
                                # Preserve diffuse color if available
                                if hasattr(mat, 'diffuse_color'):
                                    principled.inputs['Base Color'].default_value = mat.diffuse_color
                                    self.log(f"Export-Setup: Material {mat.name} Farbe erhalten")
            
            if material_count > 0:
                self.log(f"Export-Vorbereitung: {material_count} Materialien validiert")
            
            # Prepare export parameters based on Blender version
            # If we already rotated the meshes to Y-Up, skip exporter-based reorientation to avoid duplication
            use_export_yup = not rotate_y_up
            self.log(f"Export settings: export_yup={use_export_yup} (rotate_y_up={rotate_y_up})")
            
            export_params = {
                'filepath': final_output_path,
                'export_format': 'GLB' if output_format.lower() == "glb" else ('GLTF_EMBEDDED' if embed_textures else 'GLTF_SEPARATE'),
                'export_image_format': 'AUTO',
                'export_texcoords': True,
                'export_normals': True,
                'export_materials': 'EXPORT',
                'use_mesh_edges': False,
                'use_mesh_vertices': False,
                'export_cameras': False,
                'export_lights': False,
                'export_animations': False,
                'export_apply': True,  # Transformationen anwenden
                'export_yup': use_export_yup,  # Y-Up für Babylon.js
                'export_draco_mesh_compression_enable': use_draco
            }
            
            # Add Draco compression settings if enabled
            if use_draco:
                export_params['export_draco_mesh_compression_level'] = 6  # 0-10, default 6
                export_params['export_draco_normal_quantization'] = 10  # bits, default 10
                export_params['export_draco_texcoord_quantization'] = 12  # bits, default 12
                export_params['export_draco_color_quantization'] = 10  # bits, default 10
                export_params['export_draco_position_quantization'] = 14  # bits, default 14
                export_params['export_draco_generic_quantization'] = 12  # bits, default 12
            
            # Handle color export based on Blender version
            if bpy.app.version >= (4, 0, 0):
                # Blender 4.x: export vertex colors and material colors via attributes
                export_params['export_attributes'] = True
            else:
                # Blender 3.x: use legacy export_colors
                export_params['export_colors'] = True

            # === FINAL EXPORT GUARD: Textured materials must be non-metallic ===
            # Berücksichtigt: Base Color verlinkt ODER MTL map_Kd (PNG/JPG) – MTL ist Quelle der Wahrheit
            mtl_textured = getattr(self, '_mtl_materials_with_diffuse_texture', set())
            for mat in bpy.data.materials:
                if not mat or not mat.use_nodes or not mat.node_tree:
                    continue
                for node in mat.node_tree.nodes:
                    if node.type != 'BSDF_PRINCIPLED':
                        continue
                    base_in = node.inputs.get("Base Color")
                    has_texture = (base_in and base_in.is_linked) or self._is_mtl_textured_material_name(mat.name, mtl_textured)
                    if not has_texture:
                        continue

                    metal_in = node.inputs.get("Metallic")
                    if metal_in:
                        # Eventuelle Links entfernen (Metallic-Textur/Driver)
                        for link in [l for l in mat.node_tree.links if l.to_socket == metal_in]:
                            mat.node_tree.links.remove(link)
                        metal_in.default_value = 0.0

                    rough_in = node.inputs.get("Roughness")
                    if rough_in and not rough_in.is_linked:
                        if float(rough_in.default_value) < 0.85:
                            rough_in.default_value = 0.85

                    spec_in = node.inputs.get("Specular") or node.inputs.get("Specular IOR Level")
                    if spec_in and not spec_in.is_linked:
                        if float(spec_in.default_value) > 0.15:
                            spec_in.default_value = 0.15

                    # Blender-Fallback-Properties nur für betroffene Materialien
                    if hasattr(mat, 'metallic'):
                        mat.metallic = 0.0
                    if hasattr(mat, 'roughness'):
                        mat.roughness = 0.85
                    break

            # Debug: PBR-Werte vor Export ausgeben
            self.log("=== EXPORT GUARD: Material PBR Dump ===")
            for mat in bpy.data.materials:
                if not mat or not mat.use_nodes or not mat.node_tree:
                    continue
                for node in mat.node_tree.nodes:
                    if node.type != 'BSDF_PRINCIPLED':
                        continue
                    base_in = node.inputs.get("Base Color")
                    metal_in = node.inputs.get("Metallic")
                    rough_in = node.inputs.get("Roughness")
                    has_linked_tex = base_in.is_linked if base_in else False
                    has_mtl_tex = self._is_mtl_textured_material_name(mat.name, mtl_textured)
                    m_val = f"{float(metal_in.default_value):.3f}" if metal_in else "N/A"
                    r_val = f"{float(rough_in.default_value):.3f}" if rough_in else "N/A"
                    self.log(f"  {mat.name}: linkedTex={has_linked_tex} mtlMapKd={has_mtl_tex} metallic={m_val} roughness={r_val}")

            bpy.ops.export_scene.gltf(**export_params)
            
            self.log(f"Successfully exported {output_format.upper()} file")

            # iOS AR Quick Look requires USDZ. Best-effort: export USD and package to USDZ.
            try:
                if output_format.lower() == 'glb':
                    self._maybe_export_usdz(final_output_path)
            except Exception as e:
                self.log(f"USDZ export failed (non-fatal): {str(e)}", "WARNING")
            return final_output_path
            
        except Exception as e:
            self.log(f"Failed to export {output_format.upper()}: {str(e)}", "ERROR")
            return None

    def _maybe_export_usdz(self, glb_path: str) -> None:
        """Best-effort USDZ generation for iOS AR Quick Look.

        Creates a sibling .usdz next to the provided .glb, if enabled.
        Uses Blender's USD exporter to a temporary USD file and packages it via usdzip.
        """

        enabled = os.environ.get('EXPORT_USDZ', 'true').lower() in ('1', 'true', 'yes', 'on')
        if not enabled:
            return

        glb = Path(glb_path)
        if glb.suffix.lower() != '.glb':
            return

        usdz_path = glb.with_suffix('.usdz')
        overwrite = os.environ.get('EXPORT_USDZ_OVERWRITE', 'true').lower() in ('1', 'true', 'yes', 'on')

        if usdz_path.exists() and not overwrite:
            return

        # Ensure directory exists
        usdz_path.parent.mkdir(parents=True, exist_ok=True)

        # Export USD to a temp folder (textures may be emitted as separate files)
        with tempfile.TemporaryDirectory(prefix='blender_usdz_') as tmpdir:
            tmpdir_path = Path(tmpdir)
            usd_path = (tmpdir_path / glb.with_suffix('.usdc').name).resolve()

            # Optional USDZ-specific color compensation for iOS Quick Look.
            # Quick Look often renders medium/dark blues visibly brighter and more cyan than GLB viewers.
            # We compensate only during USD export and restore the scene immediately after.
            adjusted_base_colors: List[Tuple[Any, Tuple[float, float, float, float]]] = []
            compensate_blue = os.environ.get('USDZ_BLUE_COMPENSATION', 'true').lower() in ('1', 'true', 'yes', 'on')
            blue_factor = self._clamp(float(os.environ.get('USDZ_BLUE_COMP_FACTOR', '0.78')), 0.5, 1.0)
            if compensate_blue:
                try:
                    for mat in bpy.data.materials:
                        nodes = self._iter_principled_bsdf_nodes(mat)
                        if not nodes:
                            continue
                        node = nodes[0]
                        base_in = node.inputs.get("Base Color")
                        if not base_in or base_in.is_linked:
                            continue

                        rgba = list(base_in.default_value)
                        src_rgb = (float(rgba[0]), float(rgba[1]), float(rgba[2]))
                        canonical_name = None

                        match = self._find_nearest_standard_color(src_rgb, threshold=max(self.color_mapping_threshold, 0.35))
                        if match:
                            canonical_name = self._get_canonical_color_name(match['name'])

                        if canonical_name != 'RAL 5010':
                            inferred = self._infer_canonical_color_from_material_name(mat.name)
                            if inferred == 'RAL 5010':
                                canonical_name = inferred

                        if canonical_name == 'RAL 5010':
                            adjusted_base_colors.append((base_in, (rgba[0], rgba[1], rgba[2], rgba[3] if len(rgba) > 3 else 1.0)))
                            a = float(rgba[3]) if len(rgba) > 3 else 1.0
                            base_in.default_value = (
                                self._clamp(float(rgba[0]) * blue_factor),
                                self._clamp(float(rgba[1]) * blue_factor),
                                self._clamp(float(rgba[2]) * blue_factor),
                                a
                            )

                    if adjusted_base_colors:
                        self.log(f"USDZ blue compensation applied: {len(adjusted_base_colors)} material(s), factor={blue_factor:.2f}")
                except Exception as exc:
                    self.log(f"USDZ blue compensation skipped: {exc}", "WARNING")

            # Blender USD export operator. Keep args minimal for compatibility across versions.
            try:
                bpy.ops.wm.usd_export(filepath=str(usd_path))
            except Exception as exc:
                raise RuntimeError(f"Blender USD export failed: {exc}")
            finally:
                # Restore original base colors so GLB pipeline scene state remains untouched.
                for socket, original_rgba in adjusted_base_colors:
                    try:
                        socket.default_value = original_rgba
                    except Exception:
                        pass

            # Package USD into USDZ with RealityKit-friendly processing.
            # usdzip usage: usdzip --arkitAsset <scene.usd[a|c]> <out.usdz>
            try:
                result = subprocess.run(
                    ['usdzip', '--arkitAsset', str(usd_path), str(usdz_path)],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    check=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                )
                if result.stdout.strip():
                    self.log(f"USDZ (usdzip) stdout: {result.stdout.strip()}")
                if result.stderr.strip():
                    self.log(f"USDZ (usdzip) stderr: {result.stderr.strip()}", "WARNING")
            except FileNotFoundError:
                raise RuntimeError("usdzip not found on PATH; cannot create USDZ")
            except subprocess.CalledProcessError as exc:
                stderr = (exc.stderr or '').strip()
                raise RuntimeError(f"usdzip failed: {stderr or exc}")

        self.log(f"USDZ written: {usdz_path}")
    
    def convert(self, obj_path: str, output_path: Optional[str] = None, mtl_path: Optional[str] = None,
               mtl_reference: Optional[str] = None,
               texture_files: Optional[List[str]] = None, embed_textures: bool = True,
               use_ai: bool = False, use_draco: bool = False, output_format: str = "glb",
               scale: float = 1.0, decimate_ratio: float = 1.0,
               auto_label: bool = False, use_claude_ai: bool = False,
               gtin: Optional[str] = None, article_number: Optional[str] = None,
               use_gtin_naming: bool = False,
               rotate_y_up: bool = False,
               rotate_axis: Optional[str] = None, rotate_degrees: Optional[str] = None,
               import_up_axis: str = 'AUTO',
               material_finish: str = 'auto', strip_cameras_lights: bool = True,
               enable_preflight: bool = True,
               color_saturation: float = 1.0,
               color_brightness: float = 1.0,
               roughness_multiplier: float = 1.0,
               metallic_multiplier: float = 1.0,
               selected_colors: Optional[List[Any]] = None,
               color_overrides: Optional[Dict[str, Any]] = None,
               color_materials: Optional[Dict[str, Any]] = None,
               target_mesh_signature: Optional[Dict[str, Any]] = None,
               target_mesh_match_threshold: float = 0.15,
               target_mesh_material: Optional[Dict[str, Any]] = None,
               preflight_only: bool = False,
               preserve_mtl_colors: bool = False,
               default_color_override: bool = False) -> Dict[str, Any]:
        """
        Main conversion method.

        Farb-Reihenfolge (festgelegt):
          1. MTL (OBJ): Bei OBJ-Dateien ist die .mtl ausschlaggebend (Kd → Base Color).
          2. Standardfarben: Danach Prüfung auf passende Standardfarben (Palette);
             wenn color_mapping_enabled, wird auf nächste Standardfarbe gemappt.
          3. Override: Ersetzung durch Nutzer-Farben nur aus color_overrides (Preflight).
             Produkt-Standardfarbe wird nur vorgeschlagen, wenn im Dashboard „Override“ angehakt ist.

        Args:
            obj_path: Path to OBJ file
            output_path: Output GLB file path (optional if use_gtin_naming=True)
            mtl_path: Optional MTL file path
            texture_files: List of texture file paths
            embed_textures: Embed textures in GLB
            use_ai: Use AI material recognition
            use_draco: Enable Draco mesh compression
            output_format: 'glb' or 'gltf'
            scale: Scale factor (e.g., 0.01 for 1% size, 0.1 for 10%)
            decimate_ratio: Mesh simplification (0.1-1.0, where 0.5 = 50% polygons)
            auto_label: Enable heuristic structural part labeling
            use_claude_ai: Enable Claude AI mesh classification
            gtin: Optional GTIN code for filename lookup
            article_number: Optional article number for filename lookup
            use_gtin_naming: Enable GTIN-based filename generation
            rotate_y_up: Rotate objects 90° around X-axis (Z-up to Y-up conversion)
            import_up_axis: 'AUTO', 'X', 'Y', or 'Z' - welche Achse in der OBJ nach oben zeigt
            material_finish: Material-Preset ("auto", "standard", "galvanized", "powder-coated")
        """
        # CRITICAL: Set environment variable for Claude AI FIRST
        # This must be done before any logging or processing that might call label_structural_parts()
        if use_claude_ai:
            os.environ['USE_CLAUDE_AI'] = '1'
        else:
            os.environ['USE_CLAUDE_AI'] = '0'
        
        if texture_files is None:
            texture_files = []
        
        # Normalise output directory (shared with MCP server via BLENDER_OUTPUT_DIR)
        base_output_dir = Path(os.environ.get('BLENDER_OUTPUT_DIR', Path(__file__).resolve().parents[1] / 'outputs')).resolve()
        base_output_dir.mkdir(parents=True, exist_ok=True)

        resolved_output_path: Optional[Path] = None
        provided_output_path: Optional[Path] = None

        if output_path:
            provided_output_path = Path(output_path)
            if not provided_output_path.is_absolute():
                provided_output_path = (Path.cwd() / provided_output_path).resolve()
            else:
                provided_output_path = provided_output_path.resolve()

        target_dir = provided_output_path.parent if provided_output_path else base_output_dir
        target_dir.mkdir(parents=True, exist_ok=True)

        derived_gtin = None
        if use_gtin_naming and not (gtin or article_number):
            derived_candidates = self._derive_gtin_candidates_from_stem(Path(obj_path).stem)
            if derived_candidates:
                # We'll try candidates in order below.
                gtin = derived_candidates[0]
                self.log(f"[GTIN Naming] Derived GTIN candidates from filename: {', '.join(derived_candidates)}")
            else:
                derived_candidates = []
        else:
            derived_candidates = []

        if use_gtin_naming and (gtin or article_number):
            try:
                attempts: List[Tuple[Optional[str], Optional[str]]] = []
                attempts.append((gtin, article_number))
                for cand in derived_candidates:
                    attempts.append((cand, None))

                data = None
                used_gtin = gtin
                used_article = article_number

                for cand_gtin, cand_article in attempts:
                    query_params = []
                    if cand_gtin:
                        query_params.append(("gtin", cand_gtin))
                    if cand_article:
                        query_params.append(("articleNumber", cand_article))
                    if not query_params:
                        continue
                    query_string = urllib.parse.urlencode(query_params)
                    url = f"{self.mcp_api_url}/gtin/filename?{query_string}"
                    req = urllib.request.Request(url)
                    with urllib.request.urlopen(req, timeout=5) as response:
                        data = json.loads(response.read().decode())
                    used_gtin = cand_gtin
                    used_article = cand_article
                    if data.get('success') is True:
                        break

                gtin_filename = (data or {}).get('filename')
                if not gtin_filename:
                    fallback_base = used_gtin or used_article or Path(obj_path).stem
                    gtin_filename = f"{fallback_base}.{output_format}"
                resolved_output_path = (target_dir / gtin_filename).resolve()
                if (data or {}).get('success'):
                    self.log(f"[GTIN Naming] Resolved output filename: {gtin_filename}")
                else:
                    self.log(f"[GTIN Naming] Fallback filename: {gtin_filename} (not in database)")
            except Exception as e:
                fallback_base = gtin or article_number or Path(obj_path).stem
                fallback_name = f"{fallback_base}.{output_format}"
                self.log(
                    f"[WARNING] GTIN lookup failed ({gtin}, {article_number}): {e}, using fallback filename {fallback_name}"
                )
                resolved_output_path = (target_dir / fallback_name).resolve()
        elif provided_output_path:
            resolved_output_path = provided_output_path
        else:
            if preflight_only:
                # Preflight-only mode does not need to produce an output file, but we still
                # generate a deterministic fallback path for logs/debug exports.
                fallback_name = f"{Path(obj_path).stem}.{output_format}"
                resolved_output_path = (target_dir / fallback_name).resolve()
            else:
                raise ValueError("output_path is required when not using GTIN naming")

        output_path_path = resolved_output_path
        output_path = str(output_path_path)
        
        self.log("=== Starting Mesh to GLB Conversion ===")
        self.log(f"Input geometry: {obj_path}")
        if mtl_path:
            self.log(f"Input MTL: {mtl_path}")
        elif Path(obj_path).suffix.lower() != '.ply':
            self.log("Input MTL: <none>")
        if mtl_reference:
            self.log(f"MTL reference (mtllib): {mtl_reference}")
        self.log(f"Texture files: {len(texture_files)}")
        self.log(f"Output: {output_path}")
        self.log(f"AI material enabled: {use_ai}")
        self.log(f"Claude AI classification: {use_claude_ai}")
        self.log(f"GTIN naming: {use_gtin_naming} (GTIN: {gtin}, Artikel: {article_number})")
        self.log(f"Scale: {scale}")
        self.log(f"Decimate ratio: {decimate_ratio}")
        self.log(f"Auto label parts: {auto_label}")
        self.log(f"Rotate to Y-up: {rotate_y_up}")
        self.log(f"Material finish: {material_finish}")
        self.log(f"Preflight-only: {preflight_only}")
        
        self._uploaded_texture_files = list(texture_files) if texture_files else []

        material_analysis = None
        effective_finish = material_finish
        preflight_report: Optional[Dict[str, Any]] = None
        target_mesh_match: Optional[Dict[str, Any]] = None
        override_stats: Dict[str, Any] = {
            "enabled": False,
            "materialsScanned": 0,
            "materialsChanged": 0,
            "sourceColorsMatched": 0
        }

        try:
            # Clear the scene
            self.last_import_type = 'unknown'
            self.last_import_color_attribute = None
            self.clear_scene()
            
            geometry_ext = Path(obj_path).suffix.lower()
            has_user_color_overrides = bool(color_overrides)
            skip_standard_color_mapping = has_user_color_overrides or preserve_mtl_colors

            if geometry_ext == '.ply':
                if not self.import_ply_file(obj_path):
                    raise Exception("Failed to import PLY file")
            else:
                if not self.import_obj_file(obj_path, mtl_path, import_up_axis, mtl_reference=mtl_reference, skip_standard_color_mapping=skip_standard_color_mapping):
                    raise Exception("Failed to import OBJ file")
            
            # Optionally separate loose parts & label structures before materials
            if auto_label:
                self.separate_loose_parts()
                self.label_structural_parts()
                self._apply_plastic_to_caps()
                # Optional: Metriken als JSON exportieren
                try:
                    if os.environ.get('LABEL_DEBUG', '0') == '1' or os.environ.get('LABEL_EXPORT_JSON', '0') == '1':
                        metrics_path = output_path_path.with_name(f"{output_path_path.stem}-labels.json")
                        with open(metrics_path, 'w', encoding='utf-8') as f:
                            json.dump({
                                "obj": obj_path,
                                "output": output_path,
                                "count": len(self.label_metrics),
                                "items": self.label_metrics
                            }, f, indent=2)
                        self.log(f"Label-Metriken exportiert: {metrics_path}")
                except Exception as e:
                    self.log(f"Export der Label-Metriken fehlgeschlagen: {str(e)}", "WARNING")

            # Process materials and textures (skip for PLY vertex-color imports)
            if self.last_import_type == 'ply':
                if texture_files:
                    self.log("Überspringe Textur-Zuordnung – PLY enthält bereits Face-Farben", "INFO")
                else:
                    self.log("PLY Import nutzt vorhandene Vertex-Farben – keine Texturverarbeitung notwendig")
            else:
                self.process_materials_and_textures(texture_files, use_ai)

            material_analysis = self.analyze_material_finish()
            dominant_finish = (material_analysis.get('dominantFinish') if material_analysis else 'unknown') or 'unknown'
            confidence = material_analysis.get('confidence', 0.0) if material_analysis else 0.0

            if material_finish == 'auto':
                effective_finish = material_analysis.get('recommendedFinish', 'standard') if material_analysis else 'standard'
                self.log(
                    f"[INFO] Materialanalyse → dominant={dominant_finish}, confidence={confidence:.2f}, vorgeschlagenes Finish={effective_finish}"
                )
            else:
                effective_finish = material_finish
                suggested = material_analysis.get('recommendedFinish', 'standard') if material_analysis else 'standard'
                self.log(
                    f"[INFO] Material-Finish gewählt: {material_finish} (Analyse empfiehlt {suggested})"
                )

            if effective_finish not in ('standard', 'auto', None):
                self.apply_material_finish(effective_finish)

            override_stats = self._apply_color_overrides(
                selected_colors=selected_colors,
                color_overrides=color_overrides,
                color_materials=color_materials,
                default_color_override=default_color_override,
            )
            if override_stats.get('enabled') and override_stats.get('materialsChanged', 0) > 0:
                self.log(
                    f"[Overrides] angewendet: materialsChanged={override_stats.get('materialsChanged')} (matchedColors={override_stats.get('sourceColorsMatched')})",
                    "INFO"
                )

            # Mesh fingerprint match (Option A) before preflight/optimizations
            try:
                target_mesh_match = self._match_target_mesh(target_mesh_signature, target_mesh_match_threshold)
                if target_mesh_match and target_mesh_match.get('found'):
                    best = target_mesh_match.get('best') or {}
                    dist = best.get('distance')
                    dist_str = f"{float(dist):.4f}" if dist is not None else "n/a"
                    self.log(
                        f"[TargetMesh] Match: {best.get('objectName')} (distance={dist_str}, threshold={target_mesh_match.get('threshold')})",
                        "INFO"
                    )

                    if isinstance(target_mesh_material, dict) and target_mesh_material:
                        obj_name = best.get('objectName')
                        obj = bpy.context.scene.objects.get(obj_name) if obj_name else None
                        if obj is not None:
                            ok = self._apply_material_preset_to_object(obj, target_mesh_material)
                            self.log(
                                f"[TargetMesh] Oberfläche {'angewendet' if ok else 'nicht angewendet'}: {target_mesh_material.get('name')}",
                                "INFO" if ok else "WARNING"
                            )
                elif target_mesh_match:
                    best = target_mesh_match.get('best') or {}
                    if best.get('objectName'):
                        dist = best.get('distance')
                        dist_str = f"{float(dist):.4f}" if dist is not None else "n/a"
                        self.log(
                            f"[TargetMesh] Kein Match unter Threshold. Best={best.get('objectName')} (distance={dist_str}, threshold={target_mesh_match.get('threshold')})",
                            "INFO"
                        )
            except Exception as e:
                self.log(f"[TargetMesh] Matching fehlgeschlagen: {str(e)}", "WARNING")

            # Preflight (materials/colors/surfaces) + optional global adjustments
            if enable_preflight:
                preflight_report = self._build_preflight_report(
                    enable_preflight=enable_preflight,
                    color_saturation=color_saturation,
                    color_brightness=color_brightness,
                    roughness_multiplier=roughness_multiplier,
                    metallic_multiplier=metallic_multiplier,
                )
                applied = self._apply_global_material_adjustments(
                    color_saturation=color_saturation,
                    color_brightness=color_brightness,
                    roughness_multiplier=roughness_multiplier,
                    metallic_multiplier=metallic_multiplier,
                )
                preflight_report["applied"] = applied
                preflight_report["overrides"] = override_stats
                if target_mesh_match is not None:
                    preflight_report["targetMeshMatch"] = target_mesh_match
                self.log(
                    f"[Preflight] angewendet: colors={applied.get('baseColorAdjusted')}, roughness={applied.get('roughnessAdjusted')}, metallic={applied.get('metallicAdjusted')}",
                    "INFO"
                )

            # Final safety: textured materials must never be metallic
            self._ensure_non_metallic_for_textured_materials()

            if rotate_y_up:
                self.rotate_to_y_up()
                self.bake_root_transforms_to_meshes()
                self._log_mesh_inventory("ROTATE-Y-UP")
            elif rotate_axis in ('X', 'Y', 'Z') and str(rotate_degrees) in ('90', '180', '270'):
                self.apply_export_axis_rotation(rotate_axis, int(rotate_degrees))
                self.bake_root_transforms_to_meshes()
                self._log_mesh_inventory("EXPORT-AXIS-ROTATION")

            if preflight_only:
                self.log("=== Preflight-Only Completed Successfully ===")
                return {
                    "success": True,
                    "output_path": None,
                    "logs": self.conversion_logs,
                    "stats": {
                        "objects": len([obj for obj in bpy.context.scene.objects if obj.type == 'MESH']),
                        "materials": len(bpy.data.materials),
                        "textures": len(bpy.data.images)
                    },
                    "preflight": preflight_report,
                    "targetMeshMatch": target_mesh_match,
                    "overrides": override_stats,
                    "material_analysis": material_analysis,
                    "requested_material_finish": material_finish,
                    "applied_material_finish": effective_finish,
                    "label_metrics": self.label_metrics if auto_label else [],
                    "aiMetrics": self.ai_metrics if use_claude_ai and self.ai_metrics["totalMeshes"] > 0 else None,
                    "preflight_only": True
                }

            # Optimize for export (with scale and decimation)
            self.optimize_for_export(scale, decimate_ratio)

            # Letzte Sicherung: Texturierte Materialien dürfen niemals metallisch sein
            self._ensure_non_metallic_for_textured_materials()
            
            # Export GLB (SolidWorks Y-up mode)
            actual_output_path = self.export_glb(
                output_path,
                embed_textures,
                output_format,
                gtin,
                article_number,
                use_gtin_naming,
                rotate_y_up,
                use_draco,
                strip_cameras_lights=strip_cameras_lights,
            )
            if not actual_output_path:
                raise Exception("Failed to export GLB file")
            
            self.log("=== Conversion Completed Successfully ===")
            
            # Write AI metrics to JSON file if AI was used
            use_claude_ai = os.environ.get('USE_CLAUDE_AI', '0') == '1'
            if use_claude_ai and self.ai_metrics["totalMeshes"] > 0:
                try:
                    import json
                    actual_path_obj = Path(actual_output_path)
                    metrics_path = actual_path_obj.with_name(f"{actual_path_obj.stem}_ai_metrics.json")
                    with open(metrics_path, 'w') as f:
                        json.dump(self.ai_metrics, f, indent=2)
                    self.log(f"AI metrics written to: {metrics_path}", "INFO")
                except Exception as e:
                    self.log(f"Failed to write AI metrics: {str(e)}", "WARNING")
            
            return {
                "success": True,
                "output_path": actual_output_path,
                "logs": self.conversion_logs,
                "stats": {
                    "objects": len([obj for obj in bpy.context.scene.objects if obj.type == 'MESH']),
                    "materials": len(bpy.data.materials),
                    "textures": len(bpy.data.images)
                },
                "preflight": preflight_report,
                "targetMeshMatch": target_mesh_match,
                "overrides": override_stats,
                "material_analysis": material_analysis,
                "requested_material_finish": material_finish,
                "applied_material_finish": effective_finish,
                "label_metrics": self.label_metrics if auto_label else [],
                "aiMetrics": self.ai_metrics if use_claude_ai and self.ai_metrics["totalMeshes"] > 0 else None
            }
            
        except Exception as e:
            error_msg = f"Conversion failed: {str(e)}"
            self.log(error_msg, "ERROR")
            return {
                "success": False,
                "error": error_msg,
                "logs": self.conversion_logs,
                "preflight": preflight_report,
                "targetMeshMatch": target_mesh_match,
                "overrides": override_stats,
                "material_analysis": material_analysis,
                "requested_material_finish": material_finish,
                "applied_material_finish": effective_finish
            }
    
    def convert_step_to_glb(self, step_file: str, output_path: str, texture_files: List[str] = None, 
                           **options) -> Dict[str, Any]:
        """
        Convert STEP file to GLB format via OBJ intermediate
        
        Args:
            step_file: Path to STEP/STP input file
            output_path: Path for GLB output
            texture_files: Optional texture files
            **options: Conversion options (tessellation_quality, scale, etc.)
            
        Returns:
            dict: Conversion results and statistics
        """
        if not self.step_converter_available:
            raise ImportError("STEP converter not available - install FreeCAD: pip install FreeCAD")
        
        import tempfile
        
        self.log("🔄 Starting STEP to GLB conversion...")
        
        tessellation_quality = options.get('tessellation_quality', 0.1)
        material_finish = (options.get('materialFinish') or options.get('material_finish') or 'auto')
        preflight_only = bool(options.get('preflightOnly', False) or options.get('preflight_only', False))

        # GTIN naming: if enabled but no identifiers provided, derive from input filename.
        use_gtin_naming = bool(options.get('useGTINNaming', False) or options.get('use_gtin_naming', False))
        if use_gtin_naming and not (options.get('gtin') or options.get('articleNumber') or options.get('article_number')):
            derived = self._derive_gtin_candidate_from_stem(Path(step_file).stem)
            if derived:
                options['gtin'] = derived
                self.log(f"[GTIN Naming] Derived GTIN candidate from filename: {derived}")
        self._uploaded_texture_files = list(texture_files) if texture_files else []

        material_analysis = None
        effective_finish = material_finish
        preflight_report: Optional[Dict[str, Any]] = None
        target_mesh_match: Optional[Dict[str, Any]] = None
        override_stats: Dict[str, Any] = {
            "enabled": False,
            "materialsScanned": 0,
            "materialsChanged": 0,
            "sourceColorsMatched": 0,
            "principledParamsChanged": 0,
        }
        
        # Create temporary OBJ file
        with tempfile.NamedTemporaryFile(suffix='.obj', delete=False) as temp_obj:
            temp_obj_path = temp_obj.name
        
        with tempfile.NamedTemporaryFile(suffix='.mtl', delete=False) as temp_mtl:
            temp_mtl_path = temp_mtl.name
        
        try:
            # Step 1: Convert STEP to OBJ
            self.log(f"📐 Converting STEP to OBJ (quality: {tessellation_quality})...")
            step_converter = StepToObjConverter(tessellation_quality=tessellation_quality)
            step_result = step_converter.convert_step_to_obj(
                step_file,
                temp_obj_path,
                temp_mtl_path,
                gtin=options.get('gtin'),
                article_number=options.get('articleNumber') or options.get('article_number'),
            )
            
            if not step_result.get('success'):
                raise RuntimeError(f"STEP conversion failed: {step_result.get('error', 'Unknown error')}")
            
            self.log(f"✅ STEP to OBJ completed: {step_result['vertices_count']} vertices")

            step_color_fallback = step_result.get('step_color_fallback', False)
            if step_color_fallback:
                fallback_reason = step_result.get('step_color_fallback_reason') or 'unbekannt'
                self.log(f"⚠ STEP-Farb-Fallback aktiv (Grund: {fallback_reason})", "WARN")
                if step_result.get('step_color_notes'):
                    for note in step_result['step_color_notes']:
                        self.log(f"  ↪ {note}")
            
            # Step 2: Process OBJ to GLB (use existing pipeline)
            self.log("🎨 Converting OBJ to GLB...")
            self.log(f"Material finish: {material_finish}")
            
            # Start from a clean Blender scene to avoid leftover meshes between batch items.
            self.clear_scene()

            # Import the temporary OBJ file
            if not self.import_obj_file(temp_obj_path, temp_mtl_path, 
                                       options.get('import_up_axis', 'AUTO'),
                                       mtl_reference=options.get('mtlReference')):
                raise RuntimeError("Failed to import converted OBJ file")
            
            self._log_mesh_inventory("STEP→OBJ-IMPORT")

            # Apply textures if provided
            if texture_files:
                self.process_materials_and_textures(texture_files, options.get('useAI', False))

            material_analysis = self.analyze_material_finish()
            dominant_finish = (material_analysis.get('dominantFinish') if material_analysis else 'unknown') or 'unknown'
            confidence = material_analysis.get('confidence', 0.0) if material_analysis else 0.0

            if material_finish == 'auto':
                effective_finish = material_analysis.get('recommendedFinish', 'standard') if material_analysis else 'standard'
                self.log(
                    f"[INFO] Materialanalyse (STEP) → dominant={dominant_finish}, confidence={confidence:.2f}, vorgeschlagenes Finish={effective_finish}"
                )
            else:
                effective_finish = material_finish
                suggested = material_analysis.get('recommendedFinish', 'standard') if material_analysis else 'standard'
                self.log(
                    f"[INFO] Material-Finish (STEP) gewählt: {material_finish} (Analyse empfiehlt {suggested})"
                )

            if effective_finish not in ('standard', 'auto', None):
                self.apply_material_finish(effective_finish)

            selected_colors = options.get('selectedColors', options.get('selected_colors'))
            color_overrides = options.get('colorOverrides', options.get('color_overrides'))
            color_materials = options.get('colorMaterials', options.get('color_materials'))

            default_color_override = options.get('defaultColorOverride', options.get('default_color_override', False))
            override_stats = self._apply_color_overrides(
                selected_colors=selected_colors,
                color_overrides=color_overrides,
                color_materials=color_materials,
                default_color_override=default_color_override,
            )
            if override_stats.get('enabled') and (
                override_stats.get('materialsChanged', 0) > 0 or override_stats.get('principledParamsChanged', 0) > 0
            ):
                self.log(
                    f"[Overrides] (STEP) angewendet: materialsChanged={override_stats.get('materialsChanged')} paramsChanged={override_stats.get('principledParamsChanged')} (matchedColors={override_stats.get('sourceColorsMatched')})",
                    "INFO"
                )

            # Mesh fingerprint match (Option A)
            try:
                target_sig = options.get('targetMeshSignature', options.get('target_mesh_signature'))
                threshold = options.get('targetMeshMatchThreshold', options.get('target_mesh_match_threshold', 0.15))
                target_mesh_match = self._match_target_mesh(target_sig, threshold)
                if target_mesh_match and target_mesh_match.get('found'):
                    best = target_mesh_match.get('best') or {}
                    dist = best.get('distance')
                    dist_str = f"{float(dist):.4f}" if dist is not None else "n/a"
                    self.log(
                        f"[TargetMesh] (STEP) Match: {best.get('objectName')} (distance={dist_str}, threshold={target_mesh_match.get('threshold')})",
                        "INFO"
                    )

                    target_mesh_material = options.get('targetMeshMaterial', options.get('target_mesh_material'))
                    if isinstance(target_mesh_material, dict) and target_mesh_material:
                        obj_name = best.get('objectName')
                        obj = bpy.context.scene.objects.get(obj_name) if obj_name else None
                        if obj is not None:
                            ok = self._apply_material_preset_to_object(obj, target_mesh_material)
                            self.log(
                                f"[TargetMesh] (STEP) Oberfläche {'angewendet' if ok else 'nicht angewendet'}: {target_mesh_material.get('name')}",
                                "INFO" if ok else "WARNING"
                            )
            except Exception as e:
                self.log(f"[TargetMesh] (STEP) Matching fehlgeschlagen: {str(e)}", "WARNING")

            # Preflight (materials/colors/surfaces) + optional global adjustments
            enable_preflight = bool(options.get('enablePreflight', True) and options.get('enable_preflight', True))
            if enable_preflight:
                color_saturation = float(options.get('colorSaturation', options.get('color_saturation', 1.0)))
                color_brightness = float(options.get('colorBrightness', options.get('color_brightness', 1.0)))
                roughness_multiplier = float(options.get('roughnessMultiplier', options.get('roughness_multiplier', 1.0)))
                metallic_multiplier = float(options.get('metallicMultiplier', options.get('metallic_multiplier', 1.0)))

                preflight_report = self._build_preflight_report(
                    enable_preflight=enable_preflight,
                    color_saturation=color_saturation,
                    color_brightness=color_brightness,
                    roughness_multiplier=roughness_multiplier,
                    metallic_multiplier=metallic_multiplier,
                )
                applied = self._apply_global_material_adjustments(
                    color_saturation=color_saturation,
                    color_brightness=color_brightness,
                    roughness_multiplier=roughness_multiplier,
                    metallic_multiplier=metallic_multiplier,
                )
                preflight_report["applied"] = applied
                preflight_report["overrides"] = override_stats
                if target_mesh_match is not None:
                    preflight_report["targetMeshMatch"] = target_mesh_match
                self.log(
                    f"[Preflight] (STEP) angewendet: colors={applied.get('baseColorAdjusted')}, roughness={applied.get('roughnessAdjusted')}, metallic={applied.get('metallicAdjusted')}",
                    "INFO"
                )

            # Final safety: textured materials must never be metallic
            self._ensure_non_metallic_for_textured_materials()
            
            # Optional loose-part separation to mirror OBJ pipeline prior to labeling.
            if options.get('autoLabelParts', False):
                self.separate_loose_parts()

            # Apply transformations and optimizations (rotateYUp and rotateAxis/rotateDegrees are mutually exclusive)
            if options.get('rotateYUp', False):
                self.rotate_to_y_up()
                self.bake_root_transforms_to_meshes()
                self._log_mesh_inventory("STEP-ROTATE-Y-UP")
            else:
                ra = options.get('rotateAxis')
                rd = options.get('rotateDegrees')
                if ra in ('X', 'Y', 'Z') and str(rd) in ('90', '180', '270'):
                    self.apply_export_axis_rotation(ra, int(rd))
                    self.bake_root_transforms_to_meshes()
                    self._log_mesh_inventory("STEP-EXPORT-AXIS-ROTATION")

            if preflight_only:
                combined_result = {
                    'success': True,
                    'step_conversion': step_result,
                    'glb_export': None,
                    'input_format': 'STEP',
                    'output_path': None,
                    'output_file': None,
                    'pipeline': 'STEP → OBJ (preflight-only)',
                    'step_color_fallback': step_color_fallback,
                    'step_color_details': step_result.get('step_status') if step_result else {},
                    'step_converter_script': step_result.get('step_script_used') if step_result else None,
                    'step_color_notes': step_result.get('step_color_notes', []) if step_result else [],
                    'preflight': preflight_report,
                    'targetMeshMatch': target_mesh_match,
                    'overrides': override_stats,
                    'material_analysis': material_analysis,
                    'requested_material_finish': material_finish,
                    'applied_material_finish': effective_finish,
                    'preflight_only': True
                }
                self.log("=== STEP Preflight-Only Completed Successfully ===")
                return combined_result

            # Remove cameras/lights unless explicitly kept (applied during export)
            keep_cameras_lights = bool(options.get('keepCamerasLights', False))
            strip_cameras_lights = bool(options.get('stripCamerasLights', True)) and (not keep_cameras_lights)
            
            self.optimize_for_export(
                scale=options.get('scale', 1.0),
                decimate_ratio=options.get('decimateRatio', 1.0)
            )
            
            # Label parts if requested
            if options.get('autoLabelParts', False):
                self.label_structural_parts()
                self._apply_plastic_to_caps()
            
            # Letzte Sicherung: Texturierte Materialien dürfen niemals metallisch sein
            self._ensure_non_metallic_for_textured_materials()

            # Export to GLB
            glb_result = self.export_glb(
                output_path,
                embed_textures=options.get('embedTextures', True),
                output_format=options.get('outputFormat', 'glb'),
                gtin=options.get('gtin'),
                article_number=options.get('articleNumber'),
                use_gtin_naming=use_gtin_naming,
                rotate_y_up=options.get('rotateYUp', False),
                use_draco=options.get('useDraco', False),
                strip_cameras_lights=strip_cameras_lights,
            )
            
            # export_glb() returns the actual written path (may include GTIN-based renaming).
            # Use that as the authoritative result path; fall back to input parameter if missing.
            actual_output = glb_result if isinstance(glb_result, str) and glb_result else output_path

            # Combine results
            combined_result = {
                'success': True,
                'step_conversion': step_result,
                'glb_export': glb_result,
                'input_format': 'STEP',
                'output_path': actual_output,
                'output_file': actual_output,
                'pipeline': 'STEP → OBJ → GLB',
                'step_color_fallback': step_color_fallback,
                'step_color_details': step_result.get('step_status') if step_result else {},
                'step_converter_script': step_result.get('step_script_used') if step_result else None,
                'step_color_notes': step_result.get('step_color_notes', []) if step_result else [],
                'preflight': preflight_report,
                'targetMeshMatch': target_mesh_match,
                'overrides': override_stats,
                'material_analysis': material_analysis,
                'requested_material_finish': material_finish,
                'applied_material_finish': effective_finish
            }
            
            self.log("🎉 STEP to GLB conversion completed successfully!")
            return combined_result
            
        finally:
            # Clean up temporary files
            for temp_file in [temp_obj_path, temp_mtl_path]:
                try:
                    os.unlink(temp_file)
                except:
                    pass


def parse_arguments():
    """Parse command line arguments"""
    parser = argparse.ArgumentParser(description='Convert OBJ/STEP to GLB using Blender')
    parser.add_argument('--job-id', required=True, help='Job identifier')
    parser.add_argument('--obj-file', help='Path to OBJ or PLY file')
    parser.add_argument('--step-file', help='Path to STEP file (.step/.stp)')
    parser.add_argument('--output-file', required=False, help='Output GLB file path (optional with --use-gtin-naming)')
    parser.add_argument('--mtl-file', help='Path to MTL file')
    parser.add_argument('--mtl-reference', help='Target MTL filename as declared via mtllib')
    parser.add_argument('--texture-files', nargs='*', default=[], help='Texture file paths')
    parser.add_argument('--embed-textures', action='store_true', help='Embed textures in GLB')
    parser.add_argument('--use-ai', action='store_true', help='Use AI material recognition')
    parser.add_argument('--use-draco', action='store_true', help='Use Draco mesh compression')
    parser.add_argument('--material-finish', choices=['standard', 'galvanized', 'powder-coated', 'auto'], default='auto', help='Material-Preset (standard, verzinkt, pulverbeschichtet oder automatisch)')
    parser.add_argument('--output-format', choices=['glb', 'gltf'], default='glb', help='Output format')
    parser.add_argument('--scale', type=float, default=0.1, help='Scale factor (e.g., 0.01 for 1%%, 0.1 for 10%%)')
    parser.add_argument('--decimate-ratio', type=float, default=1.0, help='Mesh decimation ratio (0.1-1.0, e.g., 0.5 for 50%% polygons)')
    parser.add_argument('--tessellation-quality', type=float, default=0.1, help='Tessellation quality for STEP files (0.01-1.0, lower=higher quality)')
    parser.add_argument('--auto-label', action='store_true', help='Automatically label structural parts (Pfosten/Strebe/Fuß/Kappe)')
    parser.add_argument('--use-claude-ai', action='store_true', help='Enable Claude AI mesh classification')
    parser.add_argument('--gtin', help='GTIN code for filename lookup')
    parser.add_argument('--article-number', help='Article number for filename lookup')
    parser.add_argument('--use-gtin-naming', action='store_true', help='Enable GTIN-based filename generation')
    parser.add_argument('--rotate-y-up', action='store_true', help='Rotate 90° around X-axis to convert from Z-up to Y-up coordinate system')
    parser.add_argument('--rotate-axis', choices=['X', 'Y', 'Z'], default=None, help='Optional export rotation axis (mutually exclusive with --rotate-y-up)')
    parser.add_argument('--rotate-degrees', choices=['90', '180', '270'], default=None, help='Export rotation angle (use with --rotate-axis)')
    parser.add_argument('--import-up-axis', choices=['AUTO', 'X', 'Y', 'Z'], default='AUTO', help='Which axis points up in OBJ file (AUTO=Y for SolidWorks)')
    parser.add_argument('--keep-cameras-lights', action='store_true', help='Keep camera/light objects in the Blender scene (normally removed before export)')
    parser.add_argument('--preflight-only', action='store_true', help='Run import + preflight checks only (no optimize/export)')
    parser.add_argument('--no-preflight', action='store_true', help='Disable preflight material/color checks before export')
    parser.add_argument('--color-saturation', type=float, default=1.0, help='Global saturation multiplier for solid-color materials (0..2)')
    parser.add_argument('--color-brightness', type=float, default=1.0, help='Global brightness (value) multiplier for solid-color materials (0..2)')
    parser.add_argument('--roughness-multiplier', type=float, default=1.0, help='Global roughness multiplier for Principled materials (0..2)')
    parser.add_argument('--metallic-multiplier', type=float, default=1.0, help='Global metallic multiplier for Principled materials (0..2)')

    # User overrides (JSON payloads from API/Frontend)
    parser.add_argument('--selected-colors-json', help='JSON array of hex colors (e.g. ["#FF0000"])')
    parser.add_argument('--color-overrides-json', help='JSON map of color remaps (e.g. {"#FF0000":"#00FF00"})')
    parser.add_argument('--color-materials-json', help='JSON map of color->material preset (e.g. {"#FF0000":{"name":"Mat","kd":[1,0,0]}})')
    parser.add_argument('--preserve-mtl-colors', action='store_true', help='MTL-Farben beibehalten (kein Standardfarben-Mapping bei OBJ-Import)')
    parser.add_argument('--default-color-override', action='store_true', help='Produkt-Standardfarbe (z. B. RAL 7035): alle Materialien am Ende auf metallic=0 setzen')

    # Mesh fingerprint matching (Option A)
    parser.add_argument('--target-mesh-signature-json', help='JSON object describing the target mesh geometry signature')
    parser.add_argument('--target-mesh-signature-id', help='Optional signature id (debug)')
    parser.add_argument('--target-mesh-match-threshold', type=float, default=0.15, help='Match distance threshold (lower=stricter)')
    parser.add_argument('--target-mesh-material-json', help='JSON object describing the material preset to apply to the matched mesh')
    
    # Get arguments after '--' separator
    if '--' in sys.argv:
        script_args = sys.argv[sys.argv.index('--') + 1:]
    else:
        script_args = sys.argv[1:]  # Fallback to all args after script name
    
    args = parser.parse_args(script_args)
    
    # Validate: either obj-file or step-file must be provided
    if not args.obj_file and not args.step_file:
        parser.error("Either --obj-file or --step-file is required")
    
    if args.obj_file and args.step_file:
        parser.error("Only one of --obj-file or --step-file can be specified")
    
    # Check STEP converter availability if STEP file provided
    if args.step_file and not STEP_CONVERTER_AVAILABLE:
        parser.error("STEP converter not available. Install FreeCAD: pip install FreeCAD")
    
    # Validate: output-file is required unless we run preflight-only.
    if not args.output_file and not args.preflight_only:
        parser.error("--output-file is required")

    # Provide a deterministic fallback for preflight-only runs when output_file is omitted.
    if not args.output_file and args.preflight_only:
        base_output_dir = Path(os.environ.get('BLENDER_OUTPUT_DIR', Path(__file__).resolve().parents[1] / 'outputs')).resolve()
        base_output_dir.mkdir(parents=True, exist_ok=True)
        input_stem = Path(args.obj_file or args.step_file).stem
        args.output_file = str(base_output_dir / f"{input_stem}.{args.output_format}")
    
    return args


def main():
    """Main execution function"""
    try:
        # Parse arguments
        args = parse_arguments()

        def _safe_json(value: Optional[str]):
            if not value:
                return None
            try:
                return json.loads(value)
            except Exception:
                return None

        selected_colors = _safe_json(getattr(args, 'selected_colors_json', None))
        if isinstance(selected_colors, str):
            selected_colors = [selected_colors]
        if not isinstance(selected_colors, list):
            selected_colors = None

        color_overrides = _safe_json(getattr(args, 'color_overrides_json', None))
        if not isinstance(color_overrides, dict):
            color_overrides = None

        color_materials = _safe_json(getattr(args, 'color_materials_json', None))
        if not isinstance(color_materials, dict):
            color_materials = None

        target_mesh_signature = _safe_json(getattr(args, 'target_mesh_signature_json', None))
        if not isinstance(target_mesh_signature, dict):
            target_mesh_signature = None
        target_mesh_match_threshold = getattr(args, 'target_mesh_match_threshold', 0.15)

        target_mesh_material = _safe_json(getattr(args, 'target_mesh_material_json', None))
        if not isinstance(target_mesh_material, dict):
            target_mesh_material = None
        
        print(f"Starting conversion with Blender {bpy.app.version_string}")
        print(f"Job ID: {args.job_id}")
        
        # Determine input file type and display info
        if args.obj_file:
            print(f"OBJ file: {args.obj_file}")
            input_type = "OBJ"
            input_file = args.obj_file
        else:
            print(f"STEP file: {args.step_file}")
            input_type = "STEP"
            input_file = args.step_file
            
        print(f"Output file: {args.output_file}")
        
        # Create converter
        converter = BlenderOBJToGLBConverter()
        
        # Perform conversion based on input type
        if input_type == "STEP":
            result = converter.convert_step_to_glb(
                step_file=input_file,
                output_path=args.output_file,
                texture_files=args.texture_files if args.texture_files else None,
                tessellation_quality=args.tessellation_quality,
                embed_textures=args.embed_textures,
                useAI=args.use_ai,
                use_draco=args.use_draco,
                output_format=args.output_format,
                scale=args.scale,
                decimate_ratio=args.decimate_ratio,
                auto_label_parts=args.auto_label,
                gtin=args.gtin,
                article_number=args.article_number,
                use_gtin_naming=args.use_gtin_naming,
                rotate_y_up=args.rotate_y_up,
                rotateAxis=getattr(args, 'rotate_axis', None),
                rotateDegrees=getattr(args, 'rotate_degrees', None),
                import_up_axis=args.import_up_axis,
                material_finish=args.material_finish,
                keepCamerasLights=args.keep_cameras_lights,
                enablePreflight=(not args.no_preflight),
                colorSaturation=args.color_saturation,
                colorBrightness=args.color_brightness,
                roughnessMultiplier=args.roughness_multiplier,
                metallicMultiplier=args.metallic_multiplier,
                selectedColors=selected_colors,
                colorOverrides=color_overrides,
                colorMaterials=color_materials,
                targetMeshSignature=target_mesh_signature,
                targetMeshMatchThreshold=target_mesh_match_threshold,
                targetMeshMaterial=target_mesh_material,
                preflightOnly=args.preflight_only,
                defaultColorOverride=getattr(args, 'default_color_override', False),
            )
        else:
            # OBJ to GLB conversion
            result = converter.convert(
                obj_path=args.obj_file,
                output_path=args.output_file,
                mtl_path=args.mtl_file,
                mtl_reference=args.mtl_reference,
                texture_files=args.texture_files,
                embed_textures=args.embed_textures,
                use_ai=args.use_ai,
                use_draco=args.use_draco,
                output_format=args.output_format,
                scale=args.scale,
                decimate_ratio=args.decimate_ratio,
                auto_label=args.auto_label,
                use_claude_ai=args.use_claude_ai,
                gtin=args.gtin,
                article_number=args.article_number,
                use_gtin_naming=args.use_gtin_naming,
                rotate_y_up=args.rotate_y_up,
                rotate_axis=getattr(args, 'rotate_axis', None),
                rotate_degrees=getattr(args, 'rotate_degrees', None),
                import_up_axis=args.import_up_axis,
                material_finish=args.material_finish,
                strip_cameras_lights=(not args.keep_cameras_lights),
                enable_preflight=(not args.no_preflight),
                color_saturation=args.color_saturation,
                color_brightness=args.color_brightness,
                roughness_multiplier=args.roughness_multiplier,
                metallic_multiplier=args.metallic_multiplier,
                selected_colors=selected_colors,
                color_overrides=color_overrides,
                color_materials=color_materials,
                target_mesh_signature=target_mesh_signature,
                target_mesh_match_threshold=target_mesh_match_threshold,
                target_mesh_material=target_mesh_material,
                preflight_only=args.preflight_only,
                preserve_mtl_colors=getattr(args, 'preserve_mtl_colors', False),
                default_color_override=getattr(args, 'default_color_override', False),
            )
        
        # Print result as JSON for MCP server to parse
        print("=== CONVERSION_RESULT ===")
        print(json.dumps(result, indent=2))
        
        # Exit with appropriate code
        sys.exit(0 if result["success"] else 1)
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": f"Script execution failed: {str(e)}",
            "logs": [
                {
                    "timestamp": "2024-11-07T00:00:00Z",
                    "level": "ERROR",
                    "message": str(e)
                }
            ]
        }
        print("=== CONVERSION_RESULT ===")
        print(json.dumps(error_result, indent=2))
        sys.exit(1)


if __name__ == "__main__":
    main()