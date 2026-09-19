from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi import UploadFile, File
from pydantic import BaseModel, Field, root_validator
from typing import List, Optional, Dict, Any
import subprocess
import os
import sys
import json
import asyncio
from pathlib import Path
import tempfile
import shutil
from loguru import logger
import yaml
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import Claude services
from services.claude_client import get_claude_analyzer
from services.mesh_analyzer import MeshFeatureExtractor

# Load MCP configuration
with open("mcp.yaml", "r") as f:
    config = yaml.safe_load(f)

def detect_blender_executable():
    """
    Auto-detect Blender executable on different platforms.
    Uses BLENDER_PATH or BLENDER_EXECUTABLE env var if set (and not "auto").
    """
    env_path = os.environ.get("BLENDER_PATH") or os.environ.get("BLENDER_EXECUTABLE")
    if env_path and env_path.strip().lower() != "auto":
        path = Path(env_path.strip()).resolve()
        if path.is_file():
            logger.info(f"Using Blender from env: {path}")
            return str(path)
        if path.is_dir() and (path / "blender.exe").is_file():
            exe = path / "blender.exe"
            logger.info(f"Using Blender from env: {exe}")
            return str(exe)

    # Build platform-specific candidate list
    possible_paths = [
        "blender",  # In PATH
    ]
    if sys.platform == "darwin":
        possible_paths.extend([
            "/Applications/Blender.app/Contents/MacOS/Blender",
            "/usr/local/bin/blender",
        ])
    elif sys.platform == "win32":
        # Windows: Program Files and Program Files (x86), common versioned installs
        for base in [
            os.environ.get("ProgramFiles", "C:\\Program Files"),
            os.environ.get("ProgramFiles(x86)", "C:\\Program Files (x86)"),
        ]:
            bf = Path(base) / "Blender Foundation"
            if bf.is_dir():
                for sub in sorted(bf.iterdir(), reverse=True):
                    if sub.is_dir():
                        exe = sub / "blender.exe"
                        if exe.is_file():
                            possible_paths.append(str(exe))
        possible_paths.extend([
            "C:\\Program Files\\Blender Foundation\\Blender 4.2\\blender.exe",
            "C:\\Program Files\\Blender Foundation\\Blender 4.1\\blender.exe",
            "C:\\Program Files\\Blender Foundation\\Blender 4.0\\blender.exe",
        ])
    else:
        possible_paths.extend([
            "/opt/blender/blender",
            "/usr/bin/blender",
        ])

    for path in possible_paths:
        if not path:
            continue
        if shutil.which(path):
            logger.info(f"Found Blender executable: {path}")
            return path
        p = Path(path)
        if p.is_file() and os.access(path, os.X_OK):
            logger.info(f"Found Blender executable: {path}")
            return path
        if p.is_file():  # Windows: .exe may not have X_OK in same way
            logger.info(f"Found Blender executable: {path}")
            return path

    logger.error("Blender executable not found in common locations. Set BLENDER_PATH to your blender.exe path.")
    raise FileNotFoundError("Blender executable not found")

app = FastAPI(
    title=config["name"],
    version=config["version"],
    description=config["description"]
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify allowed origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logger.add(
    "logs/mcp_server.log",
    rotation="10 MB",
    level=config["logging"]["level"],
    format=config["logging"]["format"]
)

class BlenderConvertParams(BaseModel):
    """Parameters for Blender conversion tool"""
    jobId: str = Field(..., description="Unique job identifier")
    objFile: Optional[str] = Field(None, description="Path to the OBJ file")
    stepFile: Optional[str] = Field(None, description="Path to the STEP file (.step/.stp)")
    mtlFile: Optional[str] = Field(None, description="Path to the MTL file")
    mtlReference: Optional[str] = Field(None, description="Optional target MTL filename from mtllib directive")
    textureFiles: List[str] = Field(default=[], description="Array of texture file paths")
    options: Dict[str, Any] = Field(
        default={
            "embedTextures": True,
            "useAI": False,
            "tessellationQuality": 0.1,
            "outputFormat": "glb",
            "importUpAxis": "AUTO"
        },
        description="Conversion options (importUpAxis: AUTO, X, Y, or Z)"
    )


class BlenderAutomationParams(BaseModel):
    """Parameters for Blender automation jobs"""
    jobId: str = Field(..., description="Unique job identifier")
    blendFile: str = Field(..., description="Path to the Blender .blend scene file")
    recipe: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Inline JSON recipe object containing an actions array"
    )
    recipeFile: Optional[str] = Field(
        default=None,
        description="Path to an existing recipe JSON file"
    )
    options: Dict[str, Any] = Field(
        default_factory=dict,
        description="Extra options (dryRun, outputRoot)"
    )

    @root_validator(skip_on_failure=True)
    def validate_files(cls, values):
        """Validate input files and options"""
        obj_file = values.get('objFile')
        step_file = values.get('stepFile')
        
        # Either OBJ or STEP file must be provided
        if not obj_file and not step_file:
            raise ValueError("Either objFile or stepFile must be provided")
        if obj_file and step_file:
            raise ValueError("Only one of objFile or stepFile can be specified")
        
        # Validate OBJ file
        if obj_file and not os.path.exists(obj_file):
            raise ValueError(f"OBJ file not found: {obj_file}")
        
        # Validate STEP file
        if step_file:
            if not os.path.exists(step_file):
                raise ValueError(f"STEP file not found: {step_file}")
            if not step_file.lower().endswith(('.step', '.stp')):
                raise ValueError(f"STEP file must have .step or .stp extension: {step_file}")
        
        return values
    def validate_recipe_source(cls, values):  # noqa: B902 (pydantic signature)
        if not values.get("recipe") and not values.get("recipeFile"):
            raise ValueError("Either 'recipe' or 'recipeFile' must be provided")
        return values

class MCPRequest(BaseModel):
    """MCP tool call request format"""
    method: str = Field(..., description="Tool name to call")
    params: Dict[str, Any] = Field(..., description="Tool parameters")

class MCPResponse(BaseModel):
    """MCP tool call response format"""
    success: bool
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None

