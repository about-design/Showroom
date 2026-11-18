#!/usr/bin/env python3
"""
Blender Apple-Style Scene Setup Script
Creates a professional Apple-style rendering setup with lighting, materials, and camera
"""

import bpy
import sys
import json
import os
from pathlib import Path
from mathutils import Vector

def clear_scene():
    """Remove all default objects from the scene"""
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    
    # Clear all materials
    for material in bpy.data.materials:
        bpy.data.materials.remove(material)
    
    # Clear all lights
    for light in bpy.data.lights:
        bpy.data.lights.remove(light)
    
    # Clear all cameras
    for camera in bpy.data.cameras:
        bpy.data.cameras.remove(camera)

def setup_cycles_render(samples=512):
    """Configure Cycles render settings"""
    scene = bpy.context.scene
    
    # Set Cycles as render engine
    scene.render.engine = 'CYCLES'
    
    # Try to set GPU compute device (platform-specific)
    try:
        # Try OPTIX first (NVIDIA)
        bpy.context.preferences.addons['cycles'].preferences.compute_device_type = 'OPTIX'
    except TypeError:
        try:
            # Try METAL (Apple Silicon/macOS)
            bpy.context.preferences.addons['cycles'].preferences.compute_device_type = 'METAL'
        except TypeError:
            try:
                # Fallback to CUDA (older NVIDIA)
                bpy.context.preferences.addons['cycles'].preferences.compute_device_type = 'CUDA'
            except TypeError:
                # Use CPU if no GPU available
                pass
    
    bpy.context.preferences.addons['cycles'].preferences.get_devices()
    
    # Enable GPU rendering
    scene.cycles.device = 'GPU'
    
    # Samples
    scene.cycles.samples = samples
    
    # Denoiser
    scene.cycles.use_denoising = True
    try:
        scene.cycles.denoiser = 'OPTIX'
    except TypeError:
        # Fallback to OpenImageDenoise
        scene.cycles.denoiser = 'OPENIMAGEDENOISE'
    
    # Color Management
    scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = 0.7
    scene.view_settings.gamma = 1.0
    
    # Transparent film
    scene.render.film_transparent = True
    scene.cycles.film_transparent = True

def create_area_light(name, size, power, color=(1, 1, 1), location=(0, 0, 0), rotation=(0, 0, 0)):
    """Create an area light with specified parameters"""
    bpy.ops.object.light_add(type='AREA', location=location)
    light_obj = bpy.context.active_object
    light_obj.name = name
    
    light = light_obj.data
    light.energy = power
    light.color = color
    
    # Set size (for rectangular lights)
    if isinstance(size, (list, tuple)) and len(size) == 2:
        light.shape = 'RECTANGLE'
        light.size = size[0]
        light.size_y = size[1]
    else:
        light.shape = 'SQUARE'
        light.size = size
    
    # Rotation
    light_obj.rotation_euler = rotation
    
    return light_obj

def point_to_target(obj, target_location):
    """Point an object towards a target location"""
    direction = Vector(target_location) - obj.location
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

def create_apple_lighting():
    """Create Apple-style 4-point lighting setup"""
    lights = []
    
    # KEY LIGHT - Main light source
    key_light = create_area_light(
        name="KeyLight",
        size=(5, 5),
        power=1200,
        color=(1.0, 1.0, 1.0),
        location=(-3, -2, 5)
    )
    point_to_target(key_light, (0, 0, 0))
    lights.append(key_light)
    
    # FILL LIGHT - Soften shadows
    fill_light = create_area_light(
        name="FillLight",
        size=(6, 6),
        power=400,
        location=(3, 1, 3)
    )
    point_to_target(fill_light, (0, 0, 0))
    lights.append(fill_light)
    
    # RIM LIGHT - Edge definition
    rim_light = create_area_light(
        name="RimLight",
        size=(3, 3),
        power=800,
        location=(0, -4, 4)
    )
    point_to_target(rim_light, (0, 0, 0))
    lights.append(rim_light)
    
    # TOP LIGHT - Optional overhead light
    top_light = create_area_light(
        name="TopLight",
        size=4,
        power=200,
        location=(0, 0, 6)
    )
    point_to_target(top_light, (0, 0, 0))
    lights.append(top_light)
    
    return lights

