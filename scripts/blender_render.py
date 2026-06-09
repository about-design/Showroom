# Blender ≥ 4.0: Headless Render (GLB + Kamera + RAL-Material) → PNG (RGBA, optional Shadow Catcher).
# Aufruf: blender --background --python scripts/blender_render.py -- /abs/job.json /abs/out.png
#
# --- Showroom (Three.js, Y-up) ↔ Blender (Z-up), gleiche Bildwirkung ---
# Der Showroom ist Y-up (wie glTF). Blender ist Z-up; der GLB-Importer nutzt dieselbe Basis wie
# Khronos glTF-Blender-IO (Matrix C in _gltf_blender_io_axis_matrix).
# Placement (placementMatrixWorld): M_blender = C @ M_three @ C⁻¹ — wie der GLB-Importer.
# Kamera: cameraMatrixWorld → M_cam_bl = C · M_cam_th (nur links, KEINE Similarity),
# weil die lokalen Kamera-Achsen in Three und Blender gleich sind (-Z forward, +Y up).
# Fallback Orbit position + target (Swizzle) wenn Matrix fehlt/singulär ist.
# Ziel: Das PNG soll aussehen wie die aktuelle Showroom-Ansicht.
#
# job.json-Felder (siehe scripts/render/blenderRenderRoute.mjs):
#   glbAbs, outPng, usesGlbOriginalColors, hex, ralCode, surfaceFinish,
#   placementMatrixWorld: 16 floats, Three matrixWorld.elements (column-major), Placement-Group
#   cameraMatrixWorld: optional (16 floats, + C @ M @ C⁻¹), nach BBox-Test sonst Orbit-Fallback
#   camera: { position, target, up?, focalLength } — zuverlässige Showroom-Sicht (Swizzle + Blick)
#   fovDeg, near, far, aspect (optional)
#   resolution: { width, height }, engine: "cycles" | "eevee",
#   transparentBackground, shadowCatcher (erzwingt film_transparent + Cycles), hdriAbs (optional)
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

# Mindest-|det(3×3)| für gültige Kamera-matrixWorld (nach C-Konjugation); zu streng → Fallback obwohl Matrix ok
_CAM_MATRIX_DET_MIN = 1e-8


def _three_col16_to_matrix(flat):
    """Three.js Matrix4.elements (column-major) → Blender mathutils.Matrix (row-major Zeilen)."""
    if not flat or len(flat) != 16:
        return Matrix.Identity(4)
    e = [float(x) for x in flat]
    return Matrix(
        (
            (e[0], e[4], e[8], e[12]),
            (e[1], e[5], e[9], e[13]),
            (e[2], e[6], e[10], e[14]),
            (e[3], e[7], e[11], e[15]),
        )
    )


def _axis_gltf_to_blender():
    """
    glTF / Three.js (Y-up) → Blender (Z-up), Import-Richtung:
        (x, y, z)_gltf  →  (x, -z, y)_blender.
    Das ist die Inverse der Export-Formel aus io_scene_gltf2 (swizzle_yup_location:
    Blender→glTF mit (x, y, z) → (x, z, -y)). Der glTF-Importer wendet dieselbe
    Konvention auf die Wurzelknoten an; Placement/Kamera müssen sie in derselben
    Richtung nutzen, sonst liegt die Kamera unter dem Boden (leeres/falsches PNG).
    """
    return Matrix(
        (
            (1.0, 0.0, 0.0, 0.0),
            (0.0, 0.0, -1.0, 0.0),
            (0.0, 1.0, 0.0, 0.0),
            (0.0, 0.0, 0.0, 1.0),
        )
    )


def _basis_three_to_blender(M):
    """
    Objekt-Welt-Matrix Y-up (Three) → Z-up (Blender), Similarity:
        M_bl = C · M_th · C⁻¹.
    Die *lokale* Objekt-Basis swizzelt gemeinsam mit der Welt (der glTF-Importer dreht die
    Node-Transformationen genauso), daher wird beidseitig umgerechnet.
    """
    C = _axis_gltf_to_blender()
    return C @ M @ C.inverted()


def _camera_three_to_blender(M):
    """
    Kamera-Welt-Matrix Y-up (Three) → Z-up (Blender): NUR links mit C.
        M_cam_bl = C · M_cam_th.
    Begründung: die *lokalen* Kamera-Achsen (forward = -Z, up = +Y) sind in Three und Blender
    identisch; es dreht sich nur die Welt-Seite. Eine Similarity (C · M · C⁻¹) würde die
    Kamera um die X-Achse kippen (Roll) und Inhalte "verdreht" rendern.
    """
    C = _axis_gltf_to_blender()
    return C @ M


def _three_vec_to_blender(p):
    """Three-/glTF-Vektor → Blender-Welt (x, y, z) → (x, -z, y)."""
    C = _axis_gltf_to_blender()
    if isinstance(p, dict):
        v = Vector((float(p["x"]), float(p["y"]), float(p["z"]), 1.0))
    else:
        v = Vector((float(p.x), float(p.y), float(p.z), 1.0))
    w = C @ v
    return Vector((w.x, w.y, w.z))


def _apply_camera_showroom_lookat(job, cam_obj) -> bool:
    """
    Fallback wenn cameraMatrixWorld fehlt oder singulär: Orbit position/target (getCurrentView),
    Punkte per C-Swizzle, Blick (target - position), Roll via to_track_quat(-Z, Z).
    """
    cam = job.get("camera") or {}
    p, t = cam.get("position"), cam.get("target")
    if not isinstance(p, dict) or not isinstance(t, dict):
        return False
    try:
        pos = _three_vec_to_blender(p)
        tgt = _three_vec_to_blender(t)
    except (TypeError, ValueError, KeyError):
        return False
    d = tgt - pos
    if d.length < 1e-6:
        return False
    fwd = d.normalized()
    cam_obj.location = pos
    cam_obj.rotation_mode = "QUATERNION"
    cam_obj.rotation_quaternion = fwd.to_track_quat("-Z", "Z")
    return True


def _mat3_det(M):
    try:
        return abs(M.to_3x3().determinant())
    except Exception:
        return 0.0


def _product_bbox_world():
    """Welt-BBox aller Produkt-Meshes (ohne META_*-Helfer). None, wenn nichts vorhanden."""
    meshes = [
        o
        for o in bpy.context.scene.objects
        if o.type == "MESH" and not o.name.startswith("META_")
    ]
    if not meshes:
        return None
    mn = Vector((1e30, 1e30, 1e30))
    mx = Vector((-1e30, -1e30, -1e30))
    for o in meshes:
        for corner in o.bound_box:
            w = o.matrix_world @ Vector(corner)
            mn.x, mn.y, mn.z = min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)
            mx.x, mx.y, mx.z = max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)
    return (mn, mx)


