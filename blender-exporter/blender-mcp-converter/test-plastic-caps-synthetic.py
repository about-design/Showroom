#!/usr/bin/env python3
"""
Synthetic test to verify _apply_plastic_to_caps() function works correctly.
Creates a simple scene with objects named "Kappe_01" and "Kappe_02" and tests material application.
"""

import bpy
import sys

# Clear existing scene
bpy.ops.wm.read_homefile(use_empty=True)

# Create test objects
# Create a post
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 10), scale=(1, 1, 10))
post = bpy.context.active_object
post.name = "Pfosten_01"

# Create cap 1 (small cube on top)
bpy.ops.mesh.primitive_cube_add(location=(0, 0, 20.5), scale=(1.2, 1.2, 0.5))
cap1 = bpy.context.active_object
cap1.name = "Kappe_01"

# Create cap 2 (another small cube)
bpy.ops.mesh.primitive_cube_add(location=(3, 0, 20.5), scale=(1.2, 1.2, 0.5))
cap2 = bpy.context.active_object
cap2.name = "Kappe_02"

# Add a regular part
bpy.ops.mesh.primitive_cube_add(location=(0, 3, 5), scale=(0.5, 3, 0.5))
part = bpy.context.active_object
part.name = "Teil_01"

print(f"[TEST] Created test scene with {len(bpy.context.scene.objects)} objects")
for obj in bpy.context.scene.objects:
    print(f"  - {obj.name} (type: {obj.type})")

# Import the converter script and call the function
sys.path.insert(0, 'blender-scripts')
from convert_to_glb import BlenderOBJToGLBConverter

converter = BlenderOBJToGLBConverter()

print("\n[TEST] Calling _apply_plastic_to_caps()...")
converter._apply_plastic_to_caps()

print("\n[TEST] Verifying materials were applied:")
for obj in bpy.context.scene.objects:
    if obj.type == 'MESH':
        if len(obj.data.materials) > 0:
            mat = obj.data.materials[0]
            if mat and mat.use_nodes:
                bsdf = None
                for node in mat.node_tree.nodes:
                    if node.type == 'BSDF_PRINCIPLED':
                        bsdf = node
                        break
                if bsdf:
                    color = bsdf.inputs['Base Color'].default_value
                    metallic = bsdf.inputs['Metallic'].default_value
                    roughness = bsdf.inputs['Roughness'].default_value
                    print(f"  {obj.name}: Color={tuple(color[:3])}, Metallic={metallic}, Roughness={roughness}")
                else:
                    print(f"  {obj.name}: No Principled BSDF found")
            else:
                print(f"  {obj.name}: Material doesn't use nodes")
        else:
            print(f"  {obj.name}: No materials")

# Export to GLB for manual inspection
output_path = "outputs/test-synthetic-caps.glb"
bpy.ops.export_scene.gltf(
    filepath=output_path,
    export_format='GLB',
    use_selection=False
)
print(f"\n[TEST] Exported to {output_path}")
print("[TEST] SUCCESS: Test completed")