def setup_world_hdri(hdri_path=None, strength=0.3):
    """Setup world environment with HDRI or neutral gray"""
    world = bpy.context.scene.world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    
    # Clear existing nodes
    nodes.clear()
    
    # Create nodes
    output_node = nodes.new(type='ShaderNodeOutputWorld')
    background_node = nodes.new(type='ShaderNodeBackground')
    
    output_node.location = (300, 0)
    background_node.location = (0, 0)
    
    # Check if HDRI exists
    if hdri_path and os.path.exists(hdri_path):
        env_tex_node = nodes.new(type='ShaderNodeTexEnvironment')
        env_tex_node.location = (-300, 0)
        
        # Load HDRI
        env_tex_node.image = bpy.data.images.load(hdri_path)
        
        # Connect nodes
        links.new(env_tex_node.outputs['Color'], background_node.inputs['Color'])
    else:
        # Use neutral gray
        background_node.inputs['Color'].default_value = (0.5, 0.5, 0.5, 1.0)
    
    background_node.inputs['Strength'].default_value = strength
    links.new(background_node.outputs['Background'], output_node.inputs['Surface'])

def create_camera(focal_length=85, f_stop=8, location=(0, -3, 1.6), look_at=(0, 0, 1)):
    """Create camera with Apple-style settings"""
    bpy.ops.object.camera_add(location=location)
    camera_obj = bpy.context.active_object
    camera_obj.name = "MainCamera"
    
    camera = camera_obj.data
    camera.lens = focal_length
    camera.dof.use_dof = True
    camera.dof.aperture_fstop = f_stop
    camera.clip_start = 0.01
    camera.clip_end = 1000
    
    # Point camera at target
    point_to_target(camera_obj, look_at)
    
    # Set as active camera
    bpy.context.scene.camera = camera_obj
    
    return camera_obj

def create_shadow_plane():
    """Create soft shadow plane"""
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = "ShadowPlane"
    
    # Create material
    mat = bpy.data.materials.new(name="ShadowPlaneMaterial")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    
    # Clear default nodes
    nodes.clear()
    
    # Create nodes
    output = nodes.new(type='ShaderNodeOutputMaterial')
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    gradient = nodes.new(type='ShaderNodeTexGradient')
    color_ramp = nodes.new(type='ShaderNodeValToRGB')
    tex_coord = nodes.new(type='ShaderNodeTexCoord')
    
    # Position nodes
    output.location = (400, 0)
    bsdf.location = (200, 0)
    color_ramp.location = (0, -200)
    gradient.location = (-200, -200)
    tex_coord.location = (-400, -200)
    
    # Configure BSDF
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Alpha'].default_value = 0.15
    
    # Configure ColorRamp for soft gradient
    color_ramp.color_ramp.elements[0].position = 0.3
    color_ramp.color_ramp.elements[1].position = 0.7
    
    # Connect nodes
    links.new(tex_coord.outputs['Generated'], gradient.inputs['Vector'])
    links.new(gradient.outputs['Color'], color_ramp.inputs['Fac'])
    links.new(color_ramp.outputs['Color'], bsdf.inputs['Alpha'])
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    
    # Enable transparency
    mat.blend_method = 'BLEND'
    
    # Assign material
    plane.data.materials.append(mat)
    
    return plane

