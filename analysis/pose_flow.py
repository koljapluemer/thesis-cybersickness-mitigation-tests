"""Pose-derived kinematics vs. the live optical flow measurement of a session.

Writes into the output directory:
    kinematics.png          rig and head kinematics over the session
    agreement-<pair>.png    per pair: time series, scatter, Bland-Altman, cross-correlation,
                            coherence, rolling correlation, residual regression
    agreement-summary.png   correlation-type statistics of all pairs with CIs
    agreement.json          all statistics
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from agreement import Pair, compare, plot_pair, plot_summary, resample
from kinematics import plot_kinematics, pose_kinematics

PAIRS = [
    Pair(
        name="rig-yaw-lateral-flow",
        x="rigYawRate",
        y="rigLateralFlow",
        x_label="rig yaw rate (+left)",
        y_label="rig-induced lateral flow, mean of halves (+right)",
        unit="°/s",
        same_units=True,
        covariates=("coverage", "headPitch", "absHeadYaw", "rigSpeed", "rigPitchRate"),
    ),
    Pair(
        name="rig-yaw-shared-lateral-flow",
        x="rigYawRate",
        y="rigSharedLateralFlow",
        x_label="rig yaw rate (+left)",
        y_label="rig-induced shared lateral flow (+right)",
        unit="°/s",
        same_units=True,
        covariates=("coverage", "headPitch", "absHeadYaw", "rigSpeed", "rigPitchRate"),
    ),
    Pair(
        name="head-yaw-head-lateral-flow",
        x="headYawRate",
        y="headLateralFlow",
        x_label="head yaw rate in rig (+left)",
        y_label="head-induced lateral flow, total − rig-induced (+right)",
        unit="°/s",
        same_units=True,
        covariates=("coverage", "headPitch", "rigAngularSpeed"),
    ),
    Pair(
        name="rig-angular-speed-mean-flow",
        x="rigAngularSpeed",
        y="rigMeanFlow",
        x_label="rig angular speed",
        y_label="rig-induced mean flow speed",
        unit="°/s",
        same_units=False,
    ),
]


def lateral(horizontal: dict) -> float:
    return (horizontal["leftMeanDegPerSec"] + horizontal["rightMeanDegPerSec"]) / 2


def shared_lateral(horizontal: dict) -> float:
    """Lateral flow both view halves share: the smaller one if they agree in sign, else 0."""
    left, right = horizontal["leftMeanDegPerSec"], horizontal["rightMeanDegPerSec"]
    return float(np.sign(left) * min(abs(left), abs(right))) if np.sign(left) == np.sign(right) else 0.0


def flow_measures(frames: list[dict]) -> dict[str, np.ndarray]:
    """Per-frame measures from the live combined flow measurement, NaN on unmeasured frames."""
    names = ("rigLateralFlow", "rigSharedLateralFlow", "headLateralFlow", "rigMeanFlow", "coverage")
    out = {name: np.full(len(frames), np.nan) for name in names}
    for i, frame in enumerate(frames):
        if frame["flow"] is None:
            continue
        combined = frame["flow"]["combined"]
        rig, total = combined["rigInduced"], combined["total"]
        out["rigLateralFlow"][i] = lateral(rig["horizontal"])
        out["rigSharedLateralFlow"][i] = shared_lateral(rig["horizontal"])
        out["headLateralFlow"][i] = lateral(total["horizontal"]) - lateral(rig["horizontal"])
        out["rigMeanFlow"][i] = rig["meanDegPerSec"]
        out["coverage"][i] = combined["coverage"]
    return out


def json_ready(result: dict) -> dict:
    return {key: value for key, value in result.items() if key != "plot"}


def analyse(log: dict, out: Path) -> dict:
    frames = log["frames"]
    kinematics = pose_kinematics(frames)
    plot_kinematics(log, kinematics, out / "kinematics.png")

    columns = kinematics | flow_measures(frames) | {"absHeadYaw": np.abs(kinematics["headYaw"])}
    rate_hz = 1000 / np.median([frame["deltaMs"] for frame in frames])
    series = resample(np.array([frame["timeMs"] / 1000 for frame in frames]), columns, rate_hz)

    results = {}
    for pair in PAIRS:
        result = compare(series, pair)
        results[pair.name] = result
        if "skipped" in result:
            print(f"{pair.name}: skipped, {result['skipped']}")
            continue
        plot_pair(pair, result, out / f"agreement-{pair.name}.png")
    plot_summary(PAIRS, results, out / "agreement-summary.png")

    summary = {
        "resampleRateHz": rate_hz,
        "segments": int(series.segment.max() + 1),
        "pairs": {name: json_ready(result) for name, result in results.items()},
    }
    (out / "agreement.json").write_text(json.dumps(summary, indent=2))
    return summary
