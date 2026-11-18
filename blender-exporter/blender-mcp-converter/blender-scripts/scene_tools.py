"""Utility helpers for camera, light and render management in Blender headless runs."""
import math
from pathlib import Path
from typing import Optional, Sequence, Tuple

import bpy


class SceneToolError(RuntimeError):
    """Raised when a requested scene operation cannot be completed."""


def _ensure_object(name: str) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise SceneToolError(f"Object '{name}' not found in current Blender file")
    return obj


def set_active_camera(camera_name: str) -> bpy.types.Object:
    """Make the camera with the given name the active scene camera."""
    camera_obj = _ensure_object(camera_name)
    if camera_obj.type != 'CAMERA':
        raise SceneToolError(f"Object '{camera_name}' is not a camera (type={camera_obj.type})")
    bpy.context.scene.camera = camera_obj
    return camera_obj


def ensure_camera(camera_name: str) -> bpy.types.Object:
    """Return the camera object or raise an error if it cannot be found."""
    camera_obj = _ensure_object(camera_name)
    if camera_obj.type != 'CAMERA':
        raise SceneToolError(f"Object '{camera_name}' is not a camera (type={camera_obj.type})")
    return camera_obj


def ensure_light(light_name: str) -> bpy.types.Object:
    """Return the light object or raise an error if it cannot be found."""
    light_obj = _ensure_object(light_name)
    if light_obj.type != 'LIGHT':
        raise SceneToolError(f"Object '{light_name}' is not a light (type={light_obj.type})")
    return light_obj


def set_light_power(light_name: str, power_watts: float) -> None:
    """Set the emissive power of a light in watts."""
    light = ensure_light(light_name)
    light.data.energy = float(power_watts)


def set_light_color(light_name: str, rgb: Sequence[float]) -> None:
    """Set the light color (expects three floats in the range 0..1)."""
    light = ensure_light(light_name)
    if len(rgb) < 3:
        raise SceneToolError("RGB color requires three components")
    light.data.color = (float(rgb[0]), float(rgb[1]), float(rgb[2]))


def set_light_temperature(light_name: str, kelvin: float) -> None:
    """Approximate a color temperature in Kelvin for the light color."""
    kelvin = max(1000.0, min(40000.0, float(kelvin)))
    light = ensure_light(light_name)
    light.data.color = kelvin_to_rgb(kelvin)


def kelvin_to_rgb(kelvin: float) -> Tuple[float, float, float]:
    """Convert a black-body Kelvin temperature to an RGB tuple (0..1)."""
    temperature = kelvin / 100.0
    # Red
    if temperature <= 66:
        red = 255
    else:
        red = temperature - 60
        red = 329.698727446 * (red ** -0.1332047592)
        red = max(0, min(255, red))
    # Green
    if temperature <= 66:
        green = temperature
        green = 99.4708025861 * math.log(green) - 161.1195681661
    else:
        green = temperature - 60
        green = 288.1221695283 * (green ** -0.0755148492)
    green = max(0, min(255, green))
    # Blue
    if temperature >= 66:
        blue = 255
    elif temperature <= 19:
        blue = 0
    else:
        blue = temperature - 10
        blue = 138.5177312231 * math.log(blue) - 305.0447927307
        blue = max(0, min(255, blue))
    return (red / 255.0, green / 255.0, blue / 255.0)


def set_world_background_strength(strength: float) -> None:
    """Adjust the world/background light strength if nodes are enabled."""
    scene = bpy.context.scene
    world = scene.world
    if world is None:
        raise SceneToolError("Scene has no world assigned")
    strength = max(0.0, float(strength))
    if world.use_nodes and world.node_tree:
        bg = world.node_tree.nodes.get('Background')
        if bg and bg.inputs and len(bg.inputs) > 1:
            bg.inputs[1].default_value = strength
            return
    # Fallback: use the world energy value (Eevee)
    if hasattr(world, "light_settings") and hasattr(world.light_settings, "use_ambient_occlusion"):
        # Eevee specific property, keep compatibility even if AO disabled
        world.light_settings.ao_factor = strength
    else:
        world.color = (strength, strength, strength)


def ensure_output_path(output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    return output_path


def configure_render_settings(
    *,
    engine: Optional[str] = None,
    resolution_x: Optional[int] = None,
    resolution_y: Optional[int] = None,
    resolution_percentage: Optional[int] = None,
    samples: Optional[int] = None,
    use_denoise: Optional[bool] = None,
) -> None:
    scene = bpy.context.scene
    if engine:
        scene.render.engine = engine
    if resolution_x:
        scene.render.resolution_x = int(resolution_x)
    if resolution_y:
        scene.render.resolution_y = int(resolution_y)
    if resolution_percentage:
        scene.render.resolution_percentage = int(resolution_percentage)
    if engine == 'CYCLES':
        if samples is not None:
            scene.cycles.samples = int(samples)
        if use_denoise is not None:
            scene.cycles.use_denoising = bool(use_denoise)
    elif engine == 'BLENDER_EEVEE' and samples is not None:
        scene.eevee.taa_render_samples = int(samples)


def _detect_file_format(path: Path) -> str:
    ext = path.suffix.lower()
    if ext == '.png':
        return 'PNG'
    if ext in {'.jpg', '.jpeg'}:
        return 'JPEG'
    if ext == '.exr':
        return 'OPEN_EXR'
    if ext == '.tif' or ext == '.tiff':
        return 'TIFF'
    return 'PNG'


def render_still_to_path(
    filepath: Path,
    *,
    engine: Optional[str] = None,
    resolution_x: Optional[int] = None,
    resolution_y: Optional[int] = None,
    resolution_percentage: Optional[int] = None,
    samples: Optional[int] = None,
    use_denoise: Optional[bool] = None,
    color_depth: Optional[int] = None,
    color_mode: Optional[str] = None,
) -> Path:
    scene = bpy.context.scene
    filepath = ensure_output_path(filepath)

    original_filepath = Path(scene.render.filepath) if scene.render.filepath else None
    original_format = scene.render.image_settings.file_format
    original_depth = scene.render.image_settings.color_depth
    original_mode = scene.render.image_settings.color_mode

    configure_render_settings(
        engine=engine,
        resolution_x=resolution_x,
        resolution_y=resolution_y,
        resolution_percentage=resolution_percentage,
        samples=samples,
        use_denoise=use_denoise,
    )

    scene.render.filepath = str(filepath)
    scene.render.image_settings.file_format = _detect_file_format(filepath)
    if color_depth:
        scene.render.image_settings.color_depth = str(int(color_depth))
    if color_mode:
        scene.render.image_settings.color_mode = color_mode

    bpy.ops.render.render(write_still=True)

    # Restore previous render settings to avoid side effects
    if original_filepath is not None:
        scene.render.filepath = str(original_filepath)
    scene.render.image_settings.file_format = original_format
    scene.render.image_settings.color_depth = original_depth
    scene.render.image_settings.color_mode = original_mode

    return filepath
```,