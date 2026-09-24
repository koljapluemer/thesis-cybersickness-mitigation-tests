# Analysis

Offline tools for session logs downloaded from the app ("Record optical flow" button).

```bash
uv run replay_session.py path/to/optical-flow-<date>.json [--out DIR] [--all-frames] [--every N]
```

This replays the session from the logged poses, recomputes the optical flow independently
of the browser, and compares it with the live measurement. See `../doc/optical-flow.md`.
It also derives rig and head kinematics from the logged poses and measures how far the live
flow agrees with them. See `../doc/pose-flow-agreement.md`.
