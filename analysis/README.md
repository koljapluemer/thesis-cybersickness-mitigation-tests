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

For logs of the `inertial-motor-sound-*` conditions: animates the motor sound's source as a point
with a fading trail around the listener, in the rig frame and in the head frame, into `sound-sphere.mp4`.
For the linear condition, a third panel shows the source's offset from its rest position from above.
See `../doc/inertial-sound.md`.

```bash
uv run ambient_sound.py path/to/optical-flow-<date>.json [--out DIR] [--fps N] [--trail SEC] [--start SEC] [--end SEC] [--width PX]
```

For Big Room logs: animates every ambient sound source as where its object is and where it is heard,
in the scene ray-cast from the logged view, on the head-frame sphere and on a map of the room from above,
with timelines of the inertial ambience's lag, into `ambient-sound.mp4`. Under the `inertial-ambience-*`
conditions the two differ by the lag rotation; otherwise they coincide. See `../doc/inertial-ambience.md`.
