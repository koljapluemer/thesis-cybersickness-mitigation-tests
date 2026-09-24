"""Rig and head kinematics from the logged poses.

The rig is the camera's parent (the `tour-flight` entity), the head is the
camera relative to the rig. Rates are taken between consecutive frames over the
frame's `deltaMs`, the same discretisation as the optical flow, so both are
directly comparable. Signs: yaw positive = left (counter-clockwise seen from
above, same as the image moving right), pitch positive = up.
"""

from __future__ import annotations

import matplotlib.pyplot as plt
import numpy as np

from session_log import mat4

# Per-frame measures: name -> (axis label, unit).
MEASURES = {
    "rigYawRate": ("rig yaw rate about world up (+left)", "°/s"),
    "rigPitchRate": ("rig pitch rate (+up)", "°/s"),
    "rigAngularSpeed": ("rig angular speed", "°/s"),
    "rigSpeed": ("rig linear speed", "m/s"),
    "rigAcceleration": ("rig linear acceleration magnitude", "m/s²"),
    "headYaw": ("head yaw in rig (+left)", "°"),
    "headPitch": ("head pitch in rig (+up)", "°"),
    "headYawRate": ("head yaw rate in rig (+left)", "°/s"),
    "headAngularSpeed": ("head angular speed in rig", "°/s"),
}


def heading_and_pitch(rotation: np.ndarray) -> tuple[float, float]:
    """Yaw (+left) and pitch (+up) in degrees of a frame's forward axis (-z)."""
    forward = -rotation[:, 2]
    return (
        float(np.degrees(np.arctan2(-forward[0], -forward[2]))),
        float(np.degrees(np.arcsin(np.clip(forward[1], -1, 1)))),
    )


def rotation_angle_deg(rotation: np.ndarray) -> float:
    """Angle of a rotation matrix, accurate for small angles."""
    axis = np.array([rotation[2, 1] - rotation[1, 2], rotation[0, 2] - rotation[2, 0], rotation[1, 0] - rotation[0, 1]])
    return float(np.degrees(np.arctan2(np.linalg.norm(axis), np.trace(rotation) - 1)))


def wrap_deg(angle: float) -> float:
    return (angle + 180) % 360 - 180


def pose_kinematics(frames: list[dict]) -> dict[str, np.ndarray]:
    """Per-frame kinematic measures, NaN where a rate has no directly preceding frame."""
    n = len(frames)
    out = {name: np.full(n, np.nan) for name in MEASURES}
    rig = [mat4(frame["rigMatrixWorld"]) for frame in frames]
    # Both eyes share the head's orientation, so the first view stands for the head.
    head = [r[:3, :3].T @ mat4(frame["views"][0]["matrixWorld"])[:3, :3] for r, frame in zip(rig, frames)]
    velocity = np.full((n, 3), np.nan)

    for i, frame in enumerate(frames):
        out["headYaw"][i], out["headPitch"][i] = heading_and_pitch(head[i])
        if i == 0 or frames[i - 1]["frame"] != frame["frame"] - 1:
            continue
        dt = frame["deltaMs"] / 1000
        rig_yaw, rig_pitch = heading_and_pitch(rig[i][:3, :3])
        prev_rig_yaw, prev_rig_pitch = heading_and_pitch(rig[i - 1][:3, :3])
        out["rigYawRate"][i] = wrap_deg(rig_yaw - prev_rig_yaw) / dt
        out["rigPitchRate"][i] = (rig_pitch - prev_rig_pitch) / dt
        out["rigAngularSpeed"][i] = rotation_angle_deg(rig[i - 1][:3, :3].T @ rig[i][:3, :3]) / dt
        velocity[i] = (rig[i][:3, 3] - rig[i - 1][:3, 3]) / dt
        out["rigSpeed"][i] = np.linalg.norm(velocity[i])
        out["headYawRate"][i] = wrap_deg(out["headYaw"][i] - out["headYaw"][i - 1]) / dt
        out["headAngularSpeed"][i] = rotation_angle_deg(head[i - 1].T @ head[i]) / dt
        if np.isfinite(velocity[i - 1, 0]):
            # Velocities are means over their frame intervals, whose centres are half of both intervals apart.
            spacing = (frame["deltaMs"] + frames[i - 1]["deltaMs"]) / 2000
            out["rigAcceleration"][i] = np.linalg.norm(velocity[i] - velocity[i - 1]) / spacing

    return out


def plot_kinematics(log: dict, kinematics: dict[str, np.ndarray], path) -> None:
    t = np.array([frame["timeMs"] / 1000 for frame in log["frames"]])
    rows = [
        ("rig rotation (°/s)", ["rigYawRate", "rigPitchRate", "rigAngularSpeed"]),
        ("rig translation", ["rigSpeed", "rigAcceleration"]),
        ("head in rig (°)", ["headYaw", "headPitch"]),
        ("head rotation in rig (°/s)", ["headYawRate", "headAngularSpeed"]),
    ]
    figure, axes = plt.subplots(len(rows), 1, figsize=(12, 11), sharex=True)
    for axis, (label, names) in zip(axes, rows):
        for index, name in enumerate(names):
            description, unit = MEASURES[name]
            target = axis if index == 0 or MEASURES[names[0]][1] == unit else axis.twinx()
            target.plot(t, kinematics[name], color=f"C{index}", linewidth=0.9, label=f"{description} ({unit})")
            if target is not axis:
                target.set_ylabel(unit, color=f"C{index}")
                target.legend(loc="upper left", fontsize=8)
        axis.set_ylabel(label)
        axis.axhline(0, color="grey", linewidth=0.5)
        axis.legend(loc="upper right", fontsize=8)
    for event in log["events"]:
        if event["type"] != "turn-cue":
            for axis in axes:
                axis.axvline(event["timeMs"] / 1000, color="grey", linestyle=":")
    axes[-1].set_xlabel("session time (s)")
    figure.tight_layout()
    figure.savefig(path, dpi=110)
    plt.close(figure)