class BlenderConverter:
    """Handles Blender conversion operations"""
    
    def __init__(self):
        blender_config = config["blender"]["executable"]
        if blender_config == "auto":
            self.blender_executable = detect_blender_executable()
        else:
            self.blender_executable = blender_config
        
        self.script_path = Path(config["blender"]["script_path"]).resolve()
        self.timeout = config["blender"]["timeout"]
        self.output_dir = Path(os.environ.get("BLENDER_OUTPUT_DIR", "../outputs")).resolve()
        self.output_dir.mkdir(parents=True, exist_ok=True)
        os.environ.setdefault("BLENDER_OUTPUT_DIR", str(self.output_dir))
        
        logger.info(f"Blender executable: {self.blender_executable}")
        logger.info(f"Script path: {self.script_path}")
        logger.info(f"Output directory: {self.output_dir}")
    
    def _resolve_gtin_filename_for_skip(self, gtin: Optional[str], article_number: Optional[str], fallback_name: str, output_format: str) -> Optional[str]:
        """Resolve GTIN-aware filename to mirror Blender script output before spawning Blender."""
        if not gtin and not article_number:
            return None

        gtin_enabled = os.getenv("GTIN_ENABLED", "false").lower() == "true"
        if not gtin_enabled:
            return None

        try:
            from services.gtin_naming import get_gtin_service

            gtin_service = get_gtin_service()
            result = gtin_service.get_filename(
                gtin=gtin,
                article_number=article_number,
                fallback_name=fallback_name,
                extension=output_format,
            )
            filename = result.get("filename")
            if filename:
                return filename
        except Exception as exc:  # noqa: BLE001
            logger.warning(f"GTIN filename resolution failed during overwrite check: {exc}")
        return None

    async def convert_to_glb(self, params: BlenderConvertParams) -> Dict[str, Any]:
        """
        Convert OBJ/STEP to GLB using Blender
        """
        job_id = params.jobId
        logger.info(f"Starting Blender conversion for job {job_id}")
        
        try:
            # Determine input file type and prepare output path
            if params.objFile:
                input_path = Path(params.objFile)
                input_type = "OBJ"
                logger.info(f"Processing OBJ file: {params.objFile}")
            elif params.stepFile:
                input_path = Path(params.stepFile)
                input_type = "STEP"
                logger.info(f"Processing STEP file: {params.stepFile}")
            else:
                raise ValueError("No input file specified")
            
            # Prepare output filename
            input_basename = input_path.stem
            output_format = params.options.get('outputFormat', 'glb')
            output_filename = f"{input_basename}.{output_format}"
            output_path = self.output_dir / output_filename
            
            logger.info(f"Output filename: {input_basename}.{input_path.suffix} -> {output_filename}")

            preflight_only = bool(params.options.get("preflightOnly", False))

            overwrite_existing = params.options.get("overwriteExisting", True)
            use_gtin_naming = params.options.get("useGTINNaming", False)
            gtin_option = params.options.get("gtin")
            article_option = params.options.get("articleNumber")

            # Mirror article number auto-derivation for GTIN naming to ensure consistent path checks
            derived_article = article_option
            if not derived_article and params.objFile:
                derived_article = Path(params.objFile).stem
            if not derived_article and params.stepFile:
                derived_article = Path(params.stepFile).stem

            # Preflight-only should always run and should not be skipped by existing outputs.
            if (not preflight_only) and (not overwrite_existing):
                candidate_paths = {output_path}
                if use_gtin_naming and (gtin_option or derived_article):
                    resolved_name = self._resolve_gtin_filename_for_skip(gtin_option, derived_article, input_basename, output_format)
                    if resolved_name:
                        candidate_paths.add(self.output_dir / resolved_name)

                existing_path = None
                for candidate in candidate_paths:
                    try:
                        if candidate.is_file():
                            existing_path = candidate
                            break
                    except OSError as exc:  # noqa: BLE001
                        logger.warning(f"Failed to check candidate path {candidate} during overwrite check: {exc}")

                if existing_path is not None:
                    message = f"Skipping Blender conversion for job {job_id}: output already exists at {existing_path}"
                    logger.info(message)
                    size = None
                    try:
                        size = existing_path.stat().st_size
                    except OSError as exc:  # noqa: BLE001
                        logger.warning(f"Failed to stat existing output {existing_path}: {exc}")

                    log_entry = {
                        "timestamp": datetime.now().isoformat(),
                        "level": "INFO",
                        "message": message,
                    }

                    return {
                        "outputPath": str(existing_path),
                        "fileSize": size,
                        "logs": [log_entry],
                        "skipped": True,
                        "skippedReason": "existing_output"
                    }
            
            # Prepare Blender command arguments
            blender_args = [
                self.blender_executable,
                "--background",
                "--python", str(self.script_path),
                "--",
                "--job-id", job_id
            ]
            
            # Add input file based on type
            if input_type == "OBJ":
                blender_args.extend(["--obj-file", str(params.objFile)])
            elif input_type == "STEP":
                blender_args.extend(["--step-file", str(params.stepFile)])
                # Add tessellation quality for STEP files
                tessellation_quality = params.options.get("tessellationQuality", 0.1)
                blender_args.extend(["--tessellation-quality", str(tessellation_quality)])
            
            blender_args.extend(["--output-format", params.options.get("outputFormat", "glb")])
            
            # Always add output-file (used as fallback if GTIN naming fails or is disabled)
            blender_args.extend(["--output-file", str(output_path)])

            if preflight_only:
                blender_args.append("--preflight-only")
            
            # Add optional parameters
            if params.mtlFile:
                blender_args.extend(["--mtl-file", params.mtlFile])
            if params.mtlReference:
                blender_args.extend(["--mtl-reference", params.mtlReference])
            
            if params.textureFiles:
                blender_args.extend(["--texture-files"] + params.textureFiles)
            
            if params.options.get("embedTextures", True):
                blender_args.append("--embed-textures")
            
            if params.options.get("useAI", False):
                blender_args.append("--use-ai")
            
            # Bei bakeYUp + useDraco: Blender ohne Draco exportieren, danach Bake → Draco (Bake vor Draco)
            bake_yup = params.options.get("bakeYUp") or params.options.get("rotateYUp")
            bake_yup_on = bake_yup in (True, "true", "True", "1", 1)
            use_draco = params.options.get("useDraco") in (True, "true", "True", "1", 1)
            if use_draco and not bake_yup_on:
                blender_args.append("--use-draco")
            
            # Add scale parameter (default 0.1 = project "original size")
            scale = params.options.get("scale", 0.1)
            blender_args.extend(["--scale", str(scale)])
            
            # Add decimate ratio parameter (default 1.0 = no decimation)
            decimate_ratio = params.options.get("decimateRatio", 1.0)
            blender_args.extend(["--decimate-ratio", str(decimate_ratio)])
            
            # Add import up-axis parameter (default AUTO = Y-Up for SolidWorks)
            import_up_axis = params.options.get("importUpAxis", "AUTO")
            blender_args.extend(["--import-up-axis", str(import_up_axis)])

            material_finish = params.options.get("materialFinish")
            if material_finish:
                blender_args.extend(["--material-finish", str(material_finish)])

            # Preflight + global adjustments
            enable_preflight = params.options.get("enablePreflight", True)
            if enable_preflight is False:
                blender_args.append("--no-preflight")

            def _append_float_flag(flag: str, value: Any, default_value: float = 1.0):
                try:
                    if value is None:
                        return
                    numeric = float(value)
                    if not (numeric == default_value):
                        blender_args.extend([flag, str(numeric)])
                except Exception:
                    return

            _append_float_flag("--color-saturation", params.options.get("colorSaturation"), 1.0)
            _append_float_flag("--color-brightness", params.options.get("colorBrightness"), 1.0)
            _append_float_flag("--roughness-multiplier", params.options.get("roughnessMultiplier"), 1.0)
            _append_float_flag("--metallic-multiplier", params.options.get("metallicMultiplier"), 1.0)

            def _append_json_flag(flag: str, value: Any):
                if value is None:
                    return
                try:
                    encoded = json.dumps(value, separators=(',', ':'), ensure_ascii=False)
                    blender_args.extend([flag, encoded])
                except Exception:
                    return

            _append_json_flag("--selected-colors-json", params.options.get("selectedColors"))
            _append_json_flag("--color-overrides-json", params.options.get("colorOverrides"))
            _append_json_flag("--color-materials-json", params.options.get("colorMaterials"))
            if params.options.get("preserveMtlColors"):
                blender_args.append("--preserve-mtl-colors")
            if params.options.get("defaultColorOverride"):
                blender_args.append("--default-color-override")

            # Mesh fingerprint matching (Option A)
            _append_json_flag("--target-mesh-signature-json", params.options.get("targetMeshSignature"))
            _append_float_flag("--target-mesh-match-threshold", params.options.get("targetMeshMatchThreshold"), 0.15)
            target_mesh_signature_id = params.options.get("targetMeshSignatureId")
            if isinstance(target_mesh_signature_id, str) and target_mesh_signature_id.strip():
                blender_args.extend(["--target-mesh-signature-id", target_mesh_signature_id.strip()])

            _append_json_flag("--target-mesh-material-json", params.options.get("targetMeshMaterial"))

            # Optional auto labeling of parts (off by default)
            if params.options.get("autoLabelParts", False):
                blender_args.append("--auto-label")

            # Scene cleanup (default behavior is to strip cameras/lights)
            keep_cameras_lights = bool(params.options.get("keepCamerasLights", False))
            strip_cameras_lights = params.options.get("stripCamerasLights", True)
            if (strip_cameras_lights is False) or keep_cameras_lights:
                blender_args.append("--keep-cameras-lights")
            
            # === NEW: Claude AI Integration ===
            if params.options.get("useClaudeAI", False):
                blender_args.append("--use-claude-ai")
            
            # === NEW: GTIN Naming ===
            if params.options.get("useGTINNaming", False):
                blender_args.append("--use-gtin-naming")
                
                gtin = params.options.get("gtin")
                if gtin:
                    blender_args.extend(["--gtin", str(gtin)])
                
                article_number = params.options.get("articleNumber")
                # If no article number provided, extract from filename
                if not article_number and params.objFile:
                    # Extract filename without extension (e.g., "9900004609.obj" -> "9900004609")
                    article_number = Path(params.objFile).stem
                    logger.info(f"Extracted article number from filename: {article_number}")
                
                if article_number:
                    blender_args.extend(["--article-number", str(article_number)])
            
            # Y-up: Bei bakeYUp/rotateYUp Rotation anwenden und einbrennen (echtes Y-up im GLB)
            bake_yup = params.options.get("bakeYUp") or params.options.get("rotateYUp")
            if bake_yup in (True, "true", "True", "1", 1):
                blender_args.append("--rotate-y-up")
            else:
                # Optional export rotation (X or Y, 90/180/270); mutually exclusive with rotateYUp
                rotate_axis = params.options.get("rotateAxis")
                rotate_degrees = params.options.get("rotateDegrees")
                if rotate_axis in ("X", "Y", "Z") and str(rotate_degrees) in ("90", "180", "270"):
                    blender_args.extend(["--rotate-axis", str(rotate_axis), "--rotate-degrees", str(rotate_degrees)])

            logger.info(f"Executing Blender command: {' '.join(blender_args)}")
            
            # Execute Blender conversion (inherit env so FREECAD_PATH/BLENDER_PATH reach step_converter)
            process = await asyncio.create_subprocess_exec(
                *blender_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(Path.cwd()),
                env=os.environ.copy(),
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), 
                    timeout=self.timeout
                )
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise Exception(f"Blender conversion timed out after {self.timeout} seconds")
            
            # Decode output
            stdout_text = stdout.decode('utf-8', errors='replace')
            stderr_text = stderr.decode('utf-8', errors='replace')
            
            # Parse logs from Blender output
            logs = []
            conversion_result = None
            result_json_started = False
            result_json_lines = []
            
            for line in stdout_text.split('\n'):
                line_stripped = line.strip()
                if not line_stripped:
                    continue
                
                # Check for conversion result JSON
                if "=== CONVERSION_RESULT ===" in line:
                    result_json_started = True
                    continue
                
                if result_json_started:
                    # Stop collecting when we hit known Blender shutdown messages
                    if any(marker in line for marker in ["blenderkit: Unregistering", "Blender quit"]):
                        break
                    result_json_lines.append(line)
                else:
                    logs.append({
                        "timestamp": datetime.now().isoformat(),
                        "level": "INFO",
                        "message": line_stripped
                    })
            
            # Parse conversion result if found
            if result_json_lines:
                try:
                    result_json = '\n'.join(result_json_lines).strip()
                    conversion_result = json.loads(result_json)
                    logger.info(f"Job {job_id} conversion result parsed successfully")
                    logger.info(f"Job {job_id} conversion result keys: {list(conversion_result.keys())}")
                except json.JSONDecodeError as e:
                    logger.warning(f"Job {job_id}: Failed to parse conversion result JSON: {e}")
                    logger.warning(f"Job {job_id}: Result JSON string: {result_json[:200]}")

                    # Robust fallback: Blender sometimes prints extra lines after the JSON block,
                    # which breaks json.loads with "Extra data". Parse the first JSON value and
                    # ignore trailing output.
                    try:
                        decoder = json.JSONDecoder()

                        obj_start = result_json.find('{')
                        arr_start = result_json.find('[')
                        starts = [i for i in (obj_start, arr_start) if i != -1]
                        start_idx = min(starts) if starts else -1

                        if start_idx != -1:
                            parsed, end = decoder.raw_decode(result_json[start_idx:])
                            trailing = result_json[start_idx + end:].strip()
                            conversion_result = parsed
                            if trailing:
                                logger.warning(
                                    f"Job {job_id}: Ignoring trailing stdout after JSON ({len(trailing)} chars)")
                            logger.info(f"Job {job_id} conversion result parsed via fallback decoder")
                            logger.info(f"Job {job_id} conversion result keys: {list(conversion_result.keys())}")
                    except Exception as e2:
                        logger.warning(f"Job {job_id}: Fallback JSON parse failed: {e2}")

                # Update output_path if result contains it (important for GTIN naming or OBJ-based naming).
                # STEP pipeline emits 'output_file', OBJ pipeline emits 'output_path' — accept both.
                output_ref = (
                    conversion_result.get("output_path")
                    if conversion_result else None
                ) or (
                    conversion_result.get("output_file")
                    if conversion_result else None
                )
                if conversion_result and conversion_result.get("success") and output_ref:
                    actual_output = Path(output_ref)
                    if not actual_output.is_absolute():
                        actual_output = (self.output_dir / actual_output).resolve()
                    else:
                        actual_output = actual_output.resolve()
                    output_path = actual_output
                    logger.info(f"Job {job_id} updated output_path from Blender result: {output_path}")
            else:
                logger.warning(f"Job {job_id}: No conversion result JSON found in output")
            
            if stderr_text.strip():
                for line in stderr_text.split('\n'):
                    if line.strip():
                        logs.append({
                            "timestamp": datetime.now().isoformat(),
                            "level": "ERROR",
                            "message": line.strip()
                        })
            
            # Check if conversion was successful
            if process.returncode != 0:
                detail = None
                if conversion_result and conversion_result.get("error"):
                    detail = str(conversion_result.get("error"))
                if not detail:
                    for line in stdout_text.split('\n'):
                        stripped = line.strip()
                        if stripped.startswith('ERROR:') or 'ERROR:' in stripped:
                            detail = stripped
                            break
                error_msg = detail or f"Blender conversion failed with exit code {process.returncode}"
                logger.error(f"Job {job_id}: {error_msg}")
                logger.error(f"Job {job_id} stdout: {stdout_text}")
                logger.error(f"Job {job_id} stderr: {stderr_text}")
                raise Exception(error_msg)
            
            # Preflight-only does not create output files.
            if (not preflight_only) and (not output_path.exists()):
                raise Exception("Output file was not created by Blender")
            
            if preflight_only:
                logger.info(f"Job {job_id} completed successfully (preflight-only)")
            else:
                logger.info(f"Job {job_id} completed successfully. Output: {output_path}")
                # Y-up Bake + Draco werden vom API-Gateway erledigt (bakeYUpGlb vor _optimizeGlbArtifact)

            # Prepare result with optional metrics from conversion_result
            result = {
                "outputPath": (None if preflight_only else str(output_path)),
                "fileSize": (None if preflight_only else output_path.stat().st_size),
                "logs": logs,
                "duration": None,  # Could be calculated if needed
                "blenderVersion": None,  # Could be extracted from output
                "preflightOnly": preflight_only
            }
            
            # Add AI metrics and label metrics if available from conversion result
            if conversion_result:
                if conversion_result.get("aiMetrics"):
                    result["aiMetrics"] = conversion_result["aiMetrics"]
                if conversion_result.get("label_metrics"):
                    result["labelMetrics"] = conversion_result["label_metrics"]
                if conversion_result.get("preflight") is not None:
                    result["preflight"] = conversion_result.get("preflight")
                if conversion_result.get("step_color_fallback") is not None:
                    result["stepColorFallback"] = bool(conversion_result.get("step_color_fallback"))
                if conversion_result.get("step_color_details"):
                    result["stepColorDetails"] = conversion_result.get("step_color_details")
                if conversion_result.get("step_color_notes"):
                    result["stepColorNotes"] = conversion_result.get("step_color_notes")
                if conversion_result.get("step_converter_script"):
                    result["stepConverterScript"] = conversion_result.get("step_converter_script")
                if conversion_result.get("step_conversion"):
                    result["stepConversion"] = conversion_result.get("step_conversion")
            
            return result
            
        except Exception as e:
            logger.error(f"Job {job_id} failed: {str(e)}")
            raise e


