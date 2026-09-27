# Optical flow tracking

How the app measures the optical flow shown to the user, how to use the
measurement live, what the session log contains, and how to check it offline.

## What is measured

**Screen flow, in the eye's frame of reference.** For every pixel of a
low-resolution copy of each view, the visible surface point is reprojected into the
previous frame's view. The angle between the two viewing directions, divided by
the frame time, is that pixel's angular velocity in °/s. This is the flow on the
display, assuming the eye is fixed in the head. There is no eye-tracking API in
WebXR, so the rotation of the eye itself (smooth pursuit) is not accounted for.

The world is static, so its flow comes from camera motion alone. Geometry
that moves with the rig (`rig-fixed`, e.g. the car body in Car Race) is
handled separately, see below. The flow is computed exactly from geometry
(depth and the two camera poses), not estimated from pixels.

**Two components, each a complete field of its own:**

- **total**: all flow on the display, from the scripted rig (vehicle) motion plus
  the user's own head motion in VR. What the user actually sees; for analysis.
- **rigInduced**: the flow the rig motion alone would have produced. The previous
  eye pose is recomputed with the head pose relative to the rig held fixed:
  `prevRig · rig⁻¹ · eye`. This is the part of the flow that has no matching
  vestibular signal, which is what matters for cybersickness, and what drives
  countermeasures such as the turn cues (`doc/turn-cues.md`). On desktop there
  is no head motion, so `rigInduced == total`.

The rig is whatever the camera entity is mounted on
(`camera.el.object3D.parent`): the `tour-flight` entity in Mountain Flight,
the seat inside the car in Car Race (see `scenes.md`).

**Rig-fixed geometry** moves with the rig, so a point P on it was at
`prevRig · rig⁻¹ · P` in the previous frame. Its total flow is the head's
motion relative to the rig only, and its rig-induced flow is zero: from the
rig-only previous eye pose it looks exactly as it does now.

**Background:** Pixels without geometry are the uniform background colour. Nothing
visible moves there, so they count as 0 °/s in means. They are reported
separately through `coverage`. (The former `<a-sky>` was removed; it duplicated
the scene background.)

## Pipeline (per rendered frame)

Code lives in `src/optical-flow/`.

