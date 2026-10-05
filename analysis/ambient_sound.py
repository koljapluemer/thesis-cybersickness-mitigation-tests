"""Animation of the ambient sound sources: where they are and where they are heard.

Every playing `ambient-sound` source is drawn twice, in its own colour: a ring
where its object is (anchored) and a dot where it is played from (heard), with
a line between them and a fading trail of the heard position. Under the
`inertial-ambience-*` conditions the two differ by the inertial sphere's lag
rotation about the head; in every other condition they coincide. Panels:

    view       the scene ray-cast from the logged pose of the first view (as in
               `replay_session.py`), with the sources projected into it; sources
               outside the view are triangles at the edge, pointing their way
    head frame directions of the sources on the unit sphere around the listener
    room       the room from above with the drone path, the rig's heading and the
               sources, heard ones placed at their heard position in the world
    timelines  the lag rotation (rig frame) and each source's angle between
               anchored and heard direction

See `../doc/inertial-ambience.md`.

Usage:
    cd analysis && uv run ambient_sound.py [optical-flow-<date>.json] [--out DIR] [--fps N] [--trail SEC]
                                           [--start SEC] [--end SEC] [--width PX]

Without a log argument, the latest `optical-flow-*.json` in the repository's `log/` is used.
The log must have been recorded in a scene with ambient sounds (Big Room).

Output in DIR (default: next to the log, `<log name>-replay/`):
    ambient-sound.mp4   the animation, in session time
"""

from __future__ import annotations

import argparse
from pathlib import Path

import imageio.v2 as imageio
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import LineCollection
from mpl_toolkits.mplot3d.art3d import Line3DCollection

from replay_session import load_scene, render_view
from session_log import LOG_DIR, latest_log, load_log, mat4, session_time_sec
from sound_sphere import draw_sphere, to_plot, trail_segments

SOURCE_COLOURS = ("C0", "C1", "C2", "C3", "C4", "C5", "C6", "C8", "C9")
# Room map: vertices in this height band (m) outline walls and furniture from above.
FLOOR_PLAN_HEIGHT_M = (0.2, 2.2)
FLOOR_PLAN_POINTS = 40_000
# Off-screen markers sit this far inside the view's edge, in pixels.
EDGE_INSET_PX = 8


def head_pose(frame: dict) -> tuple[np.ndarray, np.ndarray]:
    """Head position (mean of the views) and orientation (both eyes share it) in the world."""
    views = [mat4(view["matrixWorld"]) for view in frame["views"]]
    return np.mean([view[:3, 3] for view in views], axis=0), views[0][:3, :3]


def map_xy(points: np.ndarray) -> np.ndarray:
    """World (x right, y up, -z forward) -> room map seen from above (x right, -z up)."""
    return np.stack([points[..., 0], -points[..., 2]], axis=-1)


def unit(vectors: np.ndarray) -> np.ndarray:
    return vectors / np.linalg.norm(vectors, axis=-1, keepdims=True)


