"""Headless Blender automation runner executing declarative action recipes."""
import argparse
import json
import os
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import bpy

from scene_tools import (
    SceneToolError,
    render_still_to_path,
    set_active_camera,
    set_light_color,
    set_light_power,
    set_light_temperature,
    set_world_background_strength,
)


class AutomationRunner:
    def __init__(self, job_id: str, recipe: Dict[str, Any], output_root: Path):
        self.job_id = job_id
        self.recipe = recipe
        self.output_root = output_root
        self.output_dir = (output_root / job_id) if job_id else output_root
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.logs: List[Dict[str, Any]] = []
        self.outputs: List[Dict[str, Any]] = []

    def log(self, message: str, level: str = "INFO", **extra: Any) -> None:
        entry = {
            "timestamp": datetime.utcnow().isoformat(timespec="milliseconds") + "Z",
            "level": level,
            "message": message,
        }
        if extra:
            entry.update(extra)
        self.logs.append(entry)
        print(f"[{level}] {message}")

    def execute(self) -> None:
        actions = self.recipe.get("actions")
        if not isinstance(actions, list):
            raise ValueError("Recipe must contain an 'actions' array")
        self.log(f"Executing {len(actions)} automation actions")
        for idx, action in enumerate(actions):
            self._execute_action(idx, action)

    def _execute_action(self, index: int, action: Dict[str, Any]) -> None:
        if not isinstance(action, dict):
            raise ValueError(f"Action at index {index} must be an object")
        action_type = action.get("type")
        if not action_type:
            raise ValueError(f"Action at index {index} is missing 'type'")

        self.log(f"Action {index}: {action_type}", details=action)

        try:
            if action_type == "select_camera":
                camera_name = action.get("camera")
                if not camera_name:
                    raise ValueError("select_camera action requires 'camera'")
                set_active_camera(str(camera_name))
                self.log(f"Active camera set to {camera_name}", level="DEBUG")

            elif action_type == "set_light_power":
                light_name = action.get("light")
                power = action.get("power")
                if light_name is None or power is None:
                    raise ValueError("set_light_power requires 'light' and 'power'")
                set_light_power(str(light_name), float(power))
                self.log(f"Light {light_name} power set to {power}W", level="DEBUG")

            elif action_type == "set_light_color":
                light_name = action.get("light")
                color = action.get("color")
                if light_name is None or not isinstance(color, (list, tuple)):
                    raise ValueError("set_light_color requires 'light' and RGB 'color'")
                set_light_color(str(light_name), color)
                self.log(f"Light {light_name} color set to {tuple(color)}", level="DEBUG")

            elif action_type == "set_light_temperature":
                light_name = action.get("light")
                kelvin = action.get("kelvin")
                if light_name is None or kelvin is None:
                    raise ValueError("set_light_temperature requires 'light' and 'kelvin'")
                set_light_temperature(str(light_name), float(kelvin))
                self.log(f"Light {light_name} temperature set to {kelvin}K", level="DEBUG")

            elif action_type == "set_world_strength":
                strength = action.get("strength")
                if strength is None:
                    raise ValueError("set_world_strength requires 'strength'")
                set_world_background_strength(float(strength))
                self.log(f"World background strength set to {strength}", level="DEBUG")

            elif action_type == "render":
                self._render_action(index, action)

            elif action_type == "log":
                message = action.get("message", "")
                level = action.get("level", "INFO")
                self.log(message, level=str(level).upper())

            else:
                raise ValueError(f"Unsupported action type '{action_type}'")

        except SceneToolError as exc:
            raise RuntimeError(f"Scene operation failed: {exc}") from exc

    def _render_action(self, index: int, action: Dict[str, Any]) -> None:
        # Optional: camera override within render action
        camera_override = action.get("camera")
        if camera_override:
            set_active_camera(str(camera_override))
            self.log(f"Render action {index}: camera overridden to {camera_override}", level="DEBUG")

        filename = action.get("filename")
        if not filename:
            filename = f"render_{index:03d}.png"
        filepath = (self.output_dir / filename).resolve()

        settings = action.get("settings", {})
        if settings and not isinstance(settings, dict):
            raise ValueError("render action 'settings' must be an object when provided")

        render_kwargs = {
            "engine": settings.get("engine"),
            "resolution_x": settings.get("resolution_x"),
            "resolution_y": settings.get("resolution_y"),
            "resolution_percentage": settings.get("resolution_percentage"),
            "samples": settings.get("samples"),
            "use_denoise": settings.get("use_denoise"),
            "color_depth": settings.get("color_depth"),
            "color_mode": settings.get("color_mode"),
        }

        render_still_to_path(filepath, **render_kwargs)

        self.outputs.append(
            {
                "type": "render",
                "actionIndex": index,
                "path": str(filepath),
                "settings": {k: v for k, v in render_kwargs.items() if v is not None},
            }
        )
        self.log(f"Rendered still to {filepath}")


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Execute Blender automation recipe actions")
    parser.add_argument("--job-id", required=False, default="automation-job", help="Identifier for the automation run")
    parser.add_argument("--recipe-file", required=True, help="Path to JSON recipe file")
    parser.add_argument(
        "--output-root",
        required=False,
        help="Base directory for rendered outputs (defaults to BLENDER_OUTPUT_DIR/renders)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse the recipe and log actions without rendering (for validation)",
    )
    return parser.parse_args(argv)


def load_recipe(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("Recipe JSON must be an object at the top level")
    return data


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    recipe_path = Path(args.recipe_file).resolve()
    if not recipe_path.exists():
        raise FileNotFoundError(f"Recipe file not found: {recipe_path}")

    if args.output_root:
        output_root = Path(args.output_root).resolve()
    else:
        default_root = os.environ.get("BLENDER_OUTPUT_DIR")
        if default_root:
            output_root = Path(default_root).resolve() / "renders"
        else:
            output_root = Path(__file__).resolve().parents[1] / "outputs" / "renders"
    output_root.mkdir(parents=True, exist_ok=True)

    recipe = load_recipe(recipe_path)
    runner = AutomationRunner(args.job_id, recipe, output_root)

    success = True
    error_message: Optional[str] = None
    traceback_text: Optional[str] = None

    try:
        if args.dry_run:
            runner.log("Dry run enabled: actions will be validated only", level="WARNING")
            runner.execute()
        else:
            runner.execute()
    except Exception as exc:  # noqa: BLE001 - capture everything for JSON result
        success = False
        error_message = str(exc)
        traceback_text = traceback.format_exc()
        runner.log(f"Automation failed: {exc}", level="ERROR")
        print(traceback_text, file=sys.stderr)

    result = {
        "success": success,
        "jobId": args.job_id,
        "recipe": str(recipe_path),
        "outputDir": str(runner.output_dir),
        "outputs": runner.outputs,
        "logs": runner.logs,
    }
    if not success and error_message:
        result["error"] = error_message
        if traceback_text:
            result["traceback"] = traceback_text

    print("=== AUTOMATION_RESULT ===")
    print(json.dumps(result, indent=2))
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
