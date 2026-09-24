"""Offline replay of an optical flow session log.

Re-renders every replayed frame from the logged poses by ray casting the
landscape, recomputes the flow field independently of the browser, and
compares it with the field snapshots measured live. Both flow components are
validated: total (rig + head motion) and rig-induced (rig motion alone).

Usage:
    cd analysis && uv run replay_session.py [optical-flow-<date>.json] [--out DIR] [--all-frames] [--every N]

Without a log argument, the latest `optical-flow-*.json` in the repository's `log/` is used.

Outputs in DIR (default: next to the log, `<log name>-replay/`):
    timeseries.png   live flow measurements, turn signal and turn cues over the session
    frames/*.png     per replayed view: reconstruction | live flow | recomputed flow | |difference|
                     (total flow)
                     (live panels are blank on frames without a live field snapshot)
    replay.mp4       the frames as a video
    validation.json  live vs. recomputed error statistics
"""

from __future__ import annotations

import argparse
import base64
import colorsys
import json
from dataclasses import dataclass
from pathlib import Path

import imageio.v3 as iio
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import trimesh
from PIL import Image, ImageDraw

REPO_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = REPO_DIR / "public"
LOG_DIR = REPO_DIR / "log"
LOG_VERSION = 2
COMPONENTS = ("total", "rigInduced")
PANEL_SCALE = 4
# Flow magnitude (deg/s) that maps to full colour saturation in the flow panels.
FLOW_COLOUR_RANGE_DEG_PER_SEC = 60.0


def mat4(values: list[float]) -> np.ndarray:
    """Column-major three.js matrix array -> 4x4 numpy matrix."""
    return np.asarray(values, dtype=np.float64).reshape(4, 4).T


def decode_fields(entry: dict) -> dict[str, np.ndarray]:
    """Logged field snapshot of one view -> {component: [h, w, 4]}."""
    return {
        component: np.frombuffer(base64.b64decode(entry[component]), dtype="<f4").reshape(entry["height"], entry["width"], 4)
        for component in COMPONENTS
    }


@dataclass
class Landscape:
    mesh: trimesh.Trimesh
    uv: np.ndarray
    texture: np.ndarray


def load_landscape(log: dict) -> Landscape:
    source = PUBLIC_DIR / log["scene"]["landscape"]["src"].lstrip("/")
    scene = trimesh.load(source)
    vertices, faces, uvs = [], [], []
    texture = None
    offset = 0

    for node in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node]
        geometry = scene.geometry[geometry_name]
        vertices.append(trimesh.transform_points(geometry.vertices, transform))
        faces.append(geometry.faces + offset)
        uvs.append(geometry.visual.uv)
        offset += len(geometry.vertices)
        if texture is None:
            texture = np.asarray(geometry.visual.material.baseColorTexture.convert("RGB"), dtype=np.float32) / 255

    world = mat4(log["scene"]["landscape"]["matrixWorld"])
    mesh = trimesh.Trimesh(
        vertices=trimesh.transform_points(np.concatenate(vertices), world),
        faces=np.concatenate(faces),
        process=False,
    )
    return Landscape(mesh=mesh, uv=np.concatenate(uvs), texture=texture)


def pixel_directions(width: int, height: int, projection: np.ndarray) -> np.ndarray:
    """Eye-space unit view directions of the pixel centres, rows bottom-up (WebGL order)."""
    xs = (np.arange(width) + 0.5) / width * 2 - 1
    ys = (np.arange(height) + 0.5) / height * 2 - 1
    ndc_x, ndc_y = np.meshgrid(xs, ys)
    ndc = np.stack([ndc_x, ndc_y, -np.ones_like(ndc_x), np.ones_like(ndc_x)], axis=-1).reshape(-1, 4)
    eye = ndc @ np.linalg.inv(projection).T
    eye = eye[:, :3] / eye[:, 3:4]
    return eye / np.linalg.norm(eye, axis=1, keepdims=True)


