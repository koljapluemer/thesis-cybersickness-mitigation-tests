import bpy
import json
import mathutils
from pathlib import Path

# ---------- SETTINGS ----------
CURVE_OBJECT_NAME = "TourPath"
OUTPUT_FILE = "tour-path.json"
SAMPLES = 600
DURATION_SECONDS = 120
# ------------------------------


def blender_to_aframe(v):
    """
    Blender: X right, Y forward, Z up
    A-Frame/Three.js: X right, Y up, Z backward/forward depth

    This maps Blender forward +Y to A-Frame forward -Z.
    """
    return [v.x, v.z, -v.y]


def get_curve_object(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError(f"No object named '{name}' found.")

    if obj.type != "CURVE":
        raise RuntimeError(f"Object '{name}' is not a Curve. It is {obj.type}.")

    return obj


def sample_curve(obj, samples):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)

    # Convert curve to mesh so we can sample its evaluated world-space vertices.
    mesh = evaluated.to_mesh()

    if not mesh.vertices:
        raise RuntimeError("Curve produced no vertices. Try increasing curve resolution.")

    world_points = [
        obj.matrix_world @ vertex.co
        for vertex in mesh.vertices
    ]

    evaluated.to_mesh_clear()

    # Sort points in mesh order and resample approximately evenly by index.
    # This is good enough for most path-export use.
    exported = []

    for i in range(samples):
        alpha = i / (samples - 1)
        raw_index = alpha * (len(world_points) - 1)

        i0 = int(raw_index)
        i1 = min(i0 + 1, len(world_points) - 1)

        local_alpha = raw_index - i0
        p = world_points[i0].lerp(world_points[i1], local_alpha)

        t = alpha * DURATION_SECONDS

        exported.append({
            "t": round(t, 6),
            "position": [round(x, 6) for x in blender_to_aframe(p)]
        })

    return exported


def main():
    obj = get_curve_object(CURVE_OBJECT_NAME)
    points = sample_curve(obj, SAMPLES)

    data = {
        "source": CURVE_OBJECT_NAME,
        "duration": DURATION_SECONDS,
        "samples": SAMPLES,
        "coordinateMapping": "aframe = [blender.x, blender.z, -blender.y]",
        "points": points
    }

    blend_dir = Path(bpy.data.filepath).parent
    output_path = blend_dir / OUTPUT_FILE

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Exported {len(points)} samples to {output_path}")


main()