def _combined_mesh_scene_center():
    """Mittelpunkt der Welt-Bounding-Box aller Meshes (ohne META_*), nach Placement."""
    bbox = _product_bbox_world()
    if bbox is None:
        return Vector((0.0, 0.0, 0.5))
    mn, mx = bbox
    if (mx - mn).length < 1e-8:
        return mn
    return (mn + mx) * 0.5


def _camera_world_view_dir(cam_obj):
    """Weltrichtung, in die die Blender-Kamera schaut (lokal -Z)."""
    rot = cam_obj.matrix_world.to_3x3()
    return (rot @ Vector((0.0, 0.0, -1.0))).normalized()


def _camera_matrix_points_at_scene(cam_obj, scene_center, min_dot=0.08):
    """True, wenn die Kamera grob auf die Modell-Region blickt (sonst oft leeres Bild)."""
    pos = cam_obj.matrix_world.translation
    to = scene_center - pos
    if to.length < 1e-8:
        return False
    return _camera_world_view_dir(cam_obj).dot(to.normalized()) >= min_dot


def _argv_after_dd():
    if "--" not in sys.argv:
        return []
    return sys.argv[sys.argv.index("--") + 1 :]


def _hex_to_rgb01(h):
    s = (h or "").strip().lstrip("#")
    if len(s) == 6:
        return tuple(int(s[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (0.85, 0.85, 0.85)


def _is_verzinkt(job):
    """Entscheidet, ob die Oberfläche metallisch (verzinkt) oder matt (pulverbeschichtet) wird.

    Regel: **Der RAL-Code hat Priorität.** Wählt der User eine konkrete RAL-Farbe, ist das
    implizit Pulverbeschichtung – auch wenn das Produkt als Default verzinkt ist. Nur RAL 9007
    bedeutet wirklich verzinkt. Das deckt sich mit dem Bake-Pipeline-Verhalten
    (`register-converted`), das bei RAL 7035 explizit „Oberfläche: pulver" loggt.

    `surfaceFinish` wirkt nur noch als Fallback, wenn kein RAL-Code gesetzt ist.
    """
    ral = str(job.get("ralCode") or "").upper().replace(" ", "").lstrip("RAL")
    if ral:
        return ral == "9007"
    sf = str(job.get("surfaceFinish") or "").lower().strip()
    return sf == "verzinkt"


def _clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for m in list(bpy.data.materials):
        bpy.data.materials.remove(m, do_unlink=True)


def _import_glb(path):
    bpy.ops.import_scene.gltf(filepath=path)


def _link_all_collections_to_scene():
    """glTF legt oft eigene Collections an – sicherstellen, dass sie in der Szene gerendert werden."""
    root = bpy.context.scene.collection
    for col in list(bpy.data.collections):
        if col is root:
            continue
        try:
            if col.name not in [c.name for c in root.children]:
                root.children.link(col)
        except RuntimeError:
            pass


def _all_mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def _scene_top_level_roots():
    """Top-Level-Objekte der Szene (ohne spätere META_*-Hilfsobjekte, ohne Lichter)."""
    roots = []
    for o in bpy.context.scene.objects:
        if o.parent is not None:
            continue
        if o.name.startswith("META_"):
            continue
        if o.type == "LIGHT":
            continue
        roots.append(o)
    return roots


def _apply_showroom_placement(job):
    """
    Wendet die Showroom-Placement-matrixWorld (Three) auf die glTF-Root(s) an.
    Ohne das steht das Modell in Blender nur in Datei-Koordinaten, Kamera aber in Showroom-Welt.
    """
    flat = job.get("placementMatrixWorld")
    if not flat or len(flat) != 16:
        print("[blender_render] placement: keine placementMatrixWorld übergeben", file=sys.stderr)
        return
    M_th = _three_col16_to_matrix(flat)
    M_place = _basis_three_to_blender(M_th)
    if _mat3_det(M_place) < 1e-12:
        print("[blender_render] placement: singuläre Matrix, überspringe", file=sys.stderr)
        return
    roots = _scene_top_level_roots()
    for r in roots:
        r.matrix_world = M_place @ r.matrix_world
    bpy.context.view_layer.update()
    try:
        t = M_place.to_translation()
        print(
            f"[blender_render] placement angewandt: translation=({t.x:.3f},{t.y:.3f},{t.z:.3f}), "
            f"roots={len(roots)}",
            file=sys.stderr,
        )
    except Exception:
        pass


def _set_principled_opaque_product(bsdf, rgb, metallic, roughness):
    """Principled deckend halten (Blender 3/4/5 — unterschiedliche Socket-Namen)."""
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    for sock_name, val in (
        ("Alpha", 1.0),
        ("Transmission Weight", 0.0),
        ("Transmission", 0.0),
    ):
        inp = bsdf.inputs.get(sock_name)
        if inp is None:
            continue
        try:
            inp.default_value = val
        except (TypeError, ValueError, AttributeError):
            try:
                w = float(val)
                inp.default_value = (w, w, w, 1.0)
            except Exception:
                pass


def _cycles_film_transparency_guards(scene):
    """Ohne das kann Cycles bei film_transparent alles „glasig“/durchsichtig rendern."""
    if str(getattr(scene.render, "engine", "")).upper() != "CYCLES":
        return
    for holder in (getattr(scene, "cycles", None), scene.render):
        if holder is None:
            continue
        for attr in ("film_transparent_glass", "use_transparent_glass"):
            if hasattr(holder, attr):
                try:
                    setattr(holder, attr, False)
                except Exception:
                    pass


def _cycles_shadow_catcher_view_layer(scene, job):
    """
    Shadow-Catcher-Pass aktivieren: Boden nur Schatten, kein opaker Grau-Teppich
    (mit film_transparent + is_shadow_catcher).
    """
    if not job.get("shadowCatcher"):
        return
    if str(getattr(scene.render, "engine", "")).upper() != "CYCLES":
        return
    vl = getattr(bpy.context, "view_layer", None)
    if vl is None:
        return
    cyc = getattr(vl, "cycles", None)
    if cyc is None:
        return
    ok = False
    if hasattr(cyc, "use_pass_shadow_catcher"):
        try:
            cyc.use_pass_shadow_catcher = True
            ok = True
        except Exception:
            pass
    print(
        f"[blender_render] Shadow Catcher ViewLayer-Pass aktiv={ok}, "
        f"engine={scene.render.engine}, film_transparent={scene.render.film_transparent}",
        file=sys.stderr,
    )


def _log_glb_material_stats():
    """Diagnose: Metallic/Roughness-Verteilung der importierten GLB-Materialien."""
    stats = []
    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                try:
                    m = float(node.inputs["Metallic"].default_value) if "Metallic" in node.inputs else -1.0
                    r = float(node.inputs["Roughness"].default_value) if "Roughness" in node.inputs else -1.0
                    bc = node.inputs["Base Color"].default_value if "Base Color" in node.inputs else None
                    bc_t = (
                        f"({bc[0]:.2f},{bc[1]:.2f},{bc[2]:.2f})" if bc is not None else "n/a"
                    )
                    stats.append((mat.name, m, r, bc_t))
                except Exception:
                    pass
                break
    if not stats:
        return
    n_metallic = sum(1 for _, m, _, _ in stats if m >= 0.3)
    n_matt = sum(1 for _, m, _, _ in stats if 0.0 <= m < 0.3)
    sample = stats[:3]
    print(
        f"[blender_render] GLB-Materialien importiert: total={len(stats)}, "
        f"metallic≥0.3={n_metallic}, metallic<0.3={n_matt}; "
        f"Beispiele: "
        + "; ".join([f"{n}[m={m:.2f},r={r:.2f},bc={bc}]" for n, m, r, bc in sample]),
        file=sys.stderr,
    )


def _normalize_glb_materials_for_surface(job):
    """Passt die GLB-Originalmaterialien an die gewählte Oberfläche (Pulver vs. Verzinkt) an.

    Wird nur aktiv, wenn ``usesGlbOriginalColors=true`` gesetzt ist – in diesem Fall bleibt
    die Base Color aus dem GLB erhalten (korrekt, weil dort bereits die Default-RAL-Farbe
    eingebrannt wurde), aber Metallic/Roughness werden an die Pulver/Verzinkt-Entscheidung
    angeglichen. Sonst entsteht das Problem, dass Three.js (Showroom) die gebackenen
    Metallic-Werte optisch schluckt, Cycles sie aber als volle Spiegelreflexion rendert –
    und das Regal plötzlich verzinkt statt pulverbeschichtet aussieht.

    Heuristik: Material-Name oder Mesh-Name enthält "verzinkt"/"9007" → verzinkt (unverändert).
    Alle anderen Principled-BSDFs werden als Pulver normalisiert.
    """
    if not job.get("usesGlbOriginalColors"):
        return
    # Wenn auch der Job als verzinkt gilt, gibt's nichts zu tun – ganzes Produkt soll metallisch sein.
    if _is_verzinkt(job):
        return

    pulver_m = 0.0
    pulver_r = 0.45
    metal_m = 0.75
    metal_r = 0.25

    changed_pulver = 0
    changed_metal = 0
    unchanged = 0
    for mat in bpy.data.materials:
        if not mat.use_nodes or not mat.node_tree:
            continue
        name_lc = mat.name.lower()
        is_metal_material = ("verzinkt" in name_lc) or ("9007" in name_lc)
        for node in mat.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            try:
                if is_metal_material:
                    if "Metallic" in node.inputs:
                        node.inputs["Metallic"].default_value = metal_m
                    if "Roughness" in node.inputs:
                        node.inputs["Roughness"].default_value = metal_r
                    changed_metal += 1
                else:
                    if "Metallic" in node.inputs:
                        node.inputs["Metallic"].default_value = pulver_m
                    if "Roughness" in node.inputs:
                        node.inputs["Roughness"].default_value = pulver_r
                    changed_pulver += 1
            except Exception:
                unchanged += 1
            break

    print(
        f"[blender_render] GLB-Materialien normalisiert: pulver={changed_pulver} "
        f"(metallic→{pulver_m}, roughness→{pulver_r}), verzinkt={changed_metal} "
        f"(metallic→{metal_m}, roughness→{metal_r}), übersprungen={unchanged}. "
        f"Grund: ralCode='{job.get('ralCode') or ''}' (≠9007) – GLB-Materialien als "
        f"Pulverbeschichtung rendern.",
        file=sys.stderr,
    )


def _apply_ral_material(job):
    if job.get("usesGlbOriginalColors"):
        _log_glb_material_stats()
        _normalize_glb_materials_for_surface(job)
        return
    hex_s = job.get("hex") or "#D7D7D7"
    rgb = _hex_to_rgb01(hex_s)
    verz = _is_verzinkt(job)
    metallic = 0.75 if verz else 0.0
    roughness = 0.25 if verz else 0.35
    mat_name = "META_Showroom_RAL"
    mat = bpy.data.materials.get(mat_name)
    if mat is None:
        mat = bpy.data.materials.new(mat_name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (0, 0)
    out.location = (300, 0)
    _set_principled_opaque_product(bsdf, rgb, metallic, roughness)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    applied = 0
    for obj in _all_mesh_objects():
        if len(obj.data.materials) == 0:
            obj.data.materials.append(mat)
        else:
            for i in range(len(obj.data.materials)):
                obj.data.materials[i] = mat
        applied += 1

    # Diagnose: hex, RAL-Code, surfaceFinish und die daraus abgeleitete Pulver/Verzinkt-Entscheidung
    # sichtbar machen. Ohne dieses Log ist nicht erkennbar, warum das Produkt „verzinkt" aussieht,
    # wenn der User z. B. RAL 7035 gewählt hat und das Produkt-Default surfaceFinish=verzinkt ist.
    print(
        f"[blender_render] RAL-Material: hex={hex_s}, rgb=({rgb[0]:.3f},{rgb[1]:.3f},{rgb[2]:.3f}), "
        f"ralCode='{job.get('ralCode') or ''}', surfaceFinish='{job.get('surfaceFinish') or ''}', "
        f"verzinkt={verz}, metallic={metallic}, roughness={roughness}, meshes={applied}",
        file=sys.stderr,
    )


def _setup_camera(job):
    cam_data = bpy.data.cameras.new("META_Cam")
    cam_obj = bpy.data.objects.new("META_Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    chosen = "default"
    flat = job.get("cameraMatrixWorld")
    if flat and len(flat) == 16:
        M_th = _three_col16_to_matrix(flat)
        try:
            _loc, _rot, sca = M_th.decompose()
            if min(float(sca.x), float(sca.y), float(sca.z)) < 1e-8:
                M_th = None
        except Exception:
            pass
        if M_th is not None:
            M_cam = _camera_three_to_blender(M_th)
            if _mat3_det(M_cam) >= _CAM_MATRIX_DET_MIN:
                cam_obj.matrix_world = M_cam
                bpy.context.view_layer.update()
                focus = _combined_mesh_scene_center()
                if _camera_matrix_points_at_scene(cam_obj, focus):
                    chosen = "cameraMatrixWorld"
                else:
                    print(
                        "[blender_render] cameraMatrixWorld blickt nicht auf Szene — "
                        f"BBox-Zentrum={tuple(round(v, 3) for v in focus)}, "
                        f"Kamera-Pos={tuple(round(v, 3) for v in M_cam.to_translation())} "
                        "— Fallback auf Orbit position/target.",
                        file=sys.stderr,
                    )
    if chosen == "default":
        if _apply_camera_showroom_lookat(job, cam_obj):
            chosen = "lookat"
        else:
            cam_obj.location = _three_vec_to_blender({"x": 0.0, "y": 2.0, "z": 6.0})
            cam_obj.rotation_mode = "QUATERNION"
            d = _three_vec_to_blender({"x": 0.0, "y": 1.0, "z": 0.0}) - cam_obj.location
            if d.length > 1e-6:
                cam_obj.rotation_quaternion = d.normalized().to_track_quat("-Z", "Z")
    bpy.context.view_layer.update()
    try:
        pos = cam_obj.matrix_world.translation
        fwd = _camera_world_view_dir(cam_obj)
        print(
            f"[blender_render] Kamera-Quelle={chosen}, "
            f"pos=({pos.x:.3f},{pos.y:.3f},{pos.z:.3f}), "
            f"view=({fwd.x:.3f},{fwd.y:.3f},{fwd.z:.3f})",
            file=sys.stderr,
        )
    except Exception:
        pass

    cam_data.type = "PERSP"
    cam_data.sensor_fit = "VERTICAL"
    cam_data.sensor_height = 24.0
    fov_deg = job.get("fovDeg")
    if fov_deg is not None and math.isfinite(float(fov_deg)) and float(fov_deg) > 0.1:
        v = math.radians(float(fov_deg))
        cam_data.lens = (cam_data.sensor_height / 2.0) / math.tan(v / 2.0)
    else:
        cam = job.get("camera") or {}
        cam_data.lens = float(cam.get("focalLength") or 50)

    near = job.get("near")
    far = job.get("far")
    if near is None or not math.isfinite(float(near)):
        near = (job.get("camera") or {}).get("near")
    if far is None or not math.isfinite(float(far)):
        far = (job.get("camera") or {}).get("far")
    cam_data.clip_start = max(0.001, float(near) if near is not None and math.isfinite(float(near)) else 0.1)
    cam_data.clip_end = min(100000.0, float(far) if far is not None and math.isfinite(float(far)) else 10000.0)

    bpy.context.view_layer.update()


def _setup_lights(job=None):
    """
    Key-Sun mit klarer Richtung + reduziertes Fill — damit Shadow Catcher wirklich Schatten
    zeigt. Zu starkes Fill/Area überdeckt die Sun-Schatten auf der Plane und der
    Schattenfänger bleibt (fast) unsichtbar.

    Bei `shadowCatcher=True` wird das Verhältnis Key:Fill:Area deutlicher geöffnet (Sun stärker,
    Fill/Area gedämpft), damit der Schatten auf der Plane klar sichtbar ist. Zusätzlich kann der
    Job-Hebel `shadowStrength` (Default 1.0) die Key-Sun proportional skalieren – ideal zum
    Nachschärfen/Abschwächen pro Render, ohne den Default-Look normaler (nicht-Catcher-)Renders
    zu verändern.

    Koordinaten: die Lichter werden in Blender-Welt (Z-up) gesetzt – unabhängig von der
    Y-up/Z-up-Umrechnung für GLB/Kamera (die erfolgt in _axis_gltf_to_blender usw.).
    """
    sc = bool((job or {}).get("shadowCatcher"))
    strength_boost = float((job or {}).get("shadowStrength", 1.0))
    # softness skaliert Penumbra-Breite (Sun-Angle) und Area-Größe gleichzeitig;
    # 1.0 = aktuelle Defaults, >1.0 = weicher, <1.0 = härter.
    softness = max(0.1, float((job or {}).get("softness", 1.0)))

    # Kalibrierung für den jeweiligen Color-Management-Pfad:
    # - Shadow-Catcher-Render läuft per Default unter view_transform="Standard" (1:1 linear→sRGB).
    #   Ohne Rolloff clippt jeder Scene-Linear-Wert > 1.0 hart auf Display-Weiß. Lichter müssen
    #   deshalb realistischer sein: Sun ≈ 3.0 W/m², Fill ≈ 0.30, Area ≈ 25 W, HDRI ≈ 0.5.
    # - Normal-Render läuft unter AgX, das hohe Werte komprimiert. Hier bleiben die höheren
    #   Werte, damit das Bild nicht flau wirkt.
    sun_energy = (3.0 if sc else 4.0) * max(0.0, strength_boost)
    # Sun-Halbwinkel steuert die Härte der Eigenschatten am Produkt. 0.18 rad ≈ 10.3°
    # erzeugt weiche Übergänge am Modell. Der Catcher-Schatten am Boden bleibt trotz Penumbra
    # dank Alpha-Boost im Compositor sichtbar.
    sun_angle = (0.18 if sc else 0.06) * softness
    # Fill deutlich kräftiger → Schattenseite wird angehoben, harte Tonabrisse schwächen sich ab.
    fill_energy = 0.40 if sc else 0.35
    # Area-Gesamtenergie bleibt gleich; Größe vergrößert = weicheres Hauptlicht aus Kamerarichtung.
    area_energy = 25.0 if sc else 80.0
    area_w = (10.0 if sc else 6.0) * softness
    area_h = (7.5 if sc else 4.0) * softness

    # Overrides pro Job (alle optional, überschreiben die Defaults oben).
    if (job or {}).get("sunAngle") is not None:
        sun_angle = max(0.0, float(job["sunAngle"]))
    if (job or {}).get("fillEnergy") is not None:
        fill_energy = max(0.0, float(job["fillEnergy"]))
    if (job or {}).get("areaEnergy") is not None:
        area_energy = max(0.0, float(job["areaEnergy"]))
    if (job or {}).get("areaSize") is not None:
        # Skalar: quadratische Größe; Verhältnis 4:3 bleibt erhalten.
        s = max(0.5, float(job["areaSize"]))
        area_w = s
        area_h = s * 0.75

    bpy.ops.object.light_add(type="SUN", location=(4.0, 6.0, 8.0))
    sun = bpy.context.object
    sun.data.energy = sun_energy
    if hasattr(sun.data, "angle"):
        sun.data.angle = sun_angle
    sun.rotation_euler = (0.65, 0.0, 0.9)

    bpy.ops.object.light_add(type="SUN", location=(-6.0, 2.0, 4.0))
    fill = bpy.context.object
    fill.data.energy = fill_energy
    if hasattr(fill.data, "angle"):
        fill.data.angle = 0.25
    fill.rotation_euler = (1.0, 0.0, -0.8)

    bpy.ops.object.light_add(type="AREA", location=(0.0, 5.0, 3.5))
    area = bpy.context.object
    area.data.shape = "RECTANGLE"
    area.data.size = area_w
    area.data.size_y = area_h
    area.data.energy = area_energy
    area.rotation_euler = (1.2, 0.0, 0.0)

    print(
        f"[blender_render] Lights: shadowCatcher={sc}, shadowStrength={strength_boost:.2f}, "
        f"softness={softness:.2f}, sun.energy={sun_energy:.2f}, sun.angle={sun_angle:.3f}, "
        f"fill.energy={fill_energy:.2f}, area.energy={area_energy:.2f}, "
        f"area.size={area_w:.1f}x{area_h:.1f}",
        file=sys.stderr,
    )


def _setup_world_simple():
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("META_World")
        bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (0.92, 0.92, 0.94, 1.0)
    bg.inputs["Strength"].default_value = 0.35
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def _setup_world_hdri(path, strength=0.8):
    if not path or not os.path.isfile(path):
        _setup_world_simple()
        return
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("META_World")
        bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexEnvironment")
    try:
        img = bpy.data.images.load(path, check_existing=True)
        tex.image = img
    except Exception:
        _setup_world_simple()
        return
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = float(strength)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(tex.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def _shadow_catcher_plane_material():
    """
    Kein deckendes Principled — nur ein neutraler Diffuse-Receiver für Cycles.
    Sichtbarkeit des Bodens steuert Object.is_shadow_catcher + View-Layer-Pass + film_transparent.
    """
    mat = bpy.data.materials.new("META_ShadowCatcher")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diff.location = (0, 0)
    out.location = (260, 0)
    diff.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    diff.inputs["Roughness"].default_value = 1.0
    nt.links.new(diff.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _set_shadow_catcher_flag(plane) -> bool:
    """
    Robustes Setzen: Blender 4.x hat `Object.is_shadow_catcher`, ältere Versionen
    nur `Object.cycles.is_shadow_catcher`. Beide Wege versuchen.
    """
    flag_ok = False
    if hasattr(plane, "is_shadow_catcher"):
        try:
            plane.is_shadow_catcher = True
            flag_ok = bool(plane.is_shadow_catcher)
        except Exception:
            flag_ok = False
    if not flag_ok and hasattr(plane, "cycles"):
        try:
            plane.cycles.is_shadow_catcher = True
            flag_ok = bool(plane.cycles.is_shadow_catcher)
        except Exception:
            pass
    return flag_ok


def _shadow_catcher_plane(job):
    if not job.get("shadowCatcher"):
        return
    # Plane exakt auf dem Produkt-Boden (min.z der Produkt-BBox) ankern, nicht fix z=0.
    # Hintergrund: GLBs werden nach Y-up→Z-up-Normalisierung zwar meist mit Boden≈0 geladen,
    # aber nicht garantiert – ein Produkt mit z_min=0.12 schwebt sonst 12 cm über dem Catcher
    # und der Schatten "schwebt" mit. Wir legen die Plane 0.5 mm unter den Produktboden:
    # nahe genug für einen sauberen Kontakt-Schatten, weit genug weg für kein Z-Fighting.
    bbox = _product_bbox_world()
    ground_z = float(bbox[0].z) if bbox is not None else 0.0
    plane_z = ground_z - 5e-4

    bpy.ops.mesh.primitive_plane_add(size=200.0, location=(0.0, 0.0, plane_z))
    plane = bpy.context.object
    plane.name = "META_ShadowPlane"
    plane.rotation_euler = (0.0, 0.0, 0.0)
    mat = _shadow_catcher_plane_material()
    plane.data.materials.append(mat)

    flag_ok = _set_shadow_catcher_flag(plane)

    # Sicherheitsnetz: Holdout macht das Pixel komplett alpha-clear (kein Schatten sichtbar).
    # Nur der Shadow-Catcher-Flag darf aktiv sein.
    if hasattr(plane, "is_holdout"):
        try:
            plane.is_holdout = False
        except Exception:
            pass

    # Cycles-Ray-Visibility: Plane muss für Sun/HDRI Schattenstrahlen empfangen und diffuse
    # Lichtwege sehen, sonst bleibt sie im Ergebnis komplett leer.
    for attr in (
        "visible_camera",
        "visible_diffuse",
        "visible_glossy",
        "visible_transmission",
        "visible_volume_scatter",
        "visible_shadow",
    ):
        if hasattr(plane, attr):
            try:
                setattr(plane, attr, True)
            except Exception:
                pass

    plane.hide_render = False
    plane.hide_viewport = False

    bpy.context.view_layer.update()

    scene = bpy.context.scene
    print(
        f"[blender_render] Shadow Catcher gesetzt: is_shadow_catcher={flag_ok}, "
        f"is_holdout={getattr(plane, 'is_holdout', 'n/a')}, "
        f"plane={plane.name}, size=200m, ground_z={ground_z:.4f}, plane_z={plane_z:.4f}, "
        f"engine={scene.render.engine}, "
        f"cycles_device={getattr(scene.cycles, 'device', 'n/a')}, "
        f"film_transparent={scene.render.film_transparent}, "
        f"color_mode={scene.render.image_settings.color_mode}",
        file=sys.stderr,
    )




def _enable_cycles_gpu():
    """Aktiviert GPU-Rendering für Cycles.

    Probiert plattformspezifisch passende compute_device_types durch (z. B. METAL
    auf macOS, OPTIX/CUDA auf Windows, OPTIX/CUDA/HIP auf Linux) und aktiviert
    alle nicht-CPU-Devices. Gibt True zurück, wenn mindestens ein GPU-Device
    aktiv ist; sonst False (Aufrufer sollte dann auf CPU zurückfallen).
    """
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception as e:
        print(f"[blender_render] Cycles-Preferences nicht verfügbar: {e}", file=sys.stderr)
        return False

    import sys as _sys

    if _sys.platform == "darwin":
        candidates = ["METAL"]
    elif _sys.platform == "win32":
        candidates = ["OPTIX", "CUDA", "HIP", "ONEAPI"]
    else:
        candidates = ["OPTIX", "CUDA", "HIP", "ONEAPI"]

    for dev_type in candidates:
        try:
            prefs.compute_device_type = dev_type
        except TypeError:
            continue
        except Exception as e:
            print(f"[blender_render] compute_device_type={dev_type} nicht setzbar: {e}", file=sys.stderr)
            continue

        try:
            prefs.get_devices()
        except Exception:
            pass

        gpu_devices = [d for d in prefs.devices if str(getattr(d, "type", "")).upper() != "CPU"]
        if not gpu_devices:
            continue

        for d in prefs.devices:
            d.use = str(getattr(d, "type", "")).upper() != "CPU"

        active = [d.name for d in gpu_devices if getattr(d, "use", False)]
        print(
            f"[blender_render] Cycles GPU aktiv: type={dev_type}, devices={active}",
            file=sys.stderr,
        )
        return True

    print("[blender_render] Keine GPU-Devices gefunden – Fallback auf CPU.", file=sys.stderr)
    return False


def _set_render_engine(job):
    eng = str(job.get("engine") or "eevee").lower()
    scene = bpy.context.scene
    if eng == "cycles":
        scene.render.engine = "CYCLES"
        scene.cycles.samples = int(job.get("cyclesSamples") or 512)
        scene.cycles.use_adaptive_sampling = True
        # Default: GPU (mit sauberem CPU-Fallback). Opt-out per Job: cyclesDevice="CPU".
        use_gpu = str(job.get("cyclesDevice") or "GPU").upper() != "CPU"
        if use_gpu and _enable_cycles_gpu():
            scene.cycles.device = "GPU"
        else:
            scene.cycles.device = "CPU"

        # Schärferer, produkt-tauglicher Look: OIDN Accurate statt Fast – sonst glättet der
        # Denoiser feine Mesh-Details (Lochreihen etc.). filter_width=1.0 statt Default 1.5
        # gibt knackigere Kanten ohne Blackman-Harris-Weichzeichnung.
        try:
            scene.cycles.use_denoising = True
        except Exception:
            pass
        for attr, val in (
            ("denoiser", "OPENIMAGEDENOISE"),
            ("denoising_prefilter", "ACCURATE"),
            ("denoising_input_passes", "RGB_ALBEDO_NORMAL"),
        ):
            if hasattr(scene.cycles, attr):
                try:
                    setattr(scene.cycles, attr, val)
                except Exception:
                    pass
        try:
            scene.render.filter_size = float(job.get("filterSize", 1.0))
        except Exception:
            pass

        print(
            f"[blender_render] Cycles-Qualität: samples={scene.cycles.samples}, "
            f"denoiser={getattr(scene.cycles, 'denoiser', 'n/a')}, "
            f"denoising_prefilter={getattr(scene.cycles, 'denoising_prefilter', 'n/a')}, "
            f"filter_size={scene.render.filter_size}",
            file=sys.stderr,
        )
    else:
        # Eevee Next (Blender 4.2+) oder Fallback
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except Exception:
            scene.render.engine = "BLENDER_EEVEE"
        evs = int(job.get("eeveeSamples") or 64)
        if hasattr(scene.eevee, "taa_render_samples"):
            scene.eevee.taa_render_samples = evs
        elif hasattr(scene.eevee, "taa_samples"):
            scene.eevee.taa_samples = evs


def _apply_color_management(scene, job):
    """
    Setzt sinnvolle Defaults für Display- & View-Transform. Hintergrund: Blender 4.x verwendet
    per Default AgX. AgX ist ein kompressives Tonemapping (Scene-Linear 1.0 → ~88 % Display) –
    ideal für fotorealistische Szenen, aber beim Shadow-Catcher-Render macht es zwei Probleme:
      1) Weißer Compositor-Hintergrund (Scene-Linear 1.0) erscheint als hellgrau statt weiß.
      2) Schatten-Kontrast auf der Catcher-Plane wird so stark komprimiert, dass der Schatten
         visuell fast verschwindet.

    Deshalb wählen wir zwei Default-Profile:
      - Normal-Render:       view_transform="AgX",      look="AgX - Punchy", exposure=0.3
      - Shadow-Catcher:      view_transform="Standard", look="None",         exposure=0.0

    Das Shadow-Catcher-Profil liefert ein 1:1 Scene→sRGB Mapping → Weiß bleibt Weiß, Schatten
    bleibt kontrastreich. Jedes Feld ist per Job überschreibbar:
      - job["viewTransform"], job["look"], job["exposure"], job["gamma"]
    """
    try:
        ds = scene.display_settings
        vs = scene.view_settings
    except Exception as e:
        print(f"[blender_render] Color Management nicht verfügbar: {e}", file=sys.stderr)
        return

    try:
        ds.display_device = "sRGB"
    except Exception:
        pass

    def _try_set(prop, candidates):
        for val in candidates:
            try:
                setattr(vs, prop, val)
                if getattr(vs, prop) == val:
                    return val
            except Exception:
                continue
        return None

    sc = bool(job.get("shadowCatcher"))

    req_view = str(job.get("viewTransform") or "").strip()
    if not req_view:
        req_view = "Standard" if sc else "AgX"
    view_candidates = [req_view, "AgX", "Filmic", "Standard"]
    view_used = _try_set("view_transform", [v for v in view_candidates if v])

    req_look = str(job.get("look") or "").strip()
    if not req_look:
        # Default-Look passend zur gewählten View-Transform.
        if view_used == "AgX":
            req_look = "AgX - Punchy"
        elif view_used == "Filmic":
            req_look = "Medium High Contrast"
        else:
            # "Standard" absichtlich ohne Extra-Kontrastkurve – sonst würden Schatten/Highlights
            # auf dem weißen Hintergrund durch den Look wieder ausgefressen.
            req_look = "None"
    look_candidates = [
        req_look,
        "AgX - Punchy",
        "AgX - Medium High Contrast",
        "Medium High Contrast",
        "High Contrast",
        "None",
    ]
    _try_set("look", [v for v in look_candidates if v])

    # Exposure: Bei Standard/Catcher = 0.0, bei AgX-Default = 0.3 (leichter Boost).
    default_exposure = 0.0 if view_used == "Standard" else 0.3
    try:
        vs.exposure = float(job.get("exposure", default_exposure))
    except Exception:
        pass
    try:
        vs.gamma = float(job.get("gamma", 1.0))
    except Exception:
        pass

    print(
        f"[blender_render] Color Management: view_transform={getattr(vs, 'view_transform', '?')}, "
        f"look={getattr(vs, 'look', '?')}, exposure={getattr(vs, 'exposure', '?')}, "
        f"gamma={getattr(vs, 'gamma', '?')}, display={getattr(ds, 'display_device', '?')}, "
        f"shadowCatcher={sc}",
        file=sys.stderr,
    )


def _render_settings(job):
    scene = bpy.context.scene
    w = int(job.get("resolution", {}).get("width") or 1920)
    h = int(job.get("resolution", {}).get("height") or 1080)
    scene.render.resolution_x = max(64, min(8192, w))
    scene.render.resolution_y = max(64, min(8192, h))
    scene.render.resolution_percentage = 100

    fmt = str(job.get("format") or "png").lower()
    is_jpeg = fmt in ("jpg", "jpeg")

    # Schattenfänger: transparenter Film nötig, sonst bleibt die Boden-Fläche im PNG sichtbar.
    # Für JPG behalten wir film_transparent=True bei, damit der Compositor den Alpha weich auf
    # den weißen Hintergrund blenden kann (Schatten bleiben erhalten).
    film_transparent = bool(job.get("transparentBackground"))
    if job.get("shadowCatcher"):
        film_transparent = True
    scene.render.film_transparent = film_transparent

    # Shadow-Boost nur bei aktivem Catcher anwenden (verstärkt schwache Alpha-Pixel → sichtbarer
    # Boden-Schatten auf weiß). Default 2.5 hat sich als guter Mittelwert bewährt; per Job-Param
    # "shadowBoost" überschreibbar. Ohne Catcher bleibt er auf 1.0, damit Transparenzen nicht
    # künstlich aufgebläht werden.
    if bool(job.get("shadowCatcher")):
        shadow_boost = float(job.get("shadowBoost", 2.5))
    else:
        shadow_boost = 1.0

    if is_jpeg:
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.quality = int(job.get("jpegQuality") or 92)
        # Compositor baut weißen Hintergrund unter den Alpha-Output (inkl. Shadow-Catcher-Alpha).
        _compose_on_solid_background(scene, color=(1.0, 1.0, 1.0, 1.0), shadow_boost=shadow_boost)
        print(
            f"[blender_render] JPEG-Output aktiv: quality={scene.render.image_settings.quality}, "
            f"film_transparent={scene.render.film_transparent}, composite_bg=weiß, "
            f"shadow_boost={shadow_boost:.2f}",
            file=sys.stderr,
        )
    else:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA" if scene.render.film_transparent else "RGB"
        scene.render.image_settings.color_depth = "8"
        # Bei aktivem Shadow-Catcher auch für PNG den Alpha-Output über einen weichen Weiß-BG
        # compositen, damit der Schatten im RGB sichtbar bleibt (Preview-Viewer mit dunklem
        # Theme zeigt sonst den Alpha-Schatten gegen Schwarz = unsichtbar). Die PNG bleibt RGBA,
        # weil Composite-Node den Alpha mitschreibt, aber jetzt mit einem weiß unterlegten RGB.
        if bool(job.get("shadowCatcher")):
            _compose_on_solid_background(scene, color=(1.0, 1.0, 1.0, 1.0), shadow_boost=shadow_boost)
        else:
            _reset_compositor(scene)


def _reset_compositor(scene):
    """Setzt den Szene-Compositor auf Pass-Through zurück (oder deaktiviert ihn)."""
    try:
        scene.use_nodes = False
        if scene.node_tree is not None:
            scene.node_tree.nodes.clear()
    except Exception:
        pass


def _debug_dump_render_state(scene, job):
    """
    Vollständiger State-Dump direkt vor bpy.ops.render.render(). Loggt die tatsächlich
    aktiven Render-, Compositor- und Shadow-Catcher-Settings – egal was der Client im Job
    wollte. Hilft die Diskrepanz "Client sagt X, Render produziert Y" aufzulösen.
    """
    try:
        sc_job = bool(job.get("shadowCatcher"))
        r = scene.render
        ims = r.image_settings

        planes = [o for o in scene.objects if o.name.startswith("META_ShadowPlane")]
        plane_info = "none"
        if planes:
            p = planes[0]
            is_sc = bool(getattr(p, "is_shadow_catcher", False))
            if not is_sc and hasattr(p, "cycles"):
                is_sc = bool(getattr(p.cycles, "is_shadow_catcher", False))
            plane_info = (
                f"{p.name}@z={p.location.z:.4f}, is_shadow_catcher={is_sc}, "
                f"is_holdout={getattr(p, 'is_holdout', 'n/a')}, "
                f"hide_render={p.hide_render}, visible_camera={getattr(p, 'visible_camera', 'n/a')}"
            )

        nt = scene.node_tree if scene.use_nodes else None
        node_names = [n.bl_idname for n in (nt.nodes if nt else [])]

        world = scene.world
        world_strength = "n/a"
        if world and world.use_nodes and world.node_tree is not None:
            for n in world.node_tree.nodes:
                if n.bl_idname == "ShaderNodeBackground":
                    try:
                        world_strength = f"{n.inputs['Strength'].default_value:.3f}"
                    except Exception:
                        pass
                    break

        print(
            "[blender_render] === RENDER STATE DUMP ===\n"
            f"  engine              = {r.engine}\n"
            f"  cycles.device       = {getattr(scene.cycles, 'device', 'n/a')}\n"
            f"  cycles.samples      = {getattr(scene.cycles, 'samples', 'n/a')}\n"
            f"  film_transparent    = {r.film_transparent}\n"
            f"  file_format         = {ims.file_format}\n"
            f"  color_mode          = {ims.color_mode}\n"
            f"  resolution          = {r.resolution_x}x{r.resolution_y}\n"
            f"  view_transform      = {scene.view_settings.view_transform}\n"
            f"  look                = {scene.view_settings.look}\n"
            f"  exposure            = {scene.view_settings.exposure:.3f}\n"
            f"  use_nodes           = {scene.use_nodes}\n"
            f"  compositor_nodes    = {node_names}\n"
            f"  world.bg.strength   = {world_strength}\n"
            f"  job.shadowCatcher   = {sc_job}\n"
            f"  shadow_plane        = {plane_info}\n"
            f"  filepath            = {r.filepath}",
            file=sys.stderr,
        )
    except Exception as e:
        print(f"[blender_render] debug dump failed: {e}", file=sys.stderr)


def _compose_on_solid_background(scene, color=(1.0, 1.0, 1.0, 1.0), shadow_boost=1.0):
    """
    Rendert über einen deckenden Hintergrund per Compositor:
        RGB(color) ─────────────────────────────▶ AlphaOver[1]
        RenderLayers.Image ──▶ SetAlpha ───────▶ AlphaOver[2] ─▶ Composite
        RenderLayers.Alpha ──▶ Math(×boost) ──▶ Math(min 1) ──▶ SetAlpha.Alpha

    Voraussetzung: scene.render.film_transparent = True, sonst hat der Render keinen Alpha.

    `shadow_boost` > 1.0 verstärkt den Alpha-Kanal linear und macht so auch subtile
    Shadow-Catcher-Schatten (z. B. Alpha=0.08) auf dem weißen Hintergrund sichtbar (0.08 × 2.5 = 0.20).
    Gedeckelt bei 1.0 → bereits deckende Schatten bleiben deckend. boost=1.0 = Originalverhalten.

    Hinweis: Der untere Hintergrund wird explizit als CompositorNodeRGB angelegt (nicht per
    default_value direkt am AlphaOver-Socket). In Blender 4.x kann die Socket-Zuweisung über
    default_value unzuverlässig sein, weil beide Image-Inputs denselben Namen tragen – ein
    separater RGB-Node umgeht das eindeutig.
    """
    scene.use_nodes = True
    nt = scene.node_tree
    nt.nodes.clear()

    rl = nt.nodes.new("CompositorNodeRLayers")
    rl.location = (-600, 0)

    bg = nt.nodes.new("CompositorNodeRGB")
    bg.location = (-600, -260)
    try:
        bg.outputs[0].default_value = tuple(color)
    except Exception:
        pass

    image_src = rl.outputs["Image"]
    if shadow_boost and shadow_boost > 1.0:
        # Alpha-Kanal verstärken: so werden schwache Catcher-Schatten (Alpha ~ 0.05–0.15)
        # auf dem weißen Hintergrund klar sichtbar.
        mult = nt.nodes.new("CompositorNodeMath")
        mult.location = (-340, -120)
        mult.operation = "MULTIPLY"
        mult.inputs[1].default_value = float(shadow_boost)

        clamp = nt.nodes.new("CompositorNodeMath")
        clamp.location = (-160, -120)
        clamp.operation = "MINIMUM"
        clamp.inputs[1].default_value = 1.0

        set_alpha = nt.nodes.new("CompositorNodeSetAlpha")
        set_alpha.location = (40, 0)
        if hasattr(set_alpha, "mode"):
            try:
                set_alpha.mode = "REPLACE_ALPHA"
            except Exception:
                pass

        nt.links.new(rl.outputs["Alpha"], mult.inputs[0])
        nt.links.new(mult.outputs[0], clamp.inputs[0])
        nt.links.new(rl.outputs["Image"], set_alpha.inputs["Image"])
        nt.links.new(clamp.outputs[0], set_alpha.inputs["Alpha"])
        image_src = set_alpha.outputs["Image"]

    ao = nt.nodes.new("CompositorNodeAlphaOver")
    ao.location = (240, -80)
    ao.use_premultiply = False
    ao.premul = 1.0
    try:
        ao.inputs[0].default_value = 1.0
    except Exception:
        pass

    comp = nt.nodes.new("CompositorNodeComposite")
    comp.location = (520, 0)
    comp.use_alpha = False

    nt.links.new(bg.outputs[0], ao.inputs[1])
    nt.links.new(image_src, ao.inputs[2])
    nt.links.new(ao.outputs["Image"], comp.inputs["Image"])

    print(
        f"[blender_render] Compositor: weiß-Hintergrund, shadow_boost={float(shadow_boost):.2f} "
        f"(1.0=neutral, >1.0 verstärkt subtile Schatten)",
        file=sys.stderr,
    )


def main():
    args = _argv_after_dd()
    if len(args) < 2:
        print(
            "usage: blender --background --python blender_render.py -- job.json out.png",
            file=sys.stderr,
        )
        return 1
    job_path, out_path = args[0], args[1]
    try:
        with open(job_path, "r", encoding="utf-8") as f:
            job = json.load(f)
    except Exception as e:
        print(f"[blender_render] job read failed: {e}", file=sys.stderr)
        return 2

    glb = job.get("glbAbs")
    if not glb or not os.path.isfile(glb):
        print(f"[blender_render] glb missing: {glb}", file=sys.stderr)
        return 3

    _clear_scene()
    try:
        _import_glb(glb)
    except Exception as e:
        print(f"[blender_render] gltf import failed: {e}", file=sys.stderr)
        return 4

    _link_all_collections_to_scene()

    _apply_showroom_placement(job)
    _apply_ral_material(job)

    meshes = [
        o for o in bpy.context.scene.objects
        if o.type == "MESH" and not o.name.startswith("META_")
    ]
    if not meshes:
        print(
            "[blender_render] WARNUNG: keine Meshes nach Import/Placement — "
            "Render wird sehr wahrscheinlich leer (nur Boden/Schatten).",
            file=sys.stderr,
        )
    else:
        c = _combined_mesh_scene_center()
        print(
            f"[blender_render] Meshes={len(meshes)}, BBox-Zentrum="
            f"({c.x:.3f},{c.y:.3f},{c.z:.3f})",
            file=sys.stderr,
        )

    _setup_camera(job)

    hdri = job.get("hdriAbs")
    # Bei aktivem Shadow-Catcher per Default deutlich schwächeres HDRI (0.35) – sonst überleuchtet
    # die Umgebung die Sun-Schatten auf der Plane und macht den Boden-Schatten unsichtbar.
    # Client kann das per hdriStrength überschreiben.
    default_hdri_strength = 0.35 if bool(job.get("shadowCatcher")) else 0.8
    hdri_strength = float(job.get("hdriStrength", default_hdri_strength))
    if hdri and os.path.isfile(hdri):
        _setup_world_hdri(hdri, strength=hdri_strength)
    else:
        _setup_world_simple()

    _setup_lights(job)

    # WICHTIG: Engine & Render-Settings BEVOR der Shadow-Catcher gebaut wird, sonst greift
    # Cycles' is_shadow_catcher-Mechanik nicht zuverlässig (Flag-Setter ist engine-sensitiv).
    if job.get("shadowCatcher") and str(job.get("engine") or "").lower() != "cycles":
        print(
            "[blender_render] shadowCatcher: Wechsel auf Cycles "
            "(Eevee: Boden oft opak / kein sauberer Schattenfänger).",
            file=sys.stderr,
        )
        job["engine"] = "cycles"

    _set_render_engine(job)
    _render_settings(job)
    _apply_color_management(bpy.context.scene, job)
    _cycles_film_transparency_guards(bpy.context.scene)

    _shadow_catcher_plane(job)
    _cycles_shadow_catcher_view_layer(bpy.context.scene, job)

    bpy.context.scene.render.filepath = out_path
    # Blender soll den Pfad unverändert nutzen (sonst würde es z. B. bei file_format=JPEG die
    # Endung ersetzen und "out.jpg" behalten, "out.png" aber in "out.png.jpg" umschreiben).
    bpy.context.scene.render.use_file_extension = False

    _debug_dump_render_state(bpy.context.scene, job)

    try:
        bpy.ops.render.render(write_still=True)
    except Exception as e:
        print(f"[blender_render] render failed: {e}", file=sys.stderr)
        return 5
    if not os.path.isfile(out_path):
        print("[blender_render] output png not written", file=sys.stderr)
        return 6
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
