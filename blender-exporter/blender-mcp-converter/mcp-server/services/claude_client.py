"""
Claude AI Client for Mesh Classification
Uses Anthropic API to intelligently classify 3D mesh components
"""

import os
import json
import base64
import logging
from typing import Dict, List, Any, Optional
from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)


class ClaudeMeshAnalyzer:
    """
    Intelligente Mesh-Klassifikation mittels Claude AI
    
    Features:
    - Text-basierte Feature-Analyse
    - Optional: Vision API für Preview-Bilder
    - Confidence Scoring
    - Batch-Processing für Kostenoptimierung
    """
    
    def __init__(self):
        """Initialize Claude client"""
        
        self.api_key = os.getenv("CLAUDE_API_KEY")
        if not self.api_key:
            raise ValueError("CLAUDE_API_KEY not found in environment")
        
        self.client = AsyncAnthropic(api_key=self.api_key)
        
        # Configuration
        self.model = os.getenv("CLAUDE_MODEL", "claude-3-opus-20240229")
        self.max_tokens = int(os.getenv("CLAUDE_MAX_TOKENS", "1024"))
        self.temperature = float(os.getenv("CLAUDE_TEMPERATURE", "0.0"))
        self.use_vision = os.getenv("CLAUDE_USE_VISION", "false").lower() == "true"
        
        logger.info(f"Initialized Claude client with model: {self.model}")
    
    async def analyze_mesh_structure(
        self,
        mesh_features: Dict[str, Any],
        preview_image: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """
        Analysiert ein einzelnes Mesh mittels Claude AI
        
        Args:
            mesh_features: Geometrische & materielle Features aus Blender
            preview_image: Optional JPEG/PNG Preview (bytes)
        
        Returns:
            {
                "classification": str,  # Pfosten/Strebe/Fuß/Kappe/Teil
                "confidence": float,    # 0.0 - 1.0
                "reasoning": str,       # AI-Begründung
                "suggested_name": str,  # z.B. "Pfosten_01"
                "alternative_labels": [{label, confidence}, ...]
            }
        """
        
        try:
            prompt = self._build_classification_prompt(mesh_features)
            
            messages = [{
                "role": "user",
                "content": []
            }]
            
            # Text-Features (immer)
            messages[0]["content"].append({
                "type": "text",
                "text": prompt
            })
            
            # Vision (optional)
            if self.use_vision and preview_image:
                messages[0]["content"].append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.b64encode(preview_image).decode()
                    }
                })
                logger.debug(f"Vision enabled for {mesh_features.get('object_name', 'unknown')}")
            
            # Claude API Call
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                temperature=self.temperature,
                messages=messages
            )
            
            # Parse & Return
            result = self._parse_classification_response(response)
            
            logger.info(
                f"Classified {mesh_features.get('object_name')}: "
                f"{result['classification']} (conf: {result['confidence']:.2f})"
            )
            
            return result
            
        except Exception as e:
            error_msg = str(e)
            
            # Check for specific error types
            if "credit balance is too low" in error_msg.lower():
                logger.error("❌ CLAUDE API: Insufficient credits! Please add funds to your Anthropic account.")
            elif "rate_limit" in error_msg.lower():
                logger.warning("⚠️  CLAUDE API: Rate limit exceeded")
            elif "invalid_request_error" in error_msg.lower():
                logger.error(f"❌ CLAUDE API: Invalid request - {error_msg}")
            else:
                logger.error(f"Claude classification failed: {e}")
            
            return {
                "classification": "Teil",
                "confidence": 0.0,
                "reasoning": f"AI error: {str(e)[:200]}",  # Truncate long errors
                "suggested_name": "Unbekannt",
                "alternative_labels": []
            }
    
    async def analyze_batch(
        self,
        mesh_features_list: List[Dict[str, Any]],
        max_per_request: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Batch-Klassifikation für Kostenoptimierung
        
        Args:
            mesh_features_list: Liste von Mesh-Features
            max_per_request: Max Meshes pro API Call (Claude Context Limit)
        
        Returns:
            Liste von Classification-Results
        """
        
        results = []
        
        # Chunk in batches
        for i in range(0, len(mesh_features_list), max_per_request):
            batch = mesh_features_list[i:i + max_per_request]
            
            try:
                batch_result = await self._classify_batch(batch)
                results.extend(batch_result)
            except Exception as e:
                logger.error(f"Batch classification failed: {e}")
                # Fallback: einzeln klassifizieren
                for features in batch:
                    result = await self.analyze_mesh_structure(features)
                    results.append(result)
        
        return results
    
    def _build_classification_prompt(self, features: Dict) -> str:
        """Konstruiert den Klassifikations-Prompt für Claude"""
        
        bbox = features.get('bbox', {})
        aspect = features.get('aspect_ratios', {})
        pos = features.get('position', {})
        color = features.get('color_signature', [0, 0, 0])
        
        return f"""Du bist ein Experte für Fachwerk-Strukturen und 3D-Mesh-Analyse. Analysiere folgendes Bauteil eines Gerüstsystems.

**WICHTIG:** Nutze die geometrischen REGELN strikt. Achte besonders auf:
- Exakte Höhenverhältnisse (Fuß: max 10cm, Kappe: 3-4cm)
- Positionsrelationen (Wand zwischen Pfosten, Fuß unter Pfosten, Kappe auf Pfosten)
- Dimensionsvergleiche (Fuß breiter als Pfosten, Streben dünner als Pfosten)

**GEOMETRIE:**
- Abmessungen: {bbox.get('dx', 0):.1f} × {bbox.get('dy', 0):.1f} × {bbox.get('dz', 0):.1f} mm
- Volumen: {features.get('volume', 0):.4f} m³
- Schlankheit vertikal (Z/XY): {aspect.get('vertical', 0):.2f}
- Schlankheit horizontal (XY/Z): {aspect.get('horizontal', 0):.2f}
- Vertices: {features.get('vertex_count', 0)}, Faces: {features.get('face_count', 0)}

**POSITION IM MODELL:**
- Abstand zum Boden (relativ): {pos.get('base_ratio', 0):.3f} (0=Boden, 1=Top)
- Abstand zur Decke (relativ): {pos.get('top_ratio', 0):.3f}
- Zentrum-Höhe (relativ): {pos.get('center_ratio', 0):.3f}

**MATERIAL:**
- Hauptfarbe RGB: {color}
- Materialien: {', '.join(features.get('materials', ['unbekannt']))}

**KONTEXT:**
- Gesamthöhe Modell: {features.get('scene_height', 0):.1f} mm
- Anzahl Pfosten: {features.get('post_count', 0)}

**KLASSIFIKATIONS-KATEGORIEN:**

1. **Pfosten** (Tragende vertikale Säule)
   - KRITISCHE REGEL: Höhe ist ein VIELFACHES (multiple) von Länge oder Breite
     - Z-Dimension ist 10x, 20x, 30x, etc. der XY-Dimension
     - Beispiel: 50mm Querschnitt → 500mm, 1000mm, 1500mm, 2000mm Höhe
   - Symmetrie: Pfosten kommen IMMER paarweise vor
     - Pfosten 1 und Pfosten 2 sind direkt gegenüber nur GESPIEGELT
     - Gleiche Dimensionen, gleiche Höhe, symmetrische XY-Position
   - Position: Startet am Boden (base_ratio ≈ 0)
   - Schlankheit vertikal typisch > 15-20
   - WICHTIG: Prüfe Symmetrie mit anderen vertikalen Elementen

2. **Wand** (Vertikale Platte zwischen Pfosten)
   - KRITISCHE REGEL: Annähernd so hoch wie die Pfosten
     - Z-Dimension ähnlich zu Pfosten-Höhe (±10%)
     - Beispiel: Pfosten 2000mm → Wand 1800-2000mm hoch
   - Position: IMMER zwischen den Pfosten platziert
     - XY-Überlappung mit beiden Pfosten prüfen
     - Liegt räumlich zwischen zwei gegenüberliegenden Pfosten
   - Geometrie: Sehr dünn (kleine Tiefe), große Fläche
     - Eine Dimension << andere Dimensionen (Platte)
     - Aspect ratio: längste/kürzeste Dimension > 5
   - Mittlere Höhe: center_ratio zwischen 0.15 und 0.85
   - Beispiel: 1200×15×1800mm (breit × dünn × hoch wie Pfosten)

3. **Strebe** (Horizontale/diagonale Verbindung)
   - KRITISCHE REGEL: Einzelne Teile zwischen den Pfosten
     - Verbindet zwei Pfosten horizontal oder diagonal
     - Längste Dimension entspricht Abstand zwischen Pfosten
   - Geometrie: IMMER dünner als die Pfosten
     - Querschnitt < Pfosten-Querschnitt
     - Beispiel: Pfosten 50×50mm → Strebe 30×30mm oder dünner
   - Position: Mittlere Höhe (center_ratio 0.2-0.8)
     - Nicht am Boden, nicht ganz oben
   - Schlankheit: Langgestreckt in horizontaler Richtung
   - Beispiel: 30×30×800mm (dünn × dünn × lang horizontal)

4. **Fuß** (Sockel am Pfostenfuß)
   - KRITISCHE REGEL: IMMER unten direkt unter den Pfosten
     - Position: Am Boden (base_ratio ≈ 0-0.05)
     - XY-Überlappung mit Pfosten (steht darunter)
   - KRITISCHE REGEL: Etwas breiter UND tiefer als der Pfosten
     - XY-Dimensionen > Pfosten-XY-Dimensionen
     - Beispiel: Pfosten 50×50mm → Fuß 70×70mm, 80×80mm
   - KRITISCHE REGEL: Höhe MAX 10cm (100mm)
     - Z-Dimension MUSS <= 100mm sein
     - Typisch: 40-80mm hoch
   - Funktion: Stützt Pfosten, verteilt Last
   - Beispiel: 80×80×50mm für 50×50mm Pfosten
   - WICHTIG: Alle drei Kriterien müssen erfüllt sein (unten, breiter, <100mm)

5. **Kappe** (Abschluss am Pfostenkopf)
   - KRITISCHE REGEL: IMMER oben an den Pfosten angebracht
     - Position: Ganz oben (top_ratio ≈ 0-0.05)
     - XY-Überlappung mit Pfosten (sitzt darauf)
   - KRITISCHE REGEL: Breite/Tiefe annähernd gleich wie Pfosten
     - XY-Dimensionen ≈ Pfosten-XY-Dimensionen (±20%)
     - Beispiel: Pfosten 50×50mm → Kappe 55×55mm, 60×60mm
   - KRITISCHE REGEL: Höhe 3-4cm (30-40mm)
     - Z-Dimension zwischen 25-45mm
     - Typisch: 35mm
   - Besonderheit: Steckt zu einem Teil IN die Pfosten
     - Teilweise Insertion in Pfosten-Oberkante
     - XY-Zentrum sollte mit Pfosten-Zentrum übereinstimmen
   - Beispiel: 60×60×40mm für 50×50mm Pfosten
   - WICHTIG: Alle drei Kriterien (oben, gleicher Querschnitt, 30-40mm) prüfen

6. **Teil** (Unklassifizierbar)
   - Verwende NUR, wenn KEINE der obigen Kategorien eindeutig passt
   - Letzte Wahl bei untypischer Geometrie oder Position
   - Beispiele: Verbindungselemente, Clips, unklare Bauteile

**ANTWORT-FORMAT (JSON):**

{{
  "classification": "Pfosten|Strebe|Fuß|Kappe|Teil",
  "confidence": 0.95,
  "reasoning": "Begründung: Vertikales Element mit Schlankheit 25, startet am Boden → typischer Pfosten",
  "suggested_name": "Pfosten_01",
  "alternative_labels": [
    {{"label": "Teil", "confidence": 0.05}}
  ]
}}

Analysiere präzise und antworte NUR mit dem JSON (keine Markdown-Blöcke)."""

    def _parse_classification_response(self, response) -> Dict:
        """Parsed Claude's JSON response"""
        
        text = response.content[0].text.strip()
        
        # JSON extrahieren (Claude wrapped manchmal in ```json```)
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        
        try:
            result = json.loads(text)
            
            # Validierung
            if "classification" not in result:
                raise ValueError("Missing classification field")
            
            # Defaults
            result.setdefault("confidence", 0.5)
            result.setdefault("reasoning", "")
            result.setdefault("suggested_name", result["classification"])
            result.setdefault("alternative_labels", [])
            
            return result
            
        except (json.JSONDecodeError, ValueError) as e:
            logger.error(f"JSON parse error: {e}\nResponse: {text}")
            return {
                "classification": "Teil",
                "confidence": 0.0,
                "reasoning": f"Parse error: {str(e)}",
                "suggested_name": "Unbekannt",
                "alternative_labels": []
            }
    
    async def _classify_batch(self, batch: List[Dict]) -> List[Dict]:
        """Klassifiziert mehrere Meshes in einem Request (Kostenoptimierung)"""
        
        # Batch-Prompt konstruieren
        batch_prompt = "Klassifiziere folgende Mesh-Bauteile (antworte mit JSON-Array):\n\n"
        
        for i, features in enumerate(batch):
            batch_prompt += f"--- MESH {i+1} ---\n"
            batch_prompt += self._build_classification_prompt(features)
            batch_prompt += "\n\n"
        
        batch_prompt += "\nAntworte mit JSON-Array: [{classification, confidence, ...}, ...]"
        
        messages = [{
            "role": "user",
            "content": [{"type": "text", "text": batch_prompt}]
        }]
        
        response = await self.client.messages.create(
            model=self.model,
            max_tokens=self.max_tokens * len(batch),  # Mehr Tokens für Batch
            temperature=self.temperature,
            messages=messages
        )
        
        # Parse Array
        text = response.content[0].text.strip()
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        
        results = json.loads(text)
        
        # Ensure list
        if not isinstance(results, list):
            results = [results]
        
        return results


# Singleton Instance
_claude_analyzer = None

def get_claude_analyzer() -> ClaudeMeshAnalyzer:
    """Factory für Singleton Instance"""
    global _claude_analyzer
    if _claude_analyzer is None:
        _claude_analyzer = ClaudeMeshAnalyzer()
    return _claude_analyzer