class BlenderAutomationRunner:
    """Handles execution of Blender automation recipes"""

    def __init__(self):
        automation_cfg = config.get("automation", {})

        blender_config = config["blender"]["executable"]
        if blender_config == "auto":
            self.blender_executable = detect_blender_executable()
        else:
            self.blender_executable = blender_config

        script_path_value = automation_cfg.get("script_path", "../blender-scripts/ki_automation.py")
        self.script_path = Path(script_path_value).resolve()
        self.timeout = automation_cfg.get("timeout", config["blender"].get("timeout", 600))

        base_output = Path(os.environ.get("BLENDER_OUTPUT_DIR", "../outputs")).resolve()
        base_output.mkdir(parents=True, exist_ok=True)
        output_subdir = automation_cfg.get("output_subdir", "renders")
        self.default_output_root = (base_output / output_subdir).resolve()
        self.default_output_root.mkdir(parents=True, exist_ok=True)

        logger.info(f"Automation script path: {self.script_path}")
        logger.info(f"Automation default output root: {self.default_output_root}")

    async def run(self, params: BlenderAutomationParams) -> Dict[str, Any]:
        job_id = params.jobId
        logger.info(f"Starting Blender automation job {job_id}")

        blend_path = Path(params.blendFile).resolve()
        if not blend_path.exists():
            raise FileNotFoundError(f"Blend file not found: {blend_path}")

        recipe_path: Optional[Path] = None
        temp_recipe_path: Optional[Path] = None

        try:
            if params.recipeFile:
                recipe_path = Path(params.recipeFile).resolve()
                if not recipe_path.exists():
                    raise FileNotFoundError(f"Recipe file not found: {recipe_path}")

            if params.recipe:
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    suffix=".json",
                    prefix=f"{job_id}_",
                    delete=False,
                    encoding="utf-8",
                ) as tmp_file:
                    json.dump(params.recipe, tmp_file, indent=2)
                    tmp_file.flush()
                    temp_recipe_path = Path(tmp_file.name)
                recipe_path = temp_recipe_path

            if recipe_path is None:
                raise ValueError("No recipe source resolved for automation job")

            options = params.options or {}
            dry_run = bool(options.get("dryRun", False))
            output_root_override = options.get("outputRoot")

            if output_root_override:
                output_root = Path(output_root_override).resolve()
            else:
                output_root = self.default_output_root
            output_root.mkdir(parents=True, exist_ok=True)

            blender_args = [
                self.blender_executable,
                "--background",
                str(blend_path),
                "--python",
                str(self.script_path),
                "--",
                "--job-id",
                job_id,
                "--recipe-file",
                str(recipe_path),
                "--output-root",
                str(output_root),
            ]

            if dry_run:
                blender_args.append("--dry-run")

            logger.info(f"Executing automation command: {' '.join(blender_args)}")

            env = os.environ.copy()

            process = await asyncio.create_subprocess_exec(
                *blender_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(Path.cwd()),
                env=env,
            )

            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=self.timeout)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()
                raise TimeoutError(f"Automation job timed out after {self.timeout} seconds")

            stdout_text = stdout.decode("utf-8", errors="replace")
            stderr_text = stderr.decode("utf-8", errors="replace")

            result_lines: List[str] = []
            capture_json = False
            for line in stdout_text.split("\n"):
                line_stripped = line.strip()
                if not line_stripped:
                    continue

                if "=== AUTOMATION_RESULT ===" in line:
                    capture_json = True
                    continue

                if capture_json:
                    if any(marker in line for marker in ["blenderkit: Unregistering", "Blender quit"]):
                        break
                    result_lines.append(line)
                else:
                    logger.debug(f"[Automation {job_id}] {line_stripped}")

            automation_result: Optional[Dict[str, Any]] = None
            if result_lines:
                try:
                    result_json = "\n".join(result_lines)
                    automation_result = json.loads(result_json)
                except json.JSONDecodeError as exc:
                    logger.error(f"Job {job_id}: Failed to parse automation result JSON: {exc}")
                    logger.debug(f"Job {job_id} JSON payload: {result_json}")

            if stderr_text.strip():
                logger.error(f"Automation stderr for job {job_id}: {stderr_text.strip()}")

            if process.returncode != 0:
                raise RuntimeError(f"Automation script exited with code {process.returncode}")

            if not automation_result:
                raise RuntimeError("Automation result JSON not found in Blender output")

            if not automation_result.get("success", False):
                error_msg = automation_result.get("error", "Automation reported failure")
                raise RuntimeError(error_msg)

            logger.info(f"Automation job {job_id} completed successfully")
            return automation_result

        finally:
            if temp_recipe_path and temp_recipe_path.exists():
                try:
                    temp_recipe_path.unlink()
                except Exception as exc:  # noqa: BLE001
                    logger.warning(f"Failed to delete temp recipe file {temp_recipe_path}: {exc}")

# Global converter instance
converter = BlenderConverter()
automation_runner = BlenderAutomationRunner()


@app.get("/health")
async def health_check():
    """Detailed health check for Blender and FreeCAD availability."""

    # Check Blender availability
    try:
        blender_exe = config["blender"]["executable"]
        if blender_exe == "auto":
            blender_exe = detect_blender_executable()

        process = await asyncio.create_subprocess_exec(
            blender_exe,
            "--version",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        blender_available = process.returncode == 0
        blender_version = stdout.decode("utf-8", errors="replace").split("\n")[0] if blender_available else None
        blender_path = blender_exe
    except Exception as exc:  # noqa: BLE001
        blender_available = False
        blender_version = None
        blender_path = f"Error: {exc}"

    # Check FreeCAD/STEP support availability
    freecad_available = False
    freecad_version = None
    freecad_path = None
    freecad_method = None
    
    try:
        # Try to import the step_converter and check FreeCAD availability
        import sys
        sys.path.insert(0, str(Path(__file__).parent.parent / "blender-scripts"))
        from step_converter import FREECAD_AVAILABLE
        
        freecad_available = FREECAD_AVAILABLE
        if freecad_available:
            # Try to get FreeCAD version info
            try:
                import FreeCAD
                freecad_version = str(FreeCAD.Version())
                freecad_method = "python_module"
            except ImportError:
                # Check for system FreeCAD
                freecad_paths = [
                    "/Applications/FreeCAD.app/Contents/bin/FreeCADCmd",
                    "/usr/local/bin/FreeCADCmd",
                    "/opt/homebrew/bin/FreeCADCmd"
                ]
                for path in freecad_paths:
                    if os.path.exists(path):
                        freecad_path = path
                        freecad_method = "system_binary"
                        try:
                            proc = await asyncio.create_subprocess_exec(
                                path, "--version",
                                stdout=asyncio.subprocess.PIPE,
                                stderr=asyncio.subprocess.PIPE
                            )
                            stdout, _ = await proc.communicate()
                            if proc.returncode == 0:
                                freecad_version = stdout.decode("utf-8", errors="replace").strip().split('\n')[0]
                            break
                        except:
                            continue
    except Exception as exc:
        freecad_available = False
        freecad_path = f"Error: {exc}"

    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "blender": {
            "available": blender_available,
            "version": blender_version,
            "executable": blender_path,
            "detected": config["blender"]["executable"] == "auto",
        },
        "freecad": {
            "available": freecad_available,
            "version": freecad_version,
            "path": freecad_path,
            "method": freecad_method,
            "step_support": freecad_available
        },
        "capabilities": {
            "obj_to_glb": blender_available,
            "step_to_glb": blender_available and freecad_available,
            "supported_formats": ["obj", "mtl"] + (["step", "stp"] if freecad_available else [])
        },
        "script_path": str(converter.script_path),
        "output_directory": str(converter.output_dir),
    }


