# Blender ≥ 3.4: Headless UV (Smart Project + Pack) für Wavefront-OBJ.
# Aufruf: blender --background --python blender_auto_uv.py -- /abs/in.obj /abs/out.obj
import sys
import bpy


def _argv_after_dd():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def main():
    args = _argv_after_dd()
    if len(args) < 2:
        print(
            "usage: blender --background --python blender_auto_uv.py -- input.obj output.obj",
            file=sys.stderr,
        )
        return 1
    inp, outp = args[0], args[1]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    try:
        bpy.ops.wm.obj_import(filepath=inp)
    except Exception as e:
        print(f"[auto-uv] obj_import failed: {e}", file=sys.stderr)
        return 2

    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        print("[auto-uv] no mesh objects in file", file=sys.stderr)
        return 3

    angle_rad = 66.0 * 3.141592653589793 / 180.0
    for obj in meshes:
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        if not obj.data.uv_layers:
            obj.data.uv_layers.new(name="UVMap")
        bpy.ops.uv.smart_project(
            angle_limit=angle_rad,
            island_margin=0.02,
            area_weight=0.0,
            correct_aspect=True,
        )
        bpy.ops.uv.pack_islands(margin=0.002)
        bpy.ops.object.mode_set(mode="OBJECT")

    try:
        bpy.ops.wm.obj_export(
            filepath=outp,
            check_existing=False,
            export_selected_objects=False,
            forward_axis="NEGATIVE_Z",
            up_axis="Y",
            export_materials=True,
        )
    except Exception as e:
        print(f"[auto-uv] obj_export failed: {e}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
