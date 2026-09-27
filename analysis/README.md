# Analysis

Offline tools for session logs downloaded from the app ("Record optical flow" button).

```bash
uv run replay_session.py path/to/optical-flow-<date>.json [--out DIR] [--all-frames] [--every N]
```

This replays the session from the logged poses, recomputes the optical flow independently
of the browser, and compares it with the live measurement. See `../doc/optical-flow.md`.
It also derives rig and head kinematics from the logged poses and measures how far the live
flow agrees with them. See `../doc/pose-flow-agreement.md`.

```bash
uv run sound_sphere.py path/to/optical-flow-<date>.json [--out DIR] [--fps N] [--trail SEC] [--start SEC] [--end SEC]
```

For logs of the `inertial-motor-sound` condition: animates the motor sound's source as a point
with a fading trail on its sphere, in the rig frame and in the head frame, into `sound-sphere.mp4`.
See `../doc/inertial-sound.md`.