def angle_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b), axis=1), np.einsum("ij,ij->i", a, b)))


def azimuth_change_deg(prev: np.ndarray, current: np.ndarray) -> np.ndarray:
    """Signed change of eye-space azimuth from prev to current, positive = rightward."""
    p = np.stack([-prev[:, 2], prev[:, 0]], axis=1)  # (forward, right)
    c = np.stack([-current[:, 2], current[:, 0]], axis=1)
    return np.degrees(np.arctan2(p[:, 0] * c[:, 1] - p[:, 1] * c[:, 0], np.einsum("ij,ij->i", p, c)))


def to_eye(view: np.ndarray, points: np.ndarray) -> np.ndarray:
    return points @ view[:3, :3].T + view[:3, 3]


def replay_view(landscape: Landscape, frame: dict, previous: dict, view_index: int, width: int, height: int):
    """Returns ({component: flow field [h, w, 4] in the live layout}, colour image [h, w, 3])."""
    view = frame["views"][view_index]
    eye_world = mat4(view["matrixWorld"])
    projection = mat4(view["projectionMatrix"])
    prev_eye_world = mat4(previous["views"][view_index]["matrixWorld"])
    rig = mat4(frame["rigMatrixWorld"])
    prev_rig = mat4(previous["rigMatrixWorld"])
    rig_prev_eye_world = prev_rig @ np.linalg.inv(rig) @ eye_world

    directions = pixel_directions(width, height, projection) @ eye_world[:3, :3].T
    origins = np.repeat(eye_world[:3, 3][None], len(directions), axis=0)
    locations, ray_index, triangle_index = landscape.mesh.ray.intersects_location(origins, directions, multiple_hits=False)

    fields = {component: np.tile(np.array([0, 0, -1, 0], dtype=np.float32), (width * height, 1)) for component in COMPONENTS}
    colour = np.tile(np.array([0.86, 0.93, 0.97], dtype=np.float32), (width * height, 1))

    if len(locations):
        inv_dt = 1000.0 / frame["deltaMs"]
        current = to_eye(np.linalg.inv(eye_world), locations)
        prev = to_eye(np.linalg.inv(prev_eye_world), locations)
        rig_prev = to_eye(np.linalg.inv(rig_prev_eye_world), locations)

        def ndc(eye_points: np.ndarray) -> np.ndarray:
            clip = np.c_[eye_points, np.ones(len(eye_points))] @ projection.T
            return clip[:, :2] / clip[:, 3:4]

        def unit(vectors: np.ndarray) -> np.ndarray:
            return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)

        for component, previous_points in (("total", prev), ("rigInduced", rig_prev)):
            field = fields[component]
            field[ray_index, 0:2] = (ndc(current) - ndc(previous_points)) * inv_dt
            field[ray_index, 2] = angle_deg(unit(previous_points), unit(current)) * inv_dt
            field[ray_index, 3] = azimuth_change_deg(previous_points, current) * inv_dt

        # Texture lookup with simple Lambert shading, only for orientation.
        faces = landscape.mesh.faces[triangle_index]
        barycentric = trimesh.triangles.points_to_barycentric(landscape.mesh.vertices[faces], locations)
        uv = np.einsum("ij,ijk->ik", barycentric, landscape.uv[faces])
        tex_h, tex_w, _ = landscape.texture.shape
        texel = landscape.texture[
            np.clip(((1 - uv[:, 1]) % 1) * tex_h, 0, tex_h - 1).astype(int),
            np.clip((uv[:, 0] % 1) * tex_w, 0, tex_w - 1).astype(int),
        ]
        normals = landscape.mesh.face_normals[triangle_index]
        light = np.array([6, 10, 3], dtype=np.float64)
        light /= np.linalg.norm(light)
        shade = 0.55 + 0.45 * np.abs(normals @ light)
        colour[ray_index] = texel * shade[:, None]

    return {component: field.reshape(height, width, 4) for component, field in fields.items()}, colour.reshape(height, width, 3)


