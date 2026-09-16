#!/usr/bin/env python3
"""
STEP to OBJ Converter using FreeCAD
Converts STEP/STP files to OBJ format for further processing in Blender
"""

import os
import sys
import tempfile
import argparse
import subprocess
from pathlib import Path
from typing import Optional, Dict, Any
import datetime
import json


def _collect_freecad_candidate_binaries():
    """Build ordered list of FreeCAD executables (python/freecadcmd) to probe."""
    candidates = []
    seen = set()

    def add(path):
        if not path:
            return
        p = os.path.normpath(str(path))
        if os.path.exists(p) and p not in seen:
            seen.add(p)
            candidates.append(p)

    def add_from_base(base_dir):
        base = Path(base_dir)
        if not base.is_dir():
            return
        add(base / 'python.exe')
        add(base / 'python')
        add(base / 'freecad.exe')
        add(base / 'freecad')
        add(base / 'FreeCADCmd.exe')
        add(base / 'FreeCADCmd')

    for env_name in ('FREECAD_PYTHON', 'FREECAD_PATH', 'FREECAD_EXECUTABLE'):
        raw = os.environ.get(env_name, '').strip()
        if not raw or raw.lower() == 'auto':
            continue
        p = Path(raw)
        if p.is_dir():
            add_from_base(p)
        else:
            add(p)
            add_from_base(p.parent)

    if sys.platform == 'win32':
        for root in (
            os.environ.get('ProgramFiles', r'C:\Program Files'),
            os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'),
        ):
            for name in ('FreeCAD 1.1', 'FreeCAD 1.0', 'FreeCAD 0.21', 'FreeCAD 0.20'):
                add_from_base(Path(root) / name / 'bin')

    for path in (
        "/Applications/FreeCAD.app/Contents/Resources/bin/python",
        "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd",
        "/Applications/FreeCAD.app/Contents/Resources/bin/freecad",
        "/Applications/FreeCAD.app/Contents/bin/FreeCADCmd",
        "/usr/local/bin/FreeCADCmd",
        "/usr/bin/freecad",
        "/usr/bin/FreeCADCmd",
        "/opt/homebrew/bin/FreeCADCmd",
    ):
        add(path)

    return candidates


def _probe_freecad_binary(path):
    """Return True if path is a usable FreeCAD CLI (python with FreeCAD module or freecadcmd)."""
    name = os.path.basename(path).lower()
    try:
        if name.startswith('python'):
            test_cmd = [path, '-c', 'import FreeCAD; print("OK")']
            result = subprocess.run(test_cmd, capture_output=True, text=True, timeout=15)
            return result.returncode == 0 and 'OK' in (result.stdout or '')
        result = subprocess.run([path, '--version'], capture_output=True, text=True, timeout=10)
        return result.returncode == 0
    except Exception:
        return False


try:
    import FreeCAD
    import Import
    import Mesh
    import Part
    FREECAD_AVAILABLE = True
    print("FreeCAD Python module loaded successfully")
except ImportError:
    FREECAD_AVAILABLE = False
    FREECAD_BINARY_PATH = None

    for path in _collect_freecad_candidate_binaries():
        if _probe_freecad_binary(path):
            FREECAD_AVAILABLE = True
            FREECAD_BINARY_PATH = path
            print(f"System FreeCAD found at: {path}")
            break

    if not FREECAD_AVAILABLE:
        print("WARNING: FreeCAD not available. Install options:")
        print("  Windows: set FREECAD_PATH=C:\\Program Files\\FreeCAD 1.1\\bin\\freecad.exe")
        print("  1. Homebrew: brew install freecad")
        print("  2. Download: https://www.freecad.org/downloads.php")
        print("  3. macOS: Download FreeCAD.app and place in Applications")