@app.get("/gtin/filename")
async def get_gtin_filename(gtin: Optional[str] = None, articleNumber: Optional[str] = None):
    """Resolve filenames using GTIN/article mapping, supporting optional article-only lookups."""

    if not gtin and not articleNumber:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one of 'gtin' or 'articleNumber' query parameters",
        )

    try:
        from services.gtin_naming import get_gtin_service

        gtin_enabled = os.getenv("GTIN_ENABLED", "false").lower() == "true"
        if not gtin_enabled:
            return {
                "success": False,
                "error": "GTIN naming service disabled",
                "filename": None,
                "usingFallback": True,
            }

        gtin_service = get_gtin_service()
        result = gtin_service.get_filename(
            gtin=gtin,
            article_number=articleNumber,
            fallback_name="output",
        )

        response = {
            "success": result.get("success", False),
            "filename": result.get("filename"),
            "usingFallback": result.get("using_fallback", False),
            "matchSource": result.get("match_source"),
            "entry": result.get("entry"),
            "requested": {
                "gtin": gtin,
                "articleNumber": articleNumber,
            },
        }

        if not result.get("success"):
            response["error"] = result.get("error", "Unknown GTIN lookup error")

        return response
    except Exception as exc:  # noqa: BLE001
        logger.error(f"GTIN filename lookup failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/automation/run")
