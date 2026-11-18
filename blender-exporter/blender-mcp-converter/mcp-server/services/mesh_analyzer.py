"""
Mesh Feature Analyzer
Extrahiert strukturelle Features aus Mesh-Daten für AI-Klassifikation
"""

import logging
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)


class MeshFeatureExtractor:
    """
    Analysiert und extrahiert relevante Features aus Mesh-Geometrie
    
    Für zukünftige Erweiterungen:
    - Material-Feature-Extraktion
    - Topologie-Analyse
    - Oberflächenqualität
    """
    
    @staticmethod
    def extract_features(
        bbox: Dict[str, float],
        mesh_data: Optional[Dict] = None,
        scene_context: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Extrahiert alle Features aus Mesh-Daten
        
        Args:
            bbox: Bounding Box {dx, dy, dz, min, max}
            mesh_data: {vertex_count, face_count, materials, color_signature}
            scene_context: {scene_height, post_count, global_min_z, global_max_z}
        
        Returns:
            Feature-Dictionary für Claude API
        """
        
        mesh_data = mesh_data or {}
        scene_context = scene_context or {}
        
        dx = bbox.get('dx', 0)
        dy = bbox.get('dy', 0)
        dz = bbox.get('dz', 0)
        
        # Geometrische Ratios
        max_horiz = max(dx, dy)
        aspect_vertical = dz / max_horiz if max_horiz > 0 else 0
        aspect_horizontal = max_horiz / dz if dz > 0 else 0
        
        # Volumen
        volume = (dx / 1000) * (dy / 1000) * (dz / 1000)  # m³
        
        # Position (relativ zur Szene)
        scene_h = scene_context.get('scene_height', dz)
        min_z = bbox.get('min', [0, 0, 0])[2]
        max_z = bbox.get('max', [0, 0, 0])[2]
        global_min_z = scene_context.get('global_min_z', min_z)
        global_max_z = scene_context.get('global_max_z', max_z)
        
        base_ratio = (min_z - global_min_z) / scene_h if scene_h > 0 else 0
        top_ratio = (global_max_z - max_z) / scene_h if scene_h > 0 else 0
        center_z = (min_z + max_z) / 2.0
        center_ratio = (center_z - global_min_z) / scene_h if scene_h > 0 else 0
        
        features = {
            "object_name": mesh_data.get('object_name', 'unknown'),
            "bbox": bbox,
            "volume": volume,
            "aspect_ratios": {
                "vertical": aspect_vertical,
                "horizontal": aspect_horizontal
            },
            "position": {
                "base_ratio": base_ratio,
                "top_ratio": top_ratio,
                "center_ratio": center_ratio
            },
            "color_signature": mesh_data.get('color_signature', [128, 128, 128]),
            "materials": mesh_data.get('materials', ['default']),
            "vertex_count": mesh_data.get('vertex_count', 0),
            "face_count": mesh_data.get('face_count', 0),
            "scene_height": scene_h,
            "post_count": scene_context.get('post_count', 0)
        }
        
        logger.debug(f"Extracted features for {features['object_name']}: aspect_v={aspect_vertical:.2f}")
        
        return features
    
    @staticmethod
    def validate_features(features: Dict[str, Any]) -> bool:
        """
        Validiert Feature-Dictionary
        
        Returns:
            True wenn alle Required-Fields vorhanden
        """
        
        required = ['bbox', 'aspect_ratios', 'position']
        
        for field in required:
            if field not in features:
                logger.warning(f"Missing required field: {field}")
                return False
        
        return True
    
    @staticmethod
    def enrich_with_material_data(
        features: Dict[str, Any],
        material_db: Optional[Dict] = None
    ) -> Dict[str, Any]:
        """
        Erweitert Features mit Material-Datenbank-Infos
        
        Vorbereitung für zukünftige Material-Zuweisung
        
        Args:
            features: Basis-Features
            material_db: {material_name: {properties...}}
        
        Returns:
            Angereichertes Feature-Dict
        """
        
        if not material_db:
            return features
        
        materials = features.get('materials', [])
        material_properties = []
        
        for mat_name in materials:
            if mat_name in material_db:
                material_properties.append(material_db[mat_name])
        
        if material_properties:
            features['material_properties'] = material_properties
        
        return features