class StepToObjConverter:
    """
    Converts STEP/STP files to OBJ format using FreeCAD
    """
    
    def __init__(self, tessellation_quality: float = 0.1):
        """
        Initialize the converter
        
        Args:
            tessellation_quality (float): Mesh tessellation quality (0.01-1.0, lower = finer)
        """
        if not FREECAD_AVAILABLE:
            raise ImportError("FreeCAD is not available. Install with: brew install freecad")
        
        self.tessellation_quality = max(0.01, min(1.0, tessellation_quality))
        self.log_messages = []
        self.freecad_binary = FREECAD_BINARY_PATH
    
    def log(self, message: str, level: str = "INFO"):
        """Log messages with timestamp"""
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {level}: {message}"
        self.log_messages.append(log_entry)
        print(log_entry)
    
    def convert_step_to_obj(self, step_file: str, obj_file: str, 
                          mtl_file: Optional[str] = None) -> Dict[str, Any]:
        """
        Convert STEP file to OBJ format using external FreeCAD command
        
        Args:
            step_file (str): Path to input STEP/STP file
            obj_file (str): Path to output OBJ file
            mtl_file (str, optional): Path to output MTL file (not used for STEP)
            
        Returns:
            dict: Conversion result with statistics
        """
        step_path = Path(step_file)
        obj_path = Path(obj_file)
        
        if not step_path.exists():
            raise FileNotFoundError(f"STEP file not found: {step_file}")
        
        # Validate STEP file before conversion
        self.log("Validating STEP file...")
        file_size = step_path.stat().st_size
        self.log(f"File size: {file_size:,} bytes ({file_size/1024:.2f} KB)")
        
        if file_size == 0:
            raise ValueError("STEP file is empty (0 bytes)")
        
        # Check STEP file format
        try:
            with open(step_path, 'r', encoding='utf-8', errors='ignore') as f:
                header = f.read(500)
                if 'ISO-10303-21' not in header:
                    self.log("WARNING: File does not contain ISO-10303-21 header", "WARN")
                else:
                    self.log("Valid STEP format detected")
                    
                    # Detect STEP application protocol
                    if 'AP203' in header:
                        self.log("STEP format: AP203 (Configuration Controlled 3D Design)")
                    elif 'AP214' in header:
                        self.log("STEP format: AP214 (Automotive Design)")
                    elif 'AP242' in header:
                        self.log("STEP format: AP242 (Managed Model-Based 3D Engineering)")
        except Exception as e:
            self.log(f"Could not read STEP header: {e}", "WARN")
        
        # Validate tessellation quality
        if not 0.001 <= self.tessellation_quality <= 10.0:
            self.log(f"WARNING: Unusual tessellation quality {self.tessellation_quality}", "WARN")
            self.log("Recommended range: 0.01 (fine) to 1.0 (coarse)", "WARN")
        
        # Ensure output directory exists
        obj_path.parent.mkdir(parents=True, exist_ok=True)
        
        self.log(f"Converting STEP file: {step_path.name}")
        self.log(f"Tessellation quality: {self.tessellation_quality}")
        
        # Validate FreeCAD installation
        self.log(f"FreeCAD binary: {self.freecad_binary}")
        if self.freecad_binary.endswith("python") and "FreeCAD.app" in self.freecad_binary:
            try:
                # Get FreeCAD version for macOS installation
                test_cmd = [self.freecad_binary, "-c", 
                           "import sys; sys.path.insert(0, '/Applications/FreeCAD.app/Contents/Resources/lib'); import FreeCAD; print('Version:', '.'.join(FreeCAD.Version()[:3]))"]
                result = subprocess.run(test_cmd, capture_output=True, text=True, timeout=5)
                if result.returncode == 0 and result.stdout:
                    self.log(f"FreeCAD {result.stdout.strip()}")
                else:
                    self.log("Could not determine FreeCAD version", "WARN")
            except Exception as e:
                self.log(f"FreeCAD version check failed: {e}", "WARN")
        
        # Create temporary Python script for FreeCAD
        freecad_script_content = f'''
import sys
import os

print("Converting: {step_path} -> {obj_path}")
print("Tessellation quality: {self.tessellation_quality}")

try:
    import FreeCAD
    import Import
    import Mesh
    import Part

    # Create new document
    doc = FreeCAD.newDocument("StepConversion")
    
    # Import STEP file
    print("Importing STEP file...")
    Import.insert("{step_path}", "StepConversion")
    
    # Get imported objects
    objects = doc.Objects
    print("Found {{}} objects".format(len(objects)))
    
    if not objects:
        print("ERROR: No objects found in STEP file")
        sys.exit(1)
    
    # Create combined mesh
    combined_vertices = []
    combined_faces = []
    vertex_offset = 0
    
    for i, obj in enumerate(objects):
        if hasattr(obj, 'Shape') and obj.Shape:
            print("Processing object {{}}: {{}}".format(i+1, obj.Label))
            shape = obj.Shape
            
            # Tessellate the shape
            try:
                mesh_data = shape.tessellate({self.tessellation_quality})
                if mesh_data and len(mesh_data) >= 2:
                    vertices, faces = mesh_data[0], mesh_data[1]
                    
                    # Add vertices
                    combined_vertices.extend(vertices)
                    
                    # Add faces with vertex offset
                    for face in faces:
                        adjusted_face = tuple(idx + vertex_offset for idx in face)
                        combined_faces.append(adjusted_face)
                    
                    vertex_offset += len(vertices)
                    print("  Added {{}} vertices, {{}} faces".format(len(vertices), len(faces)))
                    
            except Exception as e:
                print("WARNING: Could not tessellate {{}}: {{}}".format(obj.Label, e))
    
    if not combined_vertices:
        print("ERROR: No mesh data could be extracted")
        sys.exit(1)
    
    # Write OBJ file manually
    print("Writing OBJ file with {{}} vertices, {{}} faces...".format(len(combined_vertices), len(combined_faces)))
    
    os.makedirs(os.path.dirname("{obj_path}"), exist_ok=True)
    
    with open("{obj_path}", 'w') as f:
        # Write header
        f.write("# OBJ file generated from {step_path.name}\\n")
        f.write("# FreeCAD STEP converter\\n")
        f.write("# Vertices: {{}}\\n".format(len(combined_vertices)))
        f.write("# Faces: {{}}\\n\\n".format(len(combined_faces)))
        
        # Write vertices
        for vertex in combined_vertices:
            f.write("v {{}} {{}} {{}}\\n".format(vertex.x, vertex.y, vertex.z))
        
        # Write faces (OBJ uses 1-based indexing)
        for face in combined_faces:
            if len(face) == 3:  # Triangle
                f.write("f {{}} {{}} {{}}\\n".format(face[0]+1, face[1]+1, face[2]+1))
            elif len(face) == 4:  # Quad
                f.write("f {{}} {{}} {{}} {{}}\\n".format(face[0]+1, face[1]+1, face[2]+1, face[3]+1))
    
    print("SUCCESS: STEP to OBJ conversion completed")
    
    # Close document
    FreeCAD.closeDocument("StepConversion")
    
    # Force exit
    import sys
    sys.exit(0)

except ImportError as e:
    print("ERROR: FreeCAD modules not available: {{}}".format(e))
    sys.exit(1)
except Exception as e:
    print("ERROR: Conversion failed: {{}}".format(e))
    sys.exit(1)
'''
        
        # Execute platform-aware FreeCAD scripts with fallback support
        script_dir = Path(__file__).parent
        color_script = script_dir / "freecad_macos.py"
        generic_script = script_dir / "freecad_script.py"

        script_attempts = []
        if color_script.exists():
            script_attempts.append(("color", color_script))
        if generic_script.exists():
            script_attempts.append(("generic", generic_script))

        if not script_attempts:
            raise FileNotFoundError("No FreeCAD STEP converter scripts available")

        status_info: Dict[str, Any] = {}
        script_used = None
        fallback_reason = None
        last_exception: Optional[Exception] = None

        for script_label, freecad_script in script_attempts:
            env = os.environ.copy()
            env['STEP_INPUT_FILE'] = str(step_path.absolute())
            env['STEP_OUTPUT_FILE'] = str(obj_path.absolute())
            env['STEP_TESSELLATION'] = str(self.tessellation_quality)

            if "FreeCAD.app" in self.freecad_binary:
                freecad_resources = "/Applications/FreeCAD.app/Contents/Resources"
                env['PYTHONPATH'] = f"{freecad_resources}/lib:{env.get('PYTHONPATH', '')}"
                env['DYLD_LIBRARY_PATH'] = f"{freecad_resources}/lib:{env.get('DYLD_LIBRARY_PATH', '')}"
            elif sys.platform == 'win32' and self.freecad_binary:
                bin_dir = str(Path(self.freecad_binary).parent)
                env['PATH'] = f"{bin_dir};{env.get('PATH', '')}"

            status_fd, status_temp = tempfile.mkstemp(prefix="step_status_", suffix=".json")
            os.close(status_fd)
            status_path_obj = Path(status_temp)
            env['STEP_STATUS_PATH'] = str(status_path_obj)

            cmd = [self.freecad_binary, str(freecad_script)]
            self.log(f"Executing ({script_label}): {' '.join(cmd)}")
            self.log(f"Input: {step_path}")
            self.log(f"Output: {obj_path}")

            try:
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    env=env,
                    cwd=script_dir
                )

                if result.stdout:
                    for line in result.stdout.strip().split('\n'):
                        if line.strip():
                            self.log(f"FreeCAD ({script_label}): {line}")

                if result.stderr:
                    for line in result.stderr.strip().split('\n'):
                        if line.strip():
                            self.log(f"FreeCAD ({script_label}) Error: {line}", "WARN")

                if result.returncode != 0:
                    error_msg = f"FreeCAD conversion failed with exit code {result.returncode} ({script_label})"
                    if result.stderr:
                        error_msg += f"\nError output: {result.stderr[:500]}"
                    self.log(error_msg, "ERROR")
                    raise subprocess.CalledProcessError(result.returncode, cmd, result.stdout, result.stderr)

                status_info = self._load_status_file(status_path_obj)
                script_used = script_label
                try:
                    status_path_obj.unlink(missing_ok=True)
                except Exception:
                    pass
                break

            except subprocess.TimeoutExpired as timeout_error:
                fallback_reason = fallback_reason or f"{script_label}_timeout"
                self.log(f"FreeCAD {script_label} script timed out after 60s", "ERROR")
                last_exception = TimeoutError("FreeCAD conversion timed out after 60 seconds")
            except subprocess.CalledProcessError as call_error:
                fallback_reason = fallback_reason or f"{script_label}_error_{call_error.returncode}"
                last_exception = call_error
            except Exception as generic_error:
                fallback_reason = fallback_reason or f"{script_label}_unexpected_error"
                self.log(f"Unexpected {script_label} script error: {generic_error}", "ERROR")
                last_exception = generic_error
            finally:
                if script_used != script_label:
                    try:
                        status_path_obj.unlink(missing_ok=True)
                    except Exception:
                        pass

        if script_used is None:
            raise RuntimeError(f"All STEP conversion scripts failed: {fallback_reason}") from last_exception

        # Verify output file was created
        if not obj_path.exists():
            self.log("ERROR: OBJ file was not created by FreeCAD", "ERROR")
            self.log("This indicates FreeCAD could not extract geometry from STEP file", "ERROR")
            raise FileNotFoundError(f"OBJ file was not created: {obj_path}")

        # Get file statistics
        file_size = obj_path.stat().st_size

        vertices_count = 0
        faces_count = 0

        try:
            with open(obj_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith('v '):
                        vertices_count += 1
                    elif line.startswith('f '):
                        faces_count += 1
        except Exception as e:
            self.log(f"Could not read OBJ statistics: {e}", "WARN")

        color_fallback = bool(status_info.get('colorFallback'))
        colorless_objects = status_info.get('colorlessObjects', [])
        status_notes = status_info.get('notes', [])

        if script_used == 'generic' and not color_fallback:
            color_fallback = True
            status_notes.append('Generisches STEP-Skript ohne Farbinformationen verwendet.')

        if not fallback_reason and status_info.get('reason'):
            fallback_reason = status_info.get('reason')

        if color_fallback:
            if colorless_objects:
                preview = ', '.join(colorless_objects[:5])
                suffix = '…' if len(colorless_objects) > 5 else ''
                self.log(f"STEP color fallback for objects: {preview}{suffix}", "WARN")
            else:
                self.log("STEP color fallback triggered – default materials applied", "WARN")

        for note in status_notes:
            self.log(f"STEP note: {note}", "INFO")

        self.log("="*60)
        self.log("Conversion successful")
        self.log(f"Output file: {obj_path}")
        self.log(f"File size: {file_size:,} bytes ({file_size/1024:.2f} KB)")
        self.log(f"Vertices: {vertices_count:,}")
        self.log(f"Faces: {faces_count:,}")
        self.log(f"Script used: {script_used}")
        if fallback_reason:
            self.log(f"Fallback reason: {fallback_reason}", "WARN")
        self.log("="*60)

        stats = {
            'success': True,
            'input_file': str(step_path),
            'output_file': str(obj_path),
            'tessellation_quality': self.tessellation_quality,
            'file_size': file_size,
            'vertices_count': vertices_count,
            'faces_count': faces_count,
            'conversion_successful': True,
            'step_script_used': script_used,
            'step_color_fallback': color_fallback,
            'step_colorless_objects': colorless_objects,
            'step_color_notes': status_notes,
            'step_color_fallback_reason': fallback_reason,
            'step_status': status_info
        }

        return stats

    def _load_status_file(self, status_path: Path) -> Dict[str, Any]:
        """Load STEP conversion status data if available."""
        if not status_path or not status_path.exists():
            return {}
        try:
            with open(status_path, 'r', encoding='utf-8') as status_file:
                data = json.load(status_file)
                if isinstance(data, dict):
                    return data
        except Exception as status_error:
            self.log(f"Could not parse STEP status file {status_path}: {status_error}", "WARN")
        return {}

    def _create_basic_mtl(self, mtl_file: str, obj_name: str):
        """Create a basic MTL material file"""
        mtl_content = f"""# MTL file generated by STEP to OBJ converter
newmtl {obj_name}_material
Ka 0.2 0.2 0.2
Kd 0.8 0.8 0.8
Ks 0.1 0.1 0.1
Ns 10.0
d 1.0
illum 2
"""
        with open(mtl_file, 'w') as f:
            f.write(mtl_content)
        
        self.log(f"Created basic MTL file: {mtl_file}")


def detect_freecad_installation() -> Dict[str, Any]:
    """
    Detect FreeCAD installation and capabilities
    
    Returns:
        dict: FreeCAD installation info
    """
    info = {
        'available': FREECAD_AVAILABLE,
        'version': None,
        'path': FREECAD_BINARY_PATH,
        'method': 'external_command' if FREECAD_AVAILABLE and FREECAD_BINARY_PATH else 'python_module'
    }
    
    if FREECAD_AVAILABLE:
        try:
            if FREECAD_BINARY_PATH:
                # Test external FreeCAD command
                result = subprocess.run([FREECAD_BINARY_PATH, "--version"], 
                                      capture_output=True, text=True, timeout=10)
                if result.returncode == 0:
                    # Parse version from output
                    output = result.stdout.strip()
                    if "FreeCAD" in output:
                        # Extract version number (e.g., "FreeCAD 1.0.2 Revision: 39319 (Git)")
                        import re
                        version_match = re.search(r'FreeCAD (\d+\.\d+(?:\.\d+)?)', output)
                        if version_match:
                            info['version'] = version_match.group(1)
                    info['functional'] = True
                else:
                    info['functional'] = False
                    info['error'] = f"Command failed: {result.stderr}"
            else:
                # Test Python module
                import FreeCAD
                if hasattr(FreeCAD, 'Version'):
                    version_info = FreeCAD.Version()
                    info['version'] = '.'.join(version_info[:3]) if len(version_info) >= 3 else 'Unknown'
                
                # Test basic functionality
                test_doc = FreeCAD.newDocument("test")
                FreeCAD.closeDocument("test")
                info['functional'] = True
            
        except Exception as e:
            info['functional'] = False
            info['error'] = str(e)
    else:
        info['functional'] = False
        info['error'] = "FreeCAD not found"
    
    return info


def main():
    """Command line interface for STEP to OBJ conversion"""
    parser = argparse.ArgumentParser(description='Convert STEP/STP files to OBJ format using FreeCAD')
    parser.add_argument('input', nargs='?', help='Input STEP/STP file path')
    parser.add_argument('output', nargs='?', help='Output OBJ file path')
    parser.add_argument('--quality', '-q', type=float, default=0.1, 
                       help='Tessellation quality (0.01-1.0, lower = finer detail, default: 0.1)')
    parser.add_argument('--mtl', help='Optional MTL file path')
    parser.add_argument('--check', action='store_true', help='Check FreeCAD installation')
    
    args = parser.parse_args()
    
    if args.check:
        print("🔍 Checking FreeCAD installation...")
        info = detect_freecad_installation()
        print(f"Available: {info['available']}")
        print(f"Version: {info.get('version', 'Unknown')}")
        print(f"Functional: {info.get('functional', False)}")
        if 'error' in info:
            print(f"Error: {info['error']}")
        return 0 if info['available'] else 1
    
    if not args.input or not args.output:
        print("Usage: python step_converter.py <input.step> <output.obj>")
        print("   or: python step_converter.py --check")
        return 1
    
    if not FREECAD_AVAILABLE:
        print("❌ FreeCAD is not available. Install with: pip install FreeCAD")
        return 1
    
    try:
        converter = StepToObjConverter(tessellation_quality=args.quality)
        result = converter.convert_step_to_obj(args.input, args.output, args.mtl)
        
        if result.get('conversion_successful', False):
            print(f"✅ Conversion successful: {args.output}")
            print(f"📊 Statistics: {result.get('vertices_count', 0)} vertices, {result.get('faces_count', 0)} faces")
            return 0
        else:
            print(f"❌ Conversion failed: {result.get('error', 'Unknown error')}")
            return 1
            
    except Exception as e:
        print(f"❌ Error: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())