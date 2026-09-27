"""Animation of the inertial sound's source on its sphere.

Draws the source as a point with a fading trail on a unit sphere, twice side by
side: in the rig frame (its place on the inertial sphere; at rest it sits at
the rest direction) and in the head frame (where the ears hear it). A timeline
of the lag below follows the playhead. See `../doc/inertial-sound.md`.

Usage:
    cd analysis && uv run sound_sphere.py [optical-flow-<date>.json] [--out DIR] [--fps N] [--trail SEC] [--start SEC] [--end SEC]

Without a log argument, the latest `optical-flow-*.json` in the repository's `log/` is used.
The log must have been recorded under the `inertial-motor-sound` condition.

Output in DIR (default: next to the log, `<log name>-replay/`):
    sound-sphere.mp4   the animation, in session time
"""

from __future__ import annotations

import argparse
from pathlib import Path

import imageio.v2 as imageio
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import to_rgba
from mpl_toolkits.mplot3d.art3d import Line3DCollection

from session_log import LOG_DIR, latest_log, load_log, session_time_sec

# Camera of the 3D panels: behind, above and slightly left of the listener, looking forward.
VIEW_ELEVATION_DEG = 25
VIEW_AZIMUTH_DEG = -105
SOURCE_COLOUR = "C3"


def to_plot(directions: np.ndarray) -> np.ndarray:
    """three.js coordinates (x right, y up, -z forward) -> plot coordinates (x right, y forward, z up)."""
    return np.stack([directions[..., 0], -directions[..., 2], directions[..., 1]], axis=-1)


def rest_direction(elevation_deg: float) -> np.ndarray:
    """Rest direction of the source in rig coordinates, as `rest` in `inertial-sound-system.ts`."""
    elevation = np.radians(elevation_deg)
    return np.array([0, np.sin(elevation), -np.cos(elevation)])


def draw_sphere(axis: plt.Axes, title: str) -> None:
    """Unit sphere as latitude and longitude lines every 30°, with the listener's forward and up axes."""
    angles = np.linspace(0, 2 * np.pi, 97)
    for latitude in np.radians(np.arange(-60, 61, 30)):
        axis.plot(
            np.cos(latitude) * np.sin(angles),
            np.cos(latitude) * np.cos(angles),
            np.full_like(angles, np.sin(latitude)),
            color="grey",
            linewidth=1.2 if latitude == 0 else 0.5,
            alpha=0.6 if latitude == 0 else 0.3,
        )
    for longitude in np.radians(np.arange(0, 180, 30)):
        axis.plot(
            np.sin(longitude) * np.cos(angles),
            np.cos(longitude) * np.cos(angles),
            np.sin(angles),
            color="grey",
            linewidth=0.5,
            alpha=0.3,
        )
    axis.quiver(0, 0, 0, 0, 1.25, 0, color="black", linewidth=1.5, arrow_length_ratio=0.12)
    axis.text(0, 1.35, 0, "forward", fontsize=8, ha="center")
    axis.quiver(0, 0, 0, 0, 0, 1.2, color="black", linewidth=0.8, arrow_length_ratio=0.12, alpha=0.5)
    axis.set_xlim(-1, 1)
    axis.set_ylim(-1, 1)
    axis.set_zlim(-1, 1)
    axis.set_box_aspect((1, 1, 1), zoom=1.2)
    axis.view_init(elev=VIEW_ELEVATION_DEG, azim=VIEW_AZIMUTH_DEG)
    axis.set_axis_off()
    axis.set_title(title, fontsize=10)