def create_apple_metal_material():
    """Create Apple-style metal material"""
    mat = bpy.data.materials.new(name="AppleMetal")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    
    # Clear default nodes
    nodes.clear()
    
    # Create nodes
    output = nodes.new(type='ShaderNodeOutputMaterial')
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    noise = nodes.new(type='ShaderNodeTexNoise')
    bump = nodes.new(type='ShaderNodeBump')
    
    # Position nodes
    output.location = (400, 0)
    bsdf.location = (200, 0)
    bump.location = (0, -200)
    noise.location = (-200, -200)
    
    # Configure BSDF
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.08
    bsdf.inputs['Specular IOR Level'].default_value = 0.6
    bsdf.inputs['Coat Weight'].default_value = 0.5
    bsdf.inputs['Coat Roughness'].default_value = 0.05
    
    # Configure noise for subtle bump
    noise.inputs['Scale'].default_value = 3000
    bump.inputs['Strength'].default_value = 0.05
    
    # Connect nodes
    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    
    return mat

def create_apple_glass_material():
    """Create Apple-style glass material"""
    mat = bpy.data.materials.new(name="AppleGlass")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    
    # Clear default nodes
    nodes.clear()
    
    # Create nodes
    output = nodes.new(type='ShaderNodeOutputMaterial')
    bsdf = nodes.new(type='ShaderNodeBsdfPrincipled')
    layer_weight = nodes.new(type='ShaderNodeLayerWeight')
    color_ramp = nodes.new(type='ShaderNodeValToRGB')
    
    # Position nodes
    output.location = (400, 0)
    bsdf.location = (200, 0)
    color_ramp.location = (0, -200)
    layer_weight.location = (-200, -200)
    
    # Configure BSDF for glass
    bsdf.inputs['Transmission Weight'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.02
    bsdf.inputs['IOR'].default_value = 1.45
    bsdf.inputs['Coat Weight'].default_value = 1.0
    bsdf.inputs['Coat Roughness'].default_value = 0.02
    
    # Thin-film effect via layer weight
    layer_weight.inputs['Blend'].default_value = 0.5
    
    # Connect nodes for subtle iridescence
    links.new(layer_weight.outputs['Facing'], color_ramp.inputs['Fac'])
    links.new(color_ramp.outputs['Color'], bsdf.inputs['Emission Color'])
    links.new(bsdf.outputs['BSDF'], output.inputs['Surface'])
    
    # Enable transparency
    mat.blend_method = 'BLEND'
    
    return mat

def main():
    """Main function to create Apple-style setup"""
    try:
        # Parse command line arguments
        args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
        
        # Default output path
        output_path = os.path.expanduser("~/Desktop/apple_style_setup.blend")
        samples = 512
        hdri_path = None
        
        # Parse arguments
        for i, arg in enumerate(args):
            if arg == "--output" and i + 1 < len(args):
                output_path = args[i + 1]
            elif arg == "--samples" and i + 1 < len(args):
                samples = int(args[i + 1])
            elif arg == "--hdri" and i + 1 < len(args):
                hdri_path = args[i + 1]
        
        print(f"Creating Apple-style setup...")
        
        # Step 1: Clear scene
        print("Clearing default scene...")
        clear_scene()
        
        # Step 2: Setup Cycles render
        print(f"Setting up Cycles render ({samples} samples)...")
        setup_cycles_render(samples)
        
        # Step 3: Create lighting
        print("Creating Apple-style lighting...")
        lights = create_apple_lighting()
        
        # Step 4: Setup world HDRI
        print("Setting up world environment...")
        setup_world_hdri(hdri_path)
        
        # Step 5: Create camera
        print("Creating camera...")
        camera = create_camera()
        
        # Step 6: Create shadow plane
        print("Creating shadow plane...")
        shadow_plane = create_shadow_plane()
        
        # Step 7: Create materials
        print("Creating Apple-style materials...")
        metal_mat = create_apple_metal_material()
        glass_mat = create_apple_glass_material()
        
        # Step 8: Save scene
        print(f"Saving scene to: {output_path}")
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=output_path)
        
        # Output result as JSON
        result = {
            "success": True,
            "message": "Apple-style setup created successfully",
            "output_path": output_path,
            "stats": {
                "lights": len(lights),
                "materials": 3,  # Shadow plane + AppleMetal + AppleGlass
                "render_samples": samples,
                "camera_focal_length": 85
            }
        }
        
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        result = {
            "success": False,
            "error": str(e)
        }
        print(json.dumps(result, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    main()
