"""Blender-Headless: GLB importieren und als USD exportieren.

Aufruf:
    blender --background --factory-startup --python glb-to-usd.py -- <in.glb> <out.usdc>

Zweck: Die USDZ für AR Quick Look muss aus der FERTIG gebackenen GLB entstehen
(Sichtbarkeits-Regeln angewandt, Farben/Finish eingebrannt), nicht aus der
Blender-Rohszene. Sonst enthält die AR-Ansicht Teile, die in der GLB entfernt
wurden. Das Verpacken nach .usdz übernimmt anschließend `usdzip --arkitAsset`.
"""

import sys
import bpy


def main() -> int:
    argv = sys.argv
    if "--" not in argv:
        print("ERROR: Argumente fehlen (erwartet: -- <in.glb> <out.usdc>)", file=sys.stderr)
        return 2
    args = argv[argv.index("--") + 1:]
    if len(args) < 2:
        print("ERROR: erwartet <in.glb> <out.usdc>", file=sys.stderr)
        return 2
    glb_path, usd_path = args[0], args[1]

    # Leere Szene: --factory-startup bringt Würfel/Kamera/Licht mit, die sonst
    # mit in die USDZ wandern würden.
    bpy.ops.wm.read_factory_settings(use_empty=True)

    try:
        bpy.ops.import_scene.gltf(filepath=glb_path)
    except Exception as exc:
        print(f"ERROR: glTF-Import fehlgeschlagen: {exc}", file=sys.stderr)
        return 3

    if not bpy.context.scene.objects:
        print("ERROR: GLB enthielt keine Objekte", file=sys.stderr)
        return 4

    before, after = merge_duplicate_vertices()
    if before:
        print(f"INFO: Vertices zusammengefuehrt: {before} -> {after}")

    try:
        bpy.ops.wm.usd_export(filepath=usd_path)
    except Exception as exc:
        print(f"ERROR: USD-Export fehlgeschlagen: {exc}", file=sys.stderr)
        return 5

    mesh_count = sum(1 for o in bpy.context.scene.objects if o.type == "MESH")
    print(f"OK: {mesh_count} Mesh(es) exportiert nach {usd_path}")
    return 0


def merge_duplicate_vertices(threshold: float = 1e-5) -> tuple:
    """Deckungsgleiche Vertices zusammenfuehren.

    glTF speichert Vertices pro Dreieck getrennt, sobald sich Normale oder UV an
    einer Kante unterscheiden — bei CAD-Geometrie mit harten Kanten also fast
    ueberall. Beim Reimport traegt die Szene deshalb ein Vielfaches der Vertices,
    die das urspruengliche CAD-Mesh hatte, und der USD-Export schreibt jeden
    einzeln aus. Merge-by-Distance stellt die geteilten Vertices wieder her.

    Die Schattierung bleibt erhalten: Der glTF-Import legt Custom Split Normals
    an, die Blender beim Verschmelzen respektiert (der USD-Export schreibt sie als
    faceVarying-Normalen, harte Kanten bleiben hart). Der Schwellwert ist bewusst
    winzig (0.01 mm bei Metern als Einheit) — nur exakt deckungsgleiche Punkte.

    Der Merge entfernt zusaetzlich Flaechen, die dabei entarten. Das ist kein
    Geometrieverlust: Die FreeCAD-Tessellierung liefert einen erheblichen Anteil
    Dreiecke mit exakt Flaeche 0 (gemessen 36.228 von 207.622 bei 20067956), die
    ohnehin nichts rendern. Gegenprobe: Das Ergebnis ist fuer Schwellwerte von
    1e-9 bis 1e-5 identisch — es werden ausschliesslich deckungsgleiche Punkte
    verschmolzen, keine benachbarten.
    """
    import bmesh

    before = 0
    after = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.data is None:
            continue
        mesh = obj.data
        before += len(mesh.vertices)
        try:
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=threshold)
            bm.to_mesh(mesh)
            bm.free()
            mesh.update()
        except Exception as exc:
            print(f"WARNING: Merge fuer '{obj.name}' uebersprungen: {exc}", file=sys.stderr)
        after += len(mesh.vertices)
    return before, after


if __name__ == "__main__":
    sys.exit(main())
