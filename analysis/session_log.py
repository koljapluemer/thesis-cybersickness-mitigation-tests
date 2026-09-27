"""Loading session logs written by the app's optical flow recorder."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

REPO_DIR = Path(__file__).resolve().parent.parent
LOG_DIR = REPO_DIR / "log"
LOG_VERSION = 6


def mat4(values: list[float]) -> np.ndarray:
    """Column-major three.js matrix array -> 4x4 numpy matrix."""
    return np.asarray(values, dtype=np.float64).reshape(4, 4).T


def latest_log() -> Path:
    # File names carry ISO timestamps, so lexical order is chronological.
    logs = sorted(LOG_DIR.glob("optical-flow-*.json"))
    if not logs:
        raise SystemExit(f"no optical-flow-*.json logs in {LOG_DIR}")
    return logs[-1]


def load_log(path: Path) -> dict:
    log = json.loads(path.read_text())
    if log.get("version") != LOG_VERSION:
        raise SystemExit(f"log format version {log.get('version')} is not supported (expected {LOG_VERSION})")
    return log


def session_time_sec(log: dict, scene_times_ms: list[float]) -> np.ndarray:
    """Scene times (as keyed by samples and signals) -> session time in seconds, via the frames."""
    frames = log["frames"]
    return np.interp(scene_times_ms, [frame["sceneTimeMs"] for frame in frames], [frame["timeMs"] / 1000 for frame in frames])
