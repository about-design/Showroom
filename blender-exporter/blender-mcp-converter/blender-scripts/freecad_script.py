#!/usr/bin/env python3
"""
FreeCAD Script for STEP to OBJ Conversion
This script is executed by FreeCAD command line interface
"""

import sys
import os
import json

print("FreeCAD STEP to OBJ Converter")
print("Working directory:", os.getcwd())
print("Script arguments:", sys.argv)

# FreeCAD passes arguments differently - we need to read from environment or files
input_file = os.environ.get('STEP_INPUT_FILE')
output_file = os.environ.get('STEP_OUTPUT_FILE')  
tessellation_quality = float(os.environ.get('STEP_TESSELLATION', '0.1'))
status_path = os.environ.get('STEP_STATUS_PATH')

if not input_file or not output_file:
    print("ERROR: Environment variables STEP_INPUT_FILE and STEP_OUTPUT_FILE must be set")
    sys.exit(1)

print(f"Converting: {input_file} -> {output_file}")
print(f"Tessellation quality: {tessellation_quality}")

try:
    import FreeCAD
    import Import
    import Mesh
    import Part

    # Create new document
    doc = FreeCAD.newDocument("StepConversion")
    
    # Import STEP file
    print("Importing STEP file...")
    Import.insert(input_file, "StepConversion")
    
    # Get imported objects
    objects = doc.Objects
    print(f"Found {len(objects)} objects")
    
    if not objects:
        print("ERROR: No objects found in STEP file")
        sys.exit(1)
    
    # Keep every imported STEP component as an individual OBJ object so Blender
    # can retain movable sub-parts such as telescopic sections.
    meshes = []
    
    for i, obj in enumerate(objects):
        if hasattr(obj, 'Shape') and obj.Shape:
            print(f"Processing object {i+1}: {obj.Label}")
            solids = list(obj.Shape.Solids)
            shapes = solids or [obj.Shape]
            print(f"  Found {len(shapes)} solid component(s)")

            for solid_index, shape in enumerate(shapes, start=1):
                try:
                    mesh_data = shape.tessellate(tessellation_quality)
                    if mesh_data and len(mesh_data) >= 2:
                        vertices, faces = mesh_data[0], mesh_data[1]
                        label = obj.Label or f"Component_{i + 1}"
                        if len(shapes) > 1:
                            label = f"{label}_{solid_index}"
                        meshes.append((label, vertices, faces))
                        print(f"  Added component {solid_index}: {len(vertices)} vertices, {len(faces)} faces")
                except Exception as e:
                    print(f"WARNING: Could not tessellate {obj.Label} component {solid_index}: {e}")
    
    if not meshes:
        print("ERROR: No mesh data could be extracted")
        sys.exit(1)
    
    total_vertices = sum(len(vertices) for _, vertices, _ in meshes)
    total_faces = sum(len(faces) for _, _, faces in meshes)
    print(f"Writing OBJ file with {len(meshes)} objects, {total_vertices} vertices, {total_faces} faces...")
    
    os.makedirs(os.path.dirname(output_file), exist_ok=True)
    
    with open(output_file, 'w') as f:
        # Write header
        f.write(f"# OBJ file generated from {os.path.basename(input_file)}\n")
        f.write(f"# FreeCAD STEP converter\n")
        f.write(f"# Objects: {len(meshes)}\n")
        f.write(f"# Vertices: {total_vertices}\n")
        f.write(f"# Faces: {total_faces}\n\n")
        
        vertex_offset = 1  # OBJ indices are one-based and global to the file.
        for component_index, (label, vertices, faces) in enumerate(meshes, start=1):
            safe_label = ''.join(char if char.isalnum() or char in '._-' else '_' for char in label)
            f.write(f"o {safe_label or f'Component_{component_index}'}\n")
            for vertex in vertices:
                f.write(f"v {vertex.x} {vertex.y} {vertex.z}\n")
            for face in faces:
                face_indices = [index + vertex_offset for index in face]
                if len(face_indices) == 3:
                    f.write(f"f {face_indices[0]} {face_indices[1]} {face_indices[2]}\n")
                elif len(face_indices) == 4:
                    f.write(f"f {face_indices[0]} {face_indices[1]} {face_indices[2]} {face_indices[3]}\n")
                elif len(face_indices) > 4:
                    for face_index in range(1, len(face_indices) - 1):
                        f.write(f"f {face_indices[0]} {face_indices[face_index]} {face_indices[face_index + 1]}\n")
            vertex_offset += len(vertices)
    
    print("SUCCESS: STEP to OBJ conversion completed")

    if status_path:
        try:
            payload = {
                'script': 'generic',
                'colorFallback': True,
                'reason': 'generic_script_no_color_support'
            }
            with open(status_path, 'w', encoding='utf-8') as status_file:
                json.dump(payload, status_file, indent=2)
        except Exception as status_error:
            print(f"WARNING: Could not write STEP status file: {status_error}")
    
    # Close document
    FreeCAD.closeDocument("StepConversion")

except ImportError as e:
    print(f"ERROR: FreeCAD modules not available: {e}")
    if status_path:
        try:
            payload = {
                'script': 'generic',
                'colorFallback': True,
                'reason': 'generic_script_import_error',
                'error': str(e)
            }
            with open(status_path, 'w', encoding='utf-8') as status_file:
                json.dump(payload, status_file, indent=2)
        except Exception:
            pass
    sys.exit(1)
except Exception as e:
    print(f"ERROR: Conversion failed: {e}")
    if status_path:
        try:
            payload = {
                'script': 'generic',
                'colorFallback': True,
                'reason': 'generic_script_runtime_error',
                'error': str(e)
            }
            with open(status_path, 'w', encoding='utf-8') as status_file:
                json.dump(payload, status_file, indent=2)
        except Exception:
            pass
    sys.exit(1)