async def run_automation_endpoint(params: BlenderAutomationParams):
    """Run Blender automation recipe jobs without MCP wrapper"""
    try:
        result = await automation_runner.run(params)
        return result
    except Exception as exc:
        logger.error(f"Automation endpoint failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

@app.post("/convert/step")
async def convert_step_to_glb(params: BlenderConvertParams):
    """
    Convert STEP files to GLB format
    Specialized endpoint for STEP file conversions with tessellation control
    """
    try:
        # Validate STEP file is provided
        if not params.stepFile:
            raise HTTPException(status_code=400, detail="stepFile parameter required for STEP conversion")
        
        # Validate STEP file exists and is accessible
        step_path = Path(params.stepFile)
        if not step_path.exists():
            logger.error(f"STEP file not found: {params.stepFile}")
            raise HTTPException(status_code=404, detail=f"STEP file not found: {params.stepFile}")
        
        # Log STEP file information
        file_size = step_path.stat().st_size
        logger.info(f"STEP file: {step_path.name} ({file_size:,} bytes)")
        
        # Validate file is not empty
        if file_size == 0:
            logger.error("STEP file is empty (0 bytes)")
            raise HTTPException(status_code=400, detail="STEP file is empty")
        
        # Validate STEP file format
        try:
            with open(step_path, 'r', encoding='utf-8', errors='ignore') as f:
                header = f.read(500)
                if 'ISO-10303-21' not in header:
                    logger.warning(f"File does not contain ISO-10303-21 header: {step_path.name}")
                    raise HTTPException(
                        status_code=400, 
                        detail="File does not appear to be a valid STEP format (missing ISO-10303-21 header)"
                    )
                
                # Detect and log STEP format
                step_format = "ISO-10303-21"
                if 'AP203' in header:
                    step_format = "AP203 (Configuration Controlled 3D Design)"
                elif 'AP214' in header:
                    step_format = "AP214 (Automotive Design)"
                elif 'AP242' in header:
                    step_format = "AP242 (Managed Model-Based 3D Engineering)"
                elif 'AUTOMOTIVE_DESIGN' in header:
                    step_format = "AUTOMOTIVE_DESIGN schema"
                
                logger.info(f"STEP format detected: {step_format}")
        except Exception as e:
            logger.error(f"Error reading STEP file: {e}")
            raise HTTPException(status_code=400, detail=f"Error reading STEP file: {e}")
        
        # Check FreeCAD availability
        try:
            import sys
            sys.path.insert(0, str(Path(__file__).parent.parent / "blender-scripts"))
            from step_converter import FREECAD_AVAILABLE, detect_freecad_installation
            
            if not FREECAD_AVAILABLE:
                freecad_info = detect_freecad_installation()
                error_detail = {
                    "error": "STEP conversion unavailable - FreeCAD not installed",
                    "freecad_info": freecad_info,
                    "installation_methods": [
                        "macOS: Download from https://www.freecad.org/downloads.php",
                        "Homebrew: brew install --cask freecad",
                        "Install to /Applications/FreeCAD.app"
                    ]
                }
                logger.error(f"FreeCAD not available: {freecad_info.get('error', 'Unknown')}")
                raise HTTPException(status_code=503, detail=error_detail)
        except ImportError as e:
            logger.error(f"STEP converter module import failed: {e}")
            raise HTTPException(
                status_code=503, 
                detail=f"STEP converter module not available: {e}"
            )
        
        # Validate tessellation quality
        tessellation = params.options.get("tessellationQuality", 0.1)
        if not 0.001 <= tessellation <= 10.0:
            logger.warning(f"Unusual tessellation quality: {tessellation}")
        
        logger.info(f"Starting STEP conversion: {params.stepFile} -> GLB (tessellation: {tessellation})")
        logger.info(f"Conversion pipeline: STEP → FreeCAD → OBJ → Blender → GLB")
        
        result = await converter.convert_to_glb(params)
        
        # Add STEP-specific metadata to result
        result.update({
            "input_format": "STEP",
            "step_file_size": file_size,
            "step_format": step_format,
            "tessellation_quality": tessellation,
            "pipeline": "STEP → FreeCAD → OBJ → Blender → GLB"
        })
        
        logger.info(f"STEP conversion completed successfully: {result.get('glbFile', 'unknown')}")
        return result
        
    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as exc:
        logger.error(f"STEP conversion failed: {exc}")
        logger.exception("Full traceback:")
        
        # Check if it's a FreeCAD-specific error
        error_detail = str(exc)
        if "null shape" in error_detail.lower():
            error_detail = {
                "error": "FreeCAD could not extract geometry from STEP file",
                "details": str(exc),
                "possible_causes": [
                    "STEP file contains invalid or corrupted geometry",
                    "STEP format version not supported by FreeCAD",
                    "File contains only metadata without 3D geometry",
                    "FreeCAD installation missing STEP import libraries"
                ],
                "suggestions": [
                    "Verify STEP file opens correctly in CAD software",
                    "Try exporting STEP file with different settings",
                    "Check FreeCAD logs in logs/freecad_step_debug.log"
                ]
            }
        
        raise HTTPException(status_code=500, detail=error_detail) from exc

@app.get("/convert/step/health")
async def step_conversion_health():
    """
    Health check specifically for STEP conversion capabilities
    """
    try:
        # Check FreeCAD availability
        freecad_available = False
        freecad_info = {"available": False, "error": None, "version": None, "path": None}
        
        try:
            import sys
            import subprocess
            sys.path.insert(0, str(Path(__file__).parent.parent / "blender-scripts"))
            from step_converter import FREECAD_AVAILABLE, FREECAD_BINARY_PATH, detect_freecad_installation
            
            freecad_available = FREECAD_AVAILABLE
            
            if freecad_available:
                detailed_info = detect_freecad_installation()
                freecad_info.update({
                    "available": True,
                    "path": FREECAD_BINARY_PATH,
                    "version": detailed_info.get('version', 'Unknown'),
                    "method": detailed_info.get('method', 'Unknown'),
                    "functional": detailed_info.get('functional', False)
                })
                
                # Try to get detailed FreeCAD version for macOS
                if "FreeCAD.app" in str(FREECAD_BINARY_PATH):
                    try:
                        test_cmd = [FREECAD_BINARY_PATH, "-c", 
                                   "import sys; sys.path.insert(0, '/Applications/FreeCAD.app/Contents/Resources/lib'); import FreeCAD; print('.'.join(FreeCAD.Version()[:3]))"]
                        result = subprocess.run(test_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=5)
                        if result.returncode == 0 and result.stdout:
                            freecad_info["version"] = result.stdout.strip()
                    except Exception as e:
                        logger.debug(f"Could not get FreeCAD version: {e}")
            else:
                detailed_info = detect_freecad_installation()
                freecad_info.update({
                    "available": False,
                    "error": detailed_info.get('error', 'FreeCAD not detected'),
                    "installation_methods": [
                        "macOS: Download from https://www.freecad.org/downloads.php",
                        "Homebrew: brew install --cask freecad",
                        "Install to /Applications/FreeCAD.app",
                        "Ensure Python binary is at /Applications/FreeCAD.app/Contents/Resources/bin/python"
                    ]
                })
            
            if freecad_available:
                try:
                    import FreeCAD
                    freecad_info.update({
                        "available": True,
                        "version": str(FreeCAD.Version()),
                        "method": "python_module"
                    })
                except ImportError:
                    freecad_info.update({
                        "available": True,
                        "method": "system_binary",
                        "note": "FreeCAD detected via system installation"
                    })
            else:
                freecad_info.update({
                    "available": False,
                    "error": "FreeCAD not detected",
                    "installation_methods": [
                        "Homebrew: brew install freecad",
                        "Direct download: https://www.freecad.org/downloads.php",
                        "macOS: Install FreeCAD.app to /Applications"
                    ]
                })
                
        except Exception as e:
            freecad_info.update({
                "available": False,
                "error": str(e)
            })
        
        return {
            "step_conversion_available": freecad_available,
            "freecad": freecad_info,
            "supported_formats": [".step", ".stp"],
            "tessellation_quality_range": {"min": 0.01, "max": 1.0, "default": 0.1},
            "pipeline": "STEP → FreeCAD tessellation → OBJ → Blender → GLB",
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as exc:
        logger.error(f"STEP health check failed: {exc}")
        return {
            "step_conversion_available": False,
            "error": str(exc),
            "timestamp": datetime.now().isoformat()
        }

@app.post("/mcp/call", response_model=MCPResponse)
async def call_mcp_tool(request: MCPRequest):
    """
    MCP tool call endpoint
    """
    logger.info(f"Received MCP call: {request.method}")
    
    try:
        if request.method == "blender-convert":
            convert_params = BlenderConvertParams(**request.params)
            result = await converter.convert_to_glb(convert_params)
            return MCPResponse(success=True, result=result)
        elif request.method == "blender-automation":
            automation_params = BlenderAutomationParams(**request.params)
            result = await automation_runner.run(automation_params)
            return MCPResponse(success=True, result=result)
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unknown method: {request.method}"
            )
    
    except Exception as e:
        logger.error(f"MCP tool call failed: {str(e)}")
        return MCPResponse(success=False, error=str(e))

@app.get("/tools")
async def list_tools():
    """List available MCP tools"""
    return {
        "tools": [
            {
                "name": tool_name,
                "description": tool_config["description"],
                "parameters": tool_config["parameters"]
            }
            for tool_name, tool_config in config["tools"].items()
        ]
    }

@app.get("/tools/{tool_name}")
async def get_tool_info(tool_name: str):
    """Get detailed information about a specific tool"""
    if tool_name not in config["tools"]:
        raise HTTPException(status_code=404, detail=f"Tool '{tool_name}' not found")
    
    tool_config = config["tools"][tool_name]
    return {
        "name": tool_name,
        "description": tool_config["description"],
        "parameters": tool_config["parameters"]
    }


# === CLAUDE AI ENDPOINTS ===

class MeshFeatures(BaseModel):
    """Mesh features for AI classification"""
    object_name: str
    bbox: Dict[str, Any]
    volume: float
    aspect_ratios: Dict[str, float]
    position: Dict[str, float]
    color_signature: List[float]
    materials: List[str]
    vertex_count: int
    face_count: int
    scene_height: float
    post_count: int


class AIClassifyRequest(BaseModel):
    """Request for AI mesh classification"""
    mesh_features: MeshFeatures
    preview_image: Optional[str] = None  # base64 encoded


class AIClassifyBatchRequest(BaseModel):
    """Batch request for AI mesh classification"""
    mesh_features_list: List[MeshFeatures]
    max_per_request: int = 5


@app.post("/ai/classify-mesh")
async def classify_mesh_with_ai(request: AIClassifyRequest):
    """
    Klassifiziert ein einzelnes Mesh mittels Claude AI
    
    Returns:
        {
            "classification": str,
            "confidence": float,
            "reasoning": str,
            "suggested_name": str,
            "alternative_labels": List
        }
    """
    
    # Check if Claude is enabled
    if not os.getenv("CLAUDE_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="Claude AI not configured (CLAUDE_API_KEY missing)"
        )
    
    try:
        claude = get_claude_analyzer()
        
        # Convert base64 preview to bytes
        preview_bytes = None
        if request.preview_image:
            import base64
            try:
                preview_bytes = base64.b64decode(request.preview_image)
            except Exception as e:
                logger.warning(f"Failed to decode preview image: {e}")
        
        # Classify
        result = await claude.analyze_mesh_structure(
            mesh_features=request.mesh_features.dict(),
            preview_image=preview_bytes
        )
        
        return {
            "status": "success",
            "classification": result
        }
        
    except Exception as e:
        logger.error(f"AI classification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/ai/classify-batch")
async def classify_mesh_batch_with_ai(request: AIClassifyBatchRequest):
    """
    Klassifiziert mehrere Meshes in einem Batch (Kostenoptimierung)
    
    Returns:
        {
            "status": "success",
            "classifications": List[ClassificationResult],
            "total_cost_estimate": float
        }
    """
    
    if not os.getenv("CLAUDE_API_KEY"):
        raise HTTPException(
            status_code=503,
            detail="Claude AI not configured"
        )
    
    try:
        claude = get_claude_analyzer()
        
        # Convert to dicts
        features_list = [f.dict() for f in request.mesh_features_list]
        
        # Batch classify
        results = await claude.analyze_batch(
            mesh_features_list=features_list,
            max_per_request=request.max_per_request
        )
        
        # Estimate costs (rough)
        # ~500 tokens/mesh input + 200 tokens output
        total_tokens = len(features_list) * 700
        cost_estimate = (total_tokens / 1_000_000) * 10  # ~$10/1M tokens avg
        
        return {
            "status": "success",
            "classifications": results,
            "total_meshes": len(results),
            "cost_estimate_usd": round(cost_estimate, 4)
        }
        
    except Exception as e:
        logger.error(f"Batch AI classification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/ai/health")
async def ai_health_check():
    """
    Prüft ob Claude AI verfügbar ist
    """
    
    api_key = os.getenv("CLAUDE_API_KEY")
    
    if not api_key:
        return {
            "status": "disabled",
            "reason": "CLAUDE_API_KEY not set"
        }
    
    try:
        claude = get_claude_analyzer()
        return {
            "status": "ready",
            "model": claude.model,
            "vision_enabled": claude.use_vision
        }
    except Exception as e:
        return {
            "status": "error",
            "reason": str(e)
        }


# === GTIN NAMING ENDPOINTS ===

@app.get("/gtin/filename")
async def get_gtin_filename(gtin: str):
    """
    Generiert Dateinamen basierend auf GTIN-Lookup
    
    Query Parameter:
        gtin: GTIN code (z.B. 4260123456789)
    
    Returns:
        { "success": true, "filename": "4260123456789_Fachwerk_Pfosten.glb", "product_name": "..." }
    """
    try:
        from services.gtin_naming import get_gtin_service
        
        gtin_enabled = os.getenv("GTIN_ENABLED", "false").lower() == "true"
        
        if not gtin_enabled:
            return {
                "success": False,
                "error": "GTIN naming service disabled"
            }
        
        gtin_service = get_gtin_service()
        filename = gtin_service.get_filename(gtin=gtin, fallback_name="output")
        
        # Lookup product info
        product_info = gtin_service.search_gtin(gtin)
        product_name = product_info[0]["product_name"] if product_info else None
        
        return {
            "success": True,
            "filename": filename,
            "product_name": product_name,
            "gtin": gtin
        }
        
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"GTIN filename generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/gtin/search")
async def search_gtin(q: str):
    """
    Sucht nach GTIN-Einträgen (Fuzzy-Search)
    
    Query Parameter:
        q: Suchbegriff (GTIN oder Produktname)
    
    Returns:
        { "matches": [ { "gtin": "...", "product_name": "..." }, ... ] }
    """
    try:
        from services.gtin_naming import get_gtin_service
        
        gtin_service = get_gtin_service()
        matches = gtin_service.search_gtin(q)[:10]  # Limit to 10 results
        
        return {
            "matches": matches
        }
        
    except Exception as e:
        logger.error(f"GTIN search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/gtin/upload")