def angle_between_deg(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.degrees(np.arctan2(np.linalg.norm(np.cross(a, b), axis=-1), np.einsum("...i,...i", a, b)))


class ViewProjector:
    """Projects world points into the rendered view of one frame, in image pixels (y down)."""

    def __init__(self, eye_world: np.ndarray, projection: np.ndarray, width: int, height: int) -> None:
        self.world_to_eye = np.linalg.inv(eye_world)
        self.projection = projection
        self.width = width
        self.height = height

    def project(self, points: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """(pixel positions [n, 2], inside the view [n], outward angle in degrees for edge markers [n])."""
        eye = points @ self.world_to_eye[:3, :3].T + self.world_to_eye[:3, 3]
        clip = np.c_[eye, np.ones(len(eye))] @ self.projection.T
        in_front = clip[:, 3] > 1e-6
        ndc = clip[:, :2] / np.where(in_front, clip[:, 3], 1)[:, None]
        inside = in_front & np.all(np.abs(ndc) <= 1, axis=1)

        # Outside: on the edge, in the direction of the point seen from the view axis.
        direction = np.where(in_front[:, None], ndc, eye[:, :2])
        direction = np.where(np.linalg.norm(direction, axis=1, keepdims=True) < 1e-9, [[0.0, -1.0]], direction)
        half = np.array([self.width / 2 - EDGE_INSET_PX, self.height / 2 - EDGE_INSET_PX])
        edge = direction / np.max(np.abs(direction), axis=1, keepdims=True)
        ndc = np.where(inside[:, None], ndc, edge)
        pixels = np.stack([self.width / 2 + ndc[:, 0] * half[0], self.height / 2 - ndc[:, 1] * half[1]], axis=1)
        # Triangle markers point up at 0°.
        outward = np.degrees(np.arctan2(direction[:, 1], direction[:, 0])) - 90
        return pixels, inside, outward


def floor_plan(scene) -> np.ndarray:
    """Room map points: a sample of the static model's vertices within the height band, from above."""
    if scene.static is None:
        return np.empty((0, 2))
    vertices = np.asarray(scene.static.mesh.vertices)
    low, high = FLOOR_PLAN_HEIGHT_M
    vertices = vertices[(vertices[:, 1] >= low) & (vertices[:, 1] <= high)]
    if len(vertices) > FLOOR_PLAN_POINTS:
        vertices = vertices[np.random.default_rng(0).choice(len(vertices), FLOOR_PLAN_POINTS, replace=False)]
    return map_xy(vertices)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("log", type=Path, nargs="?", help=f"session log (default: latest in {LOG_DIR})")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--fps", type=float, default=30, help="video frame rate; the video runs in session time")
    parser.add_argument("--trail", type=float, default=3, help="trail length in seconds")
    parser.add_argument("--start", type=float, help="session time to start at, in seconds")
    parser.add_argument("--end", type=float, help="session time to end at, in seconds")
    parser.add_argument("--width", type=int, default=480, help="width of the rendered view, in pixels")
    args = parser.parse_args()
    args.log = args.log or latest_log()
    print(f"log: {args.log}")

    log = load_log(args.log)
    descriptions = log["ambientSounds"]
    samples = log["ambientSoundSamples"]
    if not descriptions or not samples:
        raise SystemExit(f"no ambient sound samples (scene: {log['scene']['id']})")
    ids = [description["id"] for description in descriptions]
    colours = {source_id: SOURCE_COLOURS[index % len(SOURCE_COLOURS)] for index, source_id in enumerate(ids)}
    anchored_world = np.array([description["positionWorld"] for description in descriptions])

    # Per sample: the frame it belongs to, the head pose, and each source's positions (NaN while not playing).
    frames = log["frames"]
    frame_times = np.array([frame["sceneTimeMs"] for frame in frames])
    sample_times = np.array([sample["sceneTimeMs"] for sample in samples])
    frame_of = np.clip(np.searchsorted(frame_times, sample_times), 0, len(frames) - 1)
    t = session_time_sec(log, sample_times.tolist())
    count = len(samples)
    anchored_head = np.full((count, len(ids), 3), np.nan)
    heard_head = np.full((count, len(ids), 3), np.nan)
    for index, sample in enumerate(samples):
        for source in sample["sources"]:
            column = ids.index(source["id"])
            anchored_head[index, column] = source["anchoredHead"]
            heard_head[index, column] = source["heardHead"]
    poses = [head_pose(frames[index]) for index in frame_of]
    head_position = np.array([position for position, _ in poses])
    head_rotation = np.array([rotation for _, rotation in poses])
    heard_world = head_position[:, None] + np.einsum("nij,nsj->nsi", head_rotation, heard_head)
    deviation = angle_between_deg(anchored_head, heard_head)
    rig_position = np.array([mat4(frame["rigMatrixWorld"])[:3, 3] for frame in frames])

    config = log["inertialAmbience"]
    lag_samples = log["inertialAmbienceSamples"]
    lag_t = session_time_sec(log, [sample["sceneTimeMs"] for sample in lag_samples]) if lag_samples else np.empty(0)
    lag = np.array([sample["lagRotationVectorDeg"] for sample in lag_samples]) if lag_samples else np.empty((0, 3))

    scene = load_scene(log)
    plan = floor_plan(scene)

    start = t[0] if args.start is None else args.start
    end = t[-1] if args.end is None else args.end
    video_times = np.arange(start, end, 1 / args.fps)

    figure = plt.figure(figsize=(18, 10), dpi=100)
    grid = figure.add_gridspec(3, 3, height_ratios=(3.2, 1, 1), width_ratios=(1.5, 1, 1))
    view_axis = figure.add_subplot(grid[0, 0])
    sphere_axis = figure.add_subplot(grid[0, 1], projection="3d")
    map_axis = figure.add_subplot(grid[0, 2])
    lag_axis = figure.add_subplot(grid[1, :])
    deviation_axis = figure.add_subplot(grid[2, :], sharex=lag_axis)
    figure.subplots_adjust(left=0.05, right=0.98, top=0.9, bottom=0.06, wspace=0.12, hspace=0.3)

    # View: the image is replaced per frame; overlays per source.
    first_view = frames[frame_of[0]]["views"][0]
    projection = mat4(first_view["projectionMatrix"])
    width = args.width
    height = max(1, round(width * projection[0, 0] / projection[1, 1]))
    image = view_axis.imshow(np.zeros((height, width, 3)), extent=(0, width, height, 0))
    view_axis.set_xlim(0, width)
    view_axis.set_ylim(height, 0)
    view_axis.set_axis_off()
    view_axis.set_title("view (first eye): ring = object, dot = heard", fontsize=10)

    draw_sphere(sphere_axis, "head frame: directions as heard", 1)

    if len(plan):
        map_axis.scatter(plan[:, 0], plan[:, 1], s=0.2, color="grey", alpha=0.25, linewidths=0)
    path = map_xy(rig_position)
    map_axis.plot(path[:, 0], path[:, 1], color="grey", linewidth=0.6, alpha=0.5)
    (map_trail,) = map_axis.plot([], [], color="black", linewidth=1.5)
    (rig_point,) = map_axis.plot([], [], "o", color="black", markersize=6)
    rig_heading = map_axis.quiver([0], [0], [0], [0], color="black", angles="xy", scale_units="xy", scale=1, width=0.006)
    head_heading = map_axis.quiver([0], [0], [0], [0], color="grey", angles="xy", scale_units="xy", scale=1, width=0.004)
    anchored_map = map_xy(anchored_world)
    for index, source_id in enumerate(ids):
        map_axis.plot(*anchored_map[index], "s", color=colours[source_id], markersize=9, markeredgecolor="black")
    extent_points = np.concatenate([plan, path, anchored_map]) if len(plan) else np.concatenate([path, anchored_map])
    low, high = extent_points.min(axis=0) - 0.5, extent_points.max(axis=0) + 0.5
    map_axis.set_xlim(low[0], high[0])
    map_axis.set_ylim(low[1], high[1])
    map_axis.set_aspect("equal")
    map_axis.set_xlabel("x (m)")
    map_axis.set_ylabel("−z (m)")
    map_axis.set_title("room from above: square = object, dot = heard", fontsize=10)

    class SourceArtists:
        def __init__(self, column: int, source_id: str) -> None:
            colour = colours[source_id]
            self.column = column
            self.colour = colour
            self.view_trail = LineCollection([], linewidths=2)
            view_axis.add_collection(self.view_trail, autolim=False)
            (self.view_link,) = view_axis.plot([], [], color=colour, linewidth=1)
            (self.view_anchored,) = view_axis.plot([], [], "o", markersize=13, markerfacecolor="none", markeredgecolor=colour, markeredgewidth=2)
            (self.view_heard,) = view_axis.plot([], [], "o", markersize=8, color=colour, markeredgecolor="black")
            (self.view_edge,) = view_axis.plot([], [], color=colour, markersize=11, markeredgecolor="black", linestyle="none")
            self.sphere_trail = Line3DCollection([], linewidths=2.5)
            sphere_axis.add_collection3d(self.sphere_trail, autolim=False)
            (self.sphere_link,) = sphere_axis.plot([], [], [], color=colour, linewidth=1)
            (self.sphere_anchored,) = sphere_axis.plot([], [], [], "o", markersize=10, markerfacecolor="none", markeredgecolor=colour, markeredgewidth=2)
            (self.sphere_heard,) = sphere_axis.plot([], [], [], "o", markersize=7, color=colour, markeredgecolor="black")
            self.map_trail = LineCollection([], linewidths=2)
            map_axis.add_collection(self.map_trail, autolim=False)
            (self.map_link,) = map_axis.plot([], [], color=colour, linewidth=1)
            (self.map_heard,) = map_axis.plot([], [], "o", markersize=7, color=colour, markeredgecolor="black")
            sphere_axis.plot([], [], [], "o", color=colour, label=source_id)

        def update(self, first: int, last: int, projector: ViewProjector) -> None:
            column = self.column
            playing = slice(first, last + 1)
            heard = heard_world[playing, column]
            valid = ~np.isnan(heard).any(axis=1)
            if not valid[-1]:
                self.hide()
                return

            # View.
            pixels, inside, outward = projector.project(np.vstack([anchored_world[column], heard[valid]]))
            trail_pixels = pixels[1:]
            trail_inside = inside[1:]
            segments, segment_colours = trail_segments(trail_pixels, 0, len(trail_pixels) - 1, self.colour)
            keep = trail_inside[:-1] & trail_inside[1:]
            self.view_trail.set_segments(segments[keep])
            self.view_trail.set_color(segment_colours[keep])
            anchored_pixel, heard_pixel = pixels[0], pixels[-1]
            self.view_anchored.set_data([anchored_pixel[0]] if inside[0] else [], [anchored_pixel[1]] if inside[0] else [])
            self.view_heard.set_data([heard_pixel[0]] if inside[-1] else [], [heard_pixel[1]] if inside[-1] else [])
            if inside[0] and inside[-1]:
                self.view_link.set_data([anchored_pixel[0], heard_pixel[0]], [anchored_pixel[1], heard_pixel[1]])
            else:
                self.view_link.set_data([], [])
            if inside[-1]:
                self.view_edge.set_data([], [])
            else:
                self.view_edge.set_data([heard_pixel[0]], [heard_pixel[1]])
                self.view_edge.set_marker((3, 0, outward[-1]))

            # Head frame: directions on the unit sphere.
            anchored_direction = to_plot(unit(anchored_head[last, column]))
            heard_directions = to_plot(unit(heard_head[playing, column][valid]))
            segments, segment_colours = trail_segments(heard_directions, 0, len(heard_directions) - 1, self.colour)
            self.sphere_trail.set_segments(segments)
            self.sphere_trail.set_color(segment_colours)
            heard_direction = heard_directions[-1]
            self.sphere_anchored.set_data_3d(*anchored_direction[:, None])
            self.sphere_heard.set_data_3d(*heard_direction[:, None])
            self.sphere_link.set_data_3d(*np.stack([anchored_direction, heard_direction], axis=1))

            # Room map.
            heard_map = map_xy(heard[valid])
            segments, segment_colours = trail_segments(heard_map, 0, len(heard_map) - 1, self.colour)
            self.map_trail.set_segments(segments)
            self.map_trail.set_color(segment_colours)
            self.map_heard.set_data([heard_map[-1, 0]], [heard_map[-1, 1]])
            self.map_link.set_data([anchored_map[column, 0], heard_map[-1, 0]], [anchored_map[column, 1], heard_map[-1, 1]])

        def hide(self) -> None:
            for artist in (self.view_link, self.view_anchored, self.view_heard, self.view_edge, self.map_link, self.map_heard):
                artist.set_data([], [])
            for artist in (self.sphere_link, self.sphere_anchored, self.sphere_heard):
                artist.set_data_3d([], [], [])
            for collection in (self.view_trail, self.sphere_trail, self.map_trail):
                collection.set_segments([])

    artists = [SourceArtists(column, source_id) for column, source_id in enumerate(ids)]
    sphere_axis.legend(loc="lower left", fontsize=8)

    if len(lag):
        for index, name in enumerate(("pitch (x)", "yaw (y)", "roll (z)")):
            lag_axis.plot(lag_t, lag[:, index], linewidth=1, label=name)
        lag_axis.legend(loc="upper right", fontsize=8)
    else:
        lag_axis.text(0.5, 0.5, "inertial ambience disabled: heard = anchored", transform=lag_axis.transAxes, ha="center", va="center")
    lag_axis.set_ylabel("lag rotation\n(deg, rig frame)")
    lag_axis.tick_params(labelbottom=False)
    for column, source_id in enumerate(ids):
        deviation_axis.plot(t, deviation[:, column], linewidth=1, color=colours[source_id], label=source_id)
    deviation_axis.set_ylabel("object → heard\n(deg)")
    deviation_axis.set_xlabel("session time (s)")
    deviation_axis.legend(loc="upper right", fontsize=8)
    deviation_axis.set_xlim(start, end)
    cursors = [axis.axvline(start, color="black", linewidth=1) for axis in (lag_axis, deviation_axis)]
    spans = [axis.axvspan(start, start, color="grey", alpha=0.15) for axis in (lag_axis, deviation_axis)]

    timing = f"T={config['naturalPeriodMs'] / 1000:g}s, ζ={config['dampingRatio']:g}"
    if config["enabled"]:
        model = f"{config['swing']}, {timing}, ×{config['lagGain']:g}, max {config['maxLagDeg']:g}°"
    else:
        model = "inertial ambience off"
    title = f"{log['condition']}   {model}"
    caption = figure.suptitle("")

    out = args.out or args.log.with_name(args.log.stem + "-replay")
    out.mkdir(parents=True, exist_ok=True)
    path_out = out / "ambient-sound.mp4"
    with imageio.get_writer(path_out, fps=args.fps, codec="libx264", macro_block_size=1) as writer:
        for number, time in enumerate(video_times):
            last = max(0, int(np.searchsorted(t, time, side="right")) - 1)
            first = min(int(np.searchsorted(t, time - args.trail)), last)
            frame = frames[frame_of[last]]
            view = frame["views"][0]
            eye_world = mat4(view["matrixWorld"])
            view_projection = mat4(view["projectionMatrix"])
            rig = mat4(frame["rigMatrixWorld"])
            image.set_data(np.flipud(np.clip(render_view(scene, eye_world, view_projection, rig, width, height), 0, 1)))
            projector = ViewProjector(eye_world, view_projection, width, height)
            for artist in artists:
                artist.update(first, last, projector)

            frame_index = frame_of[last]
            trail_frames = slice(frame_of[first], frame_index + 1)
            map_trail.set_data(path[trail_frames, 0], path[trail_frames, 1])
            rig_point.set_data([path[frame_index, 0]], [path[frame_index, 1]])
            rig_forward = map_xy(-rig[:3, 2])
            head_forward = map_xy(-head_rotation[last][:, 2])
            rig_heading.set_offsets([path[frame_index]])
            rig_heading.set_UVC([rig_forward[0]], [rig_forward[1]])
            head_heading.set_offsets([map_xy(head_position[last])])
            head_heading.set_UVC([0.7 * head_forward[0]], [0.7 * head_forward[1]])

            for cursor in cursors:
                cursor.set_xdata([time, time])
            for span in spans:
                span.set_x(t[first])
                span.set_width(t[last] - t[first])
            if len(lag):
                current = lag[max(0, int(np.searchsorted(lag_t, time, side="right")) - 1)]
                state = f"lag yaw={current[1]:+.1f}°  pitch={current[0]:+.1f}°  roll={current[2]:+.1f}°"
            else:
                state = ""
            caption.set_text(f"{title}\nt={time:.2f}s   {state}")
            figure.canvas.draw()
            writer.append_data(np.asarray(figure.canvas.buffer_rgba())[..., :3])
            print(f"\rrendered {number + 1}/{len(video_times)}", end="", flush=True)
    print()
    plt.close(figure)
    print(f"written to {path_out}")


if __name__ == "__main__":
    main()