class SourceMarker:
    """Point with a fading trail on one sphere panel."""

    def __init__(self, axis: plt.Axes, directions: np.ndarray) -> None:
        self.points = to_plot(directions)
        self.trail = Line3DCollection([], linewidths=3)
        axis.add_collection3d(self.trail, autolim=False)
        (self.spoke,) = axis.plot([], [], [], color=SOURCE_COLOUR, linewidth=0.8, alpha=0.5)
        (self.point,) = axis.plot([], [], [], "o", color=SOURCE_COLOUR, markersize=9, markeredgecolor="black")

    def update(self, first: int, last: int) -> None:
        """Shows the source at sample `last` with the trail from sample `first` on."""
        trail = self.points[first : last + 1]
        segments = np.stack([trail[:-1], trail[1:]], axis=1)
        colours = np.tile(to_rgba(SOURCE_COLOUR), (len(segments), 1))
        colours[:, 3] = np.linspace(0, 1, len(segments) + 1)[1:] if len(segments) else []
        self.trail.set_segments(segments)
        self.trail.set_color(colours)
        x, y, z = self.points[last]
        self.spoke.set_data_3d([0, x], [0, y], [0, z])
        self.point.set_data_3d([x], [y], [z])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("log", type=Path, nargs="?", help=f"session log (default: latest in {LOG_DIR})")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--fps", type=float, default=30, help="video frame rate; the video runs in session time")
    parser.add_argument("--trail", type=float, default=3, help="trail length in seconds")
    parser.add_argument("--start", type=float, help="session time to start at, in seconds")
    parser.add_argument("--end", type=float, help="session time to end at, in seconds")
    args = parser.parse_args()
    args.log = args.log or latest_log()
    print(f"log: {args.log}")

    log = load_log(args.log)
    samples = log["inertialSoundSamples"]
    if not samples:
        raise SystemExit(f"no inertial sound samples (condition: {log['condition']})")
    config = log["inertialSound"]

    t = session_time_sec(log, [sample["sceneTimeMs"] for sample in samples])
    rig = np.array([sample["sourceDirectionRig"] for sample in samples])
    head = np.array([sample["sourceDirectionHead"] for sample in samples])
    lag = np.array([sample["lagRotationVectorDeg"] for sample in samples])
    lag_fraction = np.array([sample["lagFraction"] for sample in samples])

    start = t[0] if args.start is None else args.start
    end = t[-1] if args.end is None else args.end
    video_times = np.arange(start, end, 1 / args.fps)

    figure = plt.figure(figsize=(12, 8), dpi=100)
    grid = figure.add_gridspec(2, 2, height_ratios=(3, 1))
    rig_axis = figure.add_subplot(grid[0, 0], projection="3d")
    head_axis = figure.add_subplot(grid[0, 1], projection="3d")
    timeline = figure.add_subplot(grid[1, :])
    figure.subplots_adjust(left=0.07, right=0.98, top=0.88, bottom=0.08, wspace=0, hspace=0.15)

    draw_sphere(rig_axis, "rig frame: place on the inertial sphere")
    draw_sphere(head_axis, "head frame: as heard")
    rest = to_plot(rest_direction(config["elevationDeg"]))
    rig_axis.plot(*rest[:, None], "x", color="black", markersize=8)
    rig_axis.text(*rest, "rest  ", fontsize=8, ha="right")
    markers = [SourceMarker(rig_axis, rig), SourceMarker(head_axis, head)]

    for index, name in enumerate(("pitch (x)", "yaw (y)", "roll (z)")):
        timeline.plot(t, lag[:, index], linewidth=1, label=f"lag {name}")
    timeline.set_xlim(start, end)
    timeline.set_ylabel("lag (deg, rig frame)")
    timeline.set_xlabel("session time (s)")
    timeline.legend(loc="upper right", fontsize=8)
    cursor = timeline.axvline(start, color="black", linewidth=1)
    trail_span = timeline.axvspan(start, start, color=SOURCE_COLOUR, alpha=0.15)

    rev = "revving" if config["revWithLag"] else "constant timbre"
    title = f"{log['condition']}   T={config['naturalPeriodMs'] / 1000:g}s, ζ={config['dampingRatio']:g}, {rev}"
    caption = figure.suptitle("")

    out = args.out or args.log.with_name(args.log.stem + "-replay")
    out.mkdir(parents=True, exist_ok=True)
    path = out / "sound-sphere.mp4"
    with imageio.get_writer(path, fps=args.fps, codec="libx264", macro_block_size=1) as writer:
        for number, time in enumerate(video_times):
            last = max(0, int(np.searchsorted(t, time, side="right")) - 1)
            first = int(np.searchsorted(t, time - args.trail))
            for marker in markers:
                marker.update(min(first, last), last)
            cursor.set_xdata([time, time])
            trail_span.set_x(t[min(first, last)])
            trail_span.set_width(t[last] - t[min(first, last)])
            caption.set_text(
                f"{title}\nt={time:.2f}s   lag yaw={lag[last, 1]:+.1f}°  pitch={lag[last, 0]:+.1f}°  "
                f"roll={lag[last, 2]:+.1f}°   rev={lag_fraction[last]:.2f}"
            )
            figure.canvas.draw()
            writer.append_data(np.asarray(figure.canvas.buffer_rgba())[..., :3])
            print(f"\rrendered {number + 1}/{len(video_times)}", end="", flush=True)
    print()
    plt.close(figure)
    print(f"written to {path}")


if __name__ == "__main__":
    main()