1. `optical-flow-system.ts` (A-Frame system `optical-flow`, runs in `tock`, i.e.
   after the main render):
   - Collects the active views. In XR these are the two eye cameras from
     `renderer.xr.getCamera().cameras`; on desktop it is the scene camera.
   - Per view, re-renders the scene into a small `FloatType` render target with
     two color attachments (0 = total, 1 = rigInduced; height `fieldHeight`,
     default 64; width follows the view's aspect). It uses
     `scene.overrideMaterial` = the flow material and temporarily disables XR,
     background and auto-clear, then restores them. Two passes share the
     depth buffer: the world (every layer the camera sees except
     `RIG_FIXED_LAYER`), then the rig-fixed layer with the transforms for
     rig-fixed geometry (current→previous eye `prevEye⁻¹ · prevRig · rig⁻¹ ·
     eye`, rig-only transform identity). Without rig-fixed geometry the second
     pass renders nothing.
   - Queues an async GPU→CPU readback of both attachments
     (`readRenderTargetPixelsAsync`: pixel buffer object + fence, no stall).
   - Emits `onFrame` synchronously with the poses used.
2. `flow-material.ts`: vertex shader transforms each vertex into current eye
   space, previous eye space and "rig-only" previous eye space. The CPU passes
   the current→previous eye transforms as near-identity matrices computed in
   float64, which keeps float32 precision good for tiny per-frame motions. The
   fragment shader writes both fields (layout below). Angles use
   `atan(|a×b|, a·b)`, which is accurate for small angles, unlike `acos`.
3. `flow-stats.ts`: when the readback arrives, the per-pixel values are reduced
   to a `FlowMeasurement` and `onSample` fires, usually a few ms / 1–3 frames
   after `onFrame`.
   - Pixels are weighted by the solid angle they subtend (cos³ of their angle to
     the optical axis), so means are per visual field area, not per pixel.
   - Per component: mean and max angular speed, eccentricity bands (0–10°,
     10–30°, 30°+ from the view's forward axis, `ECCENTRICITY_BANDS_DEG`), and
     the mean signed horizontal angular velocity over the covered pixels of the
     left and right half of the view (`horizontal`). A pure yaw moves both
     halves alike, forward motion moves them apart.
   - The combined measurement is the mean over views (both eyes).

A frame is not measured (`flow: null` in the log) when the view layout changes
(entering or leaving VR), on the very first frame, because there is no
previous pose, and when the rig teleported (`scenes.md`), because the flow
would be the jump.

### Flow field layout

One field per view and component (`ViewFlow.fields.total`, `.rigInduced`). A
`Float32Array`, row-major, bottom row first (WebGL order), 4 channels per pixel:

| ch | meaning |
|---|---|
| 0, 1 | flow in NDC units per second (x right, y up), i.e. direction on screen |
| 2 | angular speed, °/s |
| 3 | signed horizontal angular velocity (change of eye-space azimuth), °/s, positive = rightward. Independent of depth for a pure yaw. |

Pixels without geometry: `(0, 0, -1, 0)`.

## Live API (for countermeasures)

```ts
import { getOpticalFlow } from './optical-flow/optical-flow-system';

const flow = getOpticalFlow(sceneEl);

flow.latest;                         // FlowSample | null, most recent measurement
const stop = flow.onSample((s) => {  // every measured frame
  s.combined.rigInduced.meanDegPerSec;          // overall "conflict" flow
  s.combined.rigInduced.bands[2].meanDegPerSec; // peripheral (30°+) conflict flow
  s.combined.rigInduced.horizontal;             // left/right half lateral flow
  s.views[0].fields.rigInduced;                 // raw per-pixel field, see above
});
flow.onFrame((f) => { /* poses of every rendered frame, synchronous */ });
await flow.flush();                  // wait for in-flight readbacks
```

Types are in `src/optical-flow/types.ts`. Configure it on the scene:
`optical-flow="enabled: true; fieldHeight: 64"`.

Cost: one extra render of the scene per view at 64×~64 px per frame (two
color attachments), plus two 64 KB readbacks per view. This should be negligible on a Quest, but it has not
been profiled on a device yet.

## Session log

The button in the top-left corner starts and stops recording
(`src/recording-button.ts`). Stopping waits for pending measurements and then
downloads `optical-flow-<ISO date>.json`. It is built by `session-recorder.ts`
(`SessionLog`, format version 9):

- `flowMeter`: field height, band limits, channel names, snapshot interval.
- `condition`: the experimental condition id (see `conditions.md`). It is
  locked while recording, so there is one per log.
- `turnCues`: the effective `turn-cues` configuration under that condition.
- `inertialSound`: the effective `inertial-sound` configuration under that
  condition.
- `scene`: the scene `id`, `staticModels` (glTF path and world matrix),
  `rigFixedModels` (glTF path and matrix relative to the rig), and `motion`
  (the component moving the rig and its settings). Together with the
  per-frame poses, this is enough to re-render every frame offline.
- `events`: `enter-vr` / `exit-vr`, `rig-teleport` (with the `sceneTimeMs`
  of the frame the rig jumped into), and `turn-cue` (direction, triggering
  turn strength, whether it was presented) with times.
- `turnSignals[]`: every turn-strength sample of the cue detector, raw
  (`strength`) and `smoothed`, keyed by `sceneTimeMs`, in the unit of the
  configured source (see `turn-cues.md`).
- `inertialSoundSamples[]`: one per frame while the inertial sound is
  enabled, else empty: `lagRotationVectorDeg` (the source's lag, rig frame, rotation mode),
  `offsetRigM` (the source's offset, rig frame, translation mode), `sourcePositionRig`,
  `sourcePositionHead` and `lagFraction`, keyed by `sceneTimeMs` (see `inertial-sound.md`).
- `frames[]`, one per rendered frame:
  - `timeMs` (since recording start), `sceneTimeMs`, `deltaMs`, `xrPresenting`
  - `sceneState`: scene-specific state (`pathTimeSec` in Mountain Flight; speed,
    yaw rate, steering angle and input in Car Race, see `scenes.md`)
  - `rigMatrixWorld`, `views[]` (eye, camera `matrixWorld`, `projectionMatrix`,
    field size); all matrices column-major, as in three.js
  - `flow`: combined and per-view `FlowMeasurement`, or `null` if not measured
  - `fields` (every `fieldSnapshotIntervalMs`, default 500 ms): the raw live
    flow fields of both components per view (`total`, `rigInduced`) as base64
    little-endian float32. Their only purpose is to validate the live
    measurement offline.

Size is roughly 6 MB per 10 s on desktop, almost all of it field snapshots
(about 155 KB per component for a 114×64 view). Per-frame poses and measurements add
about 2 KB per frame on desktop.

## Offline replay and validation

`analysis/replay_session.py` (uv project in `analysis/`):

```bash
cd analysis
uv run replay_session.py ~/Downloads/optical-flow-….json            # snapshot frames only
uv run replay_session.py ~/Downloads/optical-flow-….json --all-frames --every 5
```

It loads the scene's glTF models with trimesh (static ones with their world
matrix, rig-fixed ones in rig coordinates) and ray casts every flow pixel
(Embree) from the logged eye poses; rig-fixed models are hit in rig space and
the nearest hit wins. From that it recomputes both flow fields independently
of the browser, rig-fixed hits as described above, and writes:

- `timeseries.png`: live total vs. rig-induced mean, eccentricity bands,
  coverage, frame time, XR and teleport events, and the turn signal with
  thresholds and cues.
- `frames/*.png` and `replay.mp4`, four panels per view:
  - a textured reconstruction of what the user saw
  - live flow (hue = direction, brightness = speed, arrows = screen motion over
    0.1 s)
  - recomputed flow
  - |live − recomputed| (white = 5 °/s; magenta = coverage disagreement)
- `validation.json`: error statistics per snapshot and component (angular
  speed and horizontal channel).
- `kinematics.png`, `agreement-*.png`, `agreement.json`: rig and head
  kinematics derived from the poses, and how far the live flow agrees with
  them. See `pose-flow-agreement.md`.

A first desktop recording (log format 1) (headless Chrome, 107 frames) gave:

- coverage agreement 99.999%
- median absolute error 0.003 °/s
- 95th percentile 0.01 °/s
- mean flow 13–42 °/s

## Known limitations

- **VR is untested on a device.** The per-eye path (`xr.getCamera().cameras`,
  rendering inside the XR frame) follows three.js' XR code, but it has only run
  on desktop so far.
- **Visibility of flow is ignored.** Every visible surface point counts, whether
  or not it has texture or contrast. Weighting by local image contrast would be
  a possible next step.
- **No eye tracking:** retinal flow under smooth pursuit is not modelled.
- **Rig-fixed geometry is only validated synthetically:** the replay's
  handling of the car body was checked on constructed frames (car pixels
  carry only the head's own motion), not yet against a live car-race
  recording.
- **Seam of the flight loop:** the exported path is not exactly closed; the
  closing segment from the last keyframe back to the first has a small (~5°)
  kink, which shows up as a brief bump in flow once per lap.
- **Units:** the field's NDC channels are per second, so screen-space direction
  and speed depend on the view's projection. The angular channels do not.