async def upload_gtin_database(file: UploadFile = File(...)):
    """
    Upload GTIN database (CSV or XLSX)
    
    File:
        CSV/XLSX file with columns: GTIN, Artikelnummer, Product Name, Category, RAL
    
    Returns:
        {
            "success": true,
            "rowCount": 123,
            "filename": "gtin_products.xlsx",
            "message": "Database uploaded successfully"
        }
    """
    try:
        from services.gtin_naming import get_gtin_service
        
        # Validate file type
        if not file.filename.endswith(('.csv', '.xlsx')):
            raise HTTPException(
                status_code=400,
                detail="Only CSV and XLSX files are allowed"
            )
        
        # Read file content
        content = await file.read()
        
        # Get GTIN service
        gtin_service = get_gtin_service()
        
        # IMPORTANT: Always save uploads to uploaded_gtin.xlsx (not the production database)
        # This prevents overwriting the read-only production database
        upload_path = Path("data/uploaded_gtin.xlsx")
        
        # Create directory if it doesn't exist
        upload_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save file
        with open(upload_path, 'wb') as f:
            f.write(content)
        
        logger.info(f"GTIN database uploaded: {file.filename} -> {upload_path}")
        
        # Update environment to use uploaded database
        os.environ['GTIN_DATABASE_PATH'] = str(upload_path)
        
        # Reload database
        gtin_service.reload_database()
        
        # Get row count
        row_count = len(gtin_service.gtin_database)
        
        return {
            "success": True,
            "rowCount": row_count,
            "filename": file.filename,
            "message": f"Database uploaded successfully with {row_count} entries"
        }
        
    except Exception as e:
        logger.error(f"GTIN database upload failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


class AppleSetupRequest(BaseModel):
    """Request model for Apple-style setup creation"""
    output_path: Optional[str] = Field(default=None, description="Output path for .blend file (defaults to ~/Desktop/apple_style_setup.blend)")
    samples: Optional[int] = Field(default=512, description="Render samples (default: 512)")
    hdri_path: Optional[str] = Field(default=None, description="Optional HDRI file path")


@app.post("/apple-setup")
async def create_apple_setup(request: AppleSetupRequest):
    """
    Erstellt eine neue Blender-Szene mit Apple-Style Lighting, Materials und Camera
    
    Body:
        {
            "output_path": "/path/to/output.blend" (optional),
            "samples": 512 (optional),
            "hdri_path": "/path/to/hdri.exr" (optional)
        }
    
    Returns:
        {
            "success": true,
            "message": "...",
            "output_path": "...",
            "stats": { ... }
        }
    """
    try:
        blender_executable = detect_blender_executable()
        script_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "blender-scripts", "create_apple_setup.py"))
        
        logger.info(f"Looking for script at: {script_path}")
        
        if not os.path.exists(script_path):
            raise FileNotFoundError(f"Apple setup script not found: {script_path}")
        
        # Build command
        cmd = [
            blender_executable,
            "--background",
            "--python", script_path,
            "--"
        ]
        
        # Add optional arguments
        if request.output_path:
            cmd.extend(["--output", request.output_path])
        
        if request.samples:
            cmd.extend(["--samples", str(request.samples)])
        
        if request.hdri_path and os.path.exists(request.hdri_path):
            cmd.extend(["--hdri", request.hdri_path])
        
        logger.info(f"Creating Apple-style setup with command: {' '.join(cmd)}")
        
        # Execute Blender
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120  # 2 minutes timeout
        )
        
        # Parse JSON output from script
        # The JSON output is multi-line, so we need to find and extract it
        output_text = result.stdout.strip()
        json_output = None
        
        # Find JSON by looking for matching braces
        start_idx = output_text.find('\n{')
        if start_idx == -1:
            start_idx = output_text.find('{')
        
        if start_idx != -1:
            # Count braces to find the matching closing brace
            brace_count = 0
            json_start = start_idx if output_text[start_idx] == '{' else start_idx + 1
            
            for i in range(json_start, len(output_text)):
                if output_text[i] == '{':
                    brace_count += 1
                elif output_text[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        json_str = output_text[json_start:i+1]
                        try:
                            json_output = json.loads(json_str)
                            if json_output.get("success") is not None:
                                break
                        except json.JSONDecodeError:
                            pass
        
        if json_output and json_output.get("success"):
            logger.info(f"Apple setup created successfully: {json_output.get('output_path')}")
            return json_output
        else:
            error_msg = json_output.get("error") if json_output else "Unknown error"
            logger.error(f"Apple setup creation failed: {error_msg}")
            logger.error(f"stdout: {result.stdout}")
            logger.error(f"stderr: {result.stderr}")
            raise HTTPException(status_code=500, detail=error_msg)
        
    except subprocess.TimeoutExpired:
        logger.error("Apple setup creation timed out")
        raise HTTPException(status_code=504, detail="Setup creation timed out after 2 minutes")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Apple setup creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    
    # Ensure logs directory exists
    Path("logs").mkdir(exist_ok=True)
    
    logger.info(f"Starting MCP server: {config['name']} v{config['version']}")
    
    uvicorn.run(
        app,
        host=config["server"]["host"],
        port=config["server"]["port"],
        log_level=config["logging"]["level"].lower()
    )