def flow_image(field: np.ndarray) -> Image.Image:
    """Hue = direction of the NDC flow, value = angular speed; background dark grey."""
    height, width, _ = field.shape
    rgb = np.full((height, width, 3), 0.15, dtype=np.float32)
    covered = field[..., 2] >= 0
    direction = (np.arctan2(field[..., 1], field[..., 0]) / (2 * np.pi)) % 1
    value = np.clip(field[..., 2] / FLOW_COLOUR_RANGE_DEG_PER_SEC, 0, 1)
    for y, x in zip(*np.nonzero(covered)):
        rgb[y, x] = colorsys.hsv_to_rgb(direction[y, x], 1.0, 0.25 + 0.75 * value[y, x])
    image = upscale(rgb)
    draw_arrows(image, field)
    return image


def draw_arrows(image: Image.Image, field: np.ndarray, step: int = 8) -> None:
    height, width, _ = field.shape
    draw = ImageDraw.Draw(image)
    # Arrow length: NDC flow over 0.1 s, drawn in panel pixels.
    for y in range(step // 2, height, step):
        for x in range(step // 2, width, step):
            if field[y, x, 2] < 0:
                continue
            cx, cy = (x + 0.5) * PANEL_SCALE, (height - y - 0.5) * PANEL_SCALE
            dx = field[y, x, 0] * 0.1 * width / 2 * PANEL_SCALE
            dy = -field[y, x, 1] * 0.1 * height / 2 * PANEL_SCALE
            draw.line([(cx, cy), (cx + dx, cy + dy)], fill=(255, 255, 255), width=1)
            draw.ellipse([cx - 1, cy - 1, cx + 1, cy + 1], fill=(255, 255, 255))


def difference_image(live: np.ndarray, replayed: np.ndarray) -> Image.Image:
    both = (live[..., 2] >= 0) & (replayed[..., 2] >= 0)
    mismatch = (live[..., 2] >= 0) != (replayed[..., 2] >= 0)
    diff = np.where(both, np.abs(live[..., 2] - replayed[..., 2]), 0)
    rgb = np.zeros(live.shape[:2] + (3,), dtype=np.float32)
    rgb[..., 0] = np.clip(diff / 5.0, 0, 1)  # full red at 5 deg/s error
    rgb[..., 1] = rgb[..., 0]
    rgb[mismatch] = (1, 0, 1)  # coverage disagreement
    return upscale(rgb)


def upscale(rgb: np.ndarray) -> Image.Image:
    image = Image.fromarray((np.flipud(np.clip(rgb, 0, 1)) * 255).astype(np.uint8))
    return image.resize((image.width * PANEL_SCALE, image.height * PANEL_SCALE), Image.NEAREST)


def composite(panels: list[Image.Image], caption: str) -> Image.Image:
    header = 22
    width = sum(panel.width for panel in panels) + 4 * (len(panels) - 1)
    image = Image.new("RGB", (width, panels[0].height + header), (0, 0, 0))
    ImageDraw.Draw(image).text((6, 5), caption, fill=(255, 255, 255))
    x = 0
    for panel in panels:
        image.paste(panel, (x, header))
        x += panel.width + 4
    return image


def plot_timeseries(log: dict, path: Path) -> None:
    frames = [frame for frame in log["frames"] if frame["flow"] is not None]
    t = np.array([frame["timeMs"] / 1000 for frame in frames])
    combined = [frame["flow"]["combined"] for frame in frames]
    figure, axes = plt.subplots(4, 1, figsize=(12, 12), sharex=True)

    axes[0].plot(t, [c["total"]["meanDegPerSec"] for c in combined], label="total mean")
    axes[0].plot(t, [c["rigInduced"]["meanDegPerSec"] for c in combined], label="rig-induced mean", linestyle="--")
    axes[0].set_ylabel("deg/s")
    axes[0].legend()

    for index, band in enumerate(combined[0]["total"]["bands"] if combined else []):
        label = f"{band['minEccentricityDeg']}–{band['maxEccentricityDeg']}°"
        axes[1].plot(t, [c["total"]["bands"][index]["meanDegPerSec"] for c in combined], label=label)
    axes[1].set_ylabel("deg/s by eccentricity")
    axes[1].legend()

    axes[2].plot(t, [c["coverage"] for c in combined], color="C0")
    axes[2].set_ylabel("coverage", color="C0")
    axes[2].set_ylim(0, 1.05)
    frame_time_axis = axes[2].twinx()
    frame_time_axis.plot(t, [frame["deltaMs"] for frame in frames], color="C1", alpha=0.5)
    frame_time_axis.set_ylabel("frame time (ms)", color="C1")
    plot_turn_signal(log, axes[3])
    axes[3].set_xlabel("session time (s)")

    for event in log["events"]:
        if event["type"] == "turn-cue":
            continue
        for axis in axes:
            axis.axvline(event["timeMs"] / 1000, color="grey", linestyle=":")
        axes[0].annotate(event["type"], (event["timeMs"] / 1000, axes[0].get_ylim()[1]), fontsize=8)

    figure.tight_layout()
    figure.savefig(path, dpi=110)
    plt.close(figure)


def plot_turn_signal(log: dict, axis: plt.Axes) -> None:
    """Turn-rate signal of the cue detector (positive = left), thresholds and cues."""
    config = log["turnCues"]
    frames = log["frames"]
    signals = log["turnSignals"]
    if signals and frames:
        # Signals carry scene time; map it to session time via the frames.
        t = np.interp(
            [signal["sceneTimeMs"] for signal in signals],
            [frame["sceneTimeMs"] for frame in frames],
            [frame["timeMs"] / 1000 for frame in frames],
        )
        axis.plot(t, [signal["turnDegPerSec"] for signal in signals], color="C0", alpha=0.35, label="raw")
        axis.plot(t, [signal["smoothedDegPerSec"] for signal in signals], color="C0", label="smoothed")
    for sign in (1, -1):
        axis.axhline(sign * config["onThresholdDegPerSec"], color="C3", linestyle="--", linewidth=0.8)
        axis.axhline(sign * config["offThresholdDegPerSec"], color="C3", linestyle=":", linewidth=0.8)
    for event in log["events"]:
        if event["type"] == "turn-cue":
            colour = "C2" if event["direction"] == "left" else "C1"
            axis.axvline(event["timeMs"] / 1000, color=colour, alpha=0.8 if event["presented"] else 0.3)
    axis.set_ylabel(f"turn deg/s (+left)\nsource: {config['source']}, output: {config['output']}")
    axis.legend(loc="upper right")


def latest_log() -> Path:
    # File names carry ISO timestamps, so lexical order is chronological.
    logs = sorted(LOG_DIR.glob("optical-flow-*.json"))
    if not logs:
        raise SystemExit(f"no optical-flow-*.json logs in {LOG_DIR}")
    return logs[-1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("log", type=Path, nargs="?", help=f"session log (default: latest in {LOG_DIR})")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--all-frames", action="store_true", help="replay every frame, not only those with live field snapshots")
    parser.add_argument("--every", type=int, default=1, help="with --all-frames: replay every N-th frame")
    args = parser.parse_args()
    args.log = args.log or latest_log()
    print(f"log: {args.log}")

    log = json.loads(args.log.read_text())
    if log.get("version") != LOG_VERSION:
        raise SystemExit(f"log format version {log.get('version')} is not supported (expected {LOG_VERSION})")
    out = args.out or args.log.with_name(args.log.stem + "-replay")
    (out / "frames").mkdir(parents=True, exist_ok=True)

    measured = [frame for frame in log["frames"] if frame["flow"] is not None]
    duration = log["frames"][-1]["timeMs"] / 1000 if log["frames"] else 0
    xr_events = [event for event in log["events"] if event["type"] != "turn-cue"]
    cues = len(log["events"]) - len(xr_events)
    print(f"{len(log['frames'])} frames over {duration:.1f}s, {len(measured)} measured, {cues} turn cues, XR events: {xr_events}")

    plot_timeseries(log, out / "timeseries.png")
    landscape = load_landscape(log)

    replay = []
    for index, frame in enumerate(log["frames"]):
        previous = log["frames"][index - 1] if index > 0 else None
        if frame["flow"] is None or previous is None or previous["frame"] != frame["frame"] - 1:
            continue
        if "fields" in frame or (args.all_frames and index % args.every == 0):
            replay.append((frame, previous))

    errors = []
    video_frames = []
    for number, (frame, previous) in enumerate(replay):
        live_fields = {entry["eye"]: decode_fields(entry) for entry in frame.get("fields", [])}
        for view_index, view in enumerate(frame["views"]):
            width, height = view["fieldWidth"], view["fieldHeight"]
            replayed, colour = replay_view(landscape, frame, previous, view_index, width, height)
            live = live_fields.get(view["eye"])
            blank = Image.new("RGB", (width * PANEL_SCALE, height * PANEL_SCALE), (40, 40, 40))
            panels = [upscale(colour), blank, flow_image(replayed["total"]), blank]
            caption = (
                f"frame {frame['frame']}  t={frame['timeMs'] / 1000:.2f}s  path={frame['pathTimeSec']:.2f}s  "
                f"eye={view['eye']}  live mean={frame['flow']['views'][view_index]['total']['meanDegPerSec']:.1f}°/s"
            )
            if live is not None:
                covered_live = live["total"][..., 2] >= 0
                covered_replayed = replayed["total"][..., 2] >= 0
                both = covered_live & covered_replayed
                error = {
                    "frame": frame["frame"],
                    "eye": view["eye"],
                    "coverageAgreement": float(np.mean(covered_live == covered_replayed)),
                }
                for component in COMPONENTS:
                    speed_error = np.abs(live[component][..., 2] - replayed[component][..., 2])[both]
                    horizontal_error = np.abs(live[component][..., 3] - replayed[component][..., 3])[both]
                    error[component] = {
                        "absErrorMedian": float(np.median(speed_error)),
                        "absErrorP95": float(np.percentile(speed_error, 95)),
                        "horizontalAbsErrorMedian": float(np.median(horizontal_error)),
                        "liveMean": float(np.mean(live[component][..., 2][both])),
                        "replayedMean": float(np.mean(replayed[component][..., 2][both])),
                    }
                errors.append(error)
                panels = [upscale(colour), flow_image(live["total"]), flow_image(replayed["total"]), difference_image(live["total"], replayed["total"])]
                caption += f"  |err| median={error['total']['absErrorMedian']:.2f}°/s"
            image = composite(panels, caption)
            image.save(out / "frames" / f"{frame['frame']:07d}-{view['eye']}.png")
            video_frames.append(np.asarray(image))
        print(f"\rreplayed {number + 1}/{len(replay)}", end="", flush=True)
    print()

    if video_frames:
        size = video_frames[0].shape
        fps = max(1, round(len(replay) / duration)) if duration else 1
        iio.imwrite(out / "replay.mp4", [f for f in video_frames if f.shape == size], fps=fps, codec="libx264", macro_block_size=1)

    def median_of(component: str, key: str) -> float | None:
        return float(np.median([e[component][key] for e in errors])) if errors else None

    summary = {
        "snapshots": len(errors),
        "coverageAgreementMean": float(np.mean([e["coverageAgreement"] for e in errors])) if errors else None,
        **{
            component: {key: median_of(component, key) for key in ("absErrorMedian", "absErrorP95", "horizontalAbsErrorMedian")}
            for component in COMPONENTS
        },
        "perSnapshot": errors,
    }
    (out / "validation.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({key: value for key, value in summary.items() if key != "perSnapshot"}, indent=2))
    print(f"written to {out}")


if __name__ == "__main__":
    main()
