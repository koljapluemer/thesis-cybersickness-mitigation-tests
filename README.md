# Optical Flow Test

A WebXR (A-Frame) app for testing cybersickness mitigations in two scenes: an
automatic helicopter flight along a scripted path over a 3D landscape, and a
car race the player drives from the cockpit. Works on desktop and in VR. Scene
and condition are chosen in the bottom-left selects or through the URL
(`?scene=car-race&condition=no-mitigation`), see `doc/scenes.md`.

## Origin of the codebase

This project was bootstrapped from a university template originally built for a
spatial-preposition VR exercise (see package name `acquire-propositions-3d` and
the `public/data` git submodule pointing at `acquire-prepositions-data`). Commit
`65239b8` ("take over structure from prepo repo") is the unmodified baseline:
plain Vite + TypeScript + A-Frame scaffold with no scene content. The flight
path and the landscape were then added for a cybersickness experiment, whose
head-locked HUD rotation indicators have since been removed.

## Core files

| File | Role |
|---|---|
| `src/main.ts` | Builds `<a-scene>` around the selected test scene and wires the flow recorder, its button and the scene and condition selects. |
| `src/scenes/` | Test scene registry (`SCENES`), the shared rig markup, scene and condition selection through the URL, and the scene select. See `doc/scenes.md`. |
| `src/tour-flight.ts` | `tour-flight` component that flies the camera rig along the path (Mountain Flight). |
| `src/car-race/` | Car Race: `car-drive` component, car physics (dynamic bicycle model), wall collision and keyboard / thumbstick input. See `doc/scenes.md`. |
| `src/rig-fixed.ts` | `rig-fixed` component: puts geometry that moves with the rig (the car body) on its own render layer, which the flow meter measures separately. |
| `src/optical-flow/` | Live optical flow measurement (`optical-flow` A-Frame system) and session recorder. See `doc/optical-flow.md`. |
| `src/turn-cues/` | Turn cues (`turn-cues` A-Frame system): turn strength from the live rig-induced flow or from the rig's angular acceleration about its local up axis → detector → left/right stereo tone, or a continuous tone whose per-ear loudness follows the turn strength. See `doc/turn-cues.md`. |
| `src/conditions/` | Experimental conditions (`condition` A-Frame system): registry of conditions, each configuring every mitigation system, plus the DOM select and the VR controller cycling to switch them. See `doc/conditions.md`. |
| `src/rig-kinematics/` | `rig-kinematics` A-Frame system: per-frame rig orientation and angular velocity (world frame), and the yaw rate and angular acceleration about the rig's local up axis. |
| `src/inertial-sound/` | Inertial motor sound (`inertial-sound` A-Frame system): an HRTF-spatialized, world-anchored motor sound on a sphere that follows the rig's rotation through a spring and damper, so it swings out when the rig's rotation accelerates. See `doc/inertial-sound.md`. |
| `src/rig.ts` | Finds the rig (the camera entity's parent) and the head's world matrix; shared by `optical-flow`, `rig-kinematics` and `inertial-sound`. Also the rig teleport signal (`announceRigTeleport`). |
| `src/rotation.ts` | Quaternion ↔ rotation vector (log/exp map). |
| `src/audio/` | `audio` A-Frame system: the scene's shared, gesture-unlocked `AudioContext`. |
| `src/recording-button.ts` | Start/stop button for flow recording; stopping downloads the session log as JSON. |
| `doc/optical-flow.md` | How flow tracking, the live API, the log format and offline validation work. |
| `doc/turn-cues.md` | Turn cue pipeline, configuration and audio unlock. |
| `doc/inertial-sound.md` | Inertial sound: model, sound, configuration and logging. |
| `doc/conditions.md` | Experimental conditions: architecture, switching, adding conditions and mitigations. |
| `doc/scenes.md` | Test scenes: selection and URL, architecture, rig teleports and rig-fixed geometry, the Car Race controls, car model and assets, adding a scene. |
| `analysis/` | uv project; `replay_session.py` replays a session log offline, validates the live flow measurement and compares it with the pose kinematics. |
| `doc/pose-flow-agreement.md` | Rig and head kinematics from the logged poses and the statistics of their agreement with the optical flow. |
| `src/style.css` | Fullscreen layout reset for the embedded `<a-scene>`. |
| `index.html` | Entry point, mounts the scene into `#app`, loads a GoatCounter analytics beacon. |
| `public/tour-path.json` | `{ duration, points: [{ t, position }] }` — the pre-baked flight path (600 samples over 120 s, `duration` must equal the last `t`), flown as a closed loop with Catmull-Rom interpolation at runtime. |
| `public/export_tour_path.py` | Blender script: samples a curve object named `TourPath` in a `.blend` file and exports it to `tour-path.json`, converting Blender's Z-up axis convention to A-Frame's Y-up. Run inside Blender's scripting console, not part of the app build. |
| `public/mountains/` | The glTF landscape flown over. |
| `public/car-race/` | Race track and formula car (glTF, CC0) and `track.json` with walls, spawn and car dimensions. |
| `issues/` | Free-form dev notes/TODOs, not formal issue tracking. |

## Scene structure

Each test scene (`doc/scenes.md`) supplies the world and what moves the rig;
the rig itself (camera and right controller) and all systems are shared.

- **`tour-flight` component** (Mountain Flight) — drives the camera rig. On `init` it fetches
  `tour-path.json`; on every `tick` it samples the current position and a
  short look-ahead position (`samplePath`, time-parameterized Catmull-Rom
  spline through the keyframes, looping seamlessly via a closing segment back
  to the first keyframe), transforms both into world space (`applyWorldTransform`: scale →
  rotate by a fixed `rotationY` → offset), then sets `object3D.position` and
  calls `object3D.lookAt(lookTarget)` before applying a fixed pitch tilt. This
  is what makes the camera *bank and turn on its own*.
- **`car-drive` component** (Car Race) — drives the car entity from
  keyboard or thumbstick input with a planar car model and wall collision.
  The rig is the seat inside the car.
- The `<a-camera>` is nested inside the rig with
  `wasd-controls-enabled="false"`. In Mountain Flight the user cannot steer,
  only rotate their view; in Car Race WASD drives the car. In VR mode, WebXR writes the headset's real orientation onto the camera
  object on top of whatever the `tour-flight` component sets on its parent. On
  desktop, A-Frame's default `look-controls` provide mouse-drag look as a
  debugging stand-in for head rotation (recorded as head motion, like in VR).
- **`optical-flow` system** (configured on `<a-scene>`) — measures the optical
  flow of every rendered frame per eye, split into total flow and flow caused
  by the rig motion alone. Its API is `getOpticalFlow(sceneEl)`. The
  "Record optical flow" button logs every frame and downloads the log as JSON.
  Details: `doc/optical-flow.md`.
- **`turn-cues` system** (configured on `<a-scene>`) — detects turns from the
  live rig-induced flow or the rig's angular acceleration and plays an 800 Hz
  tone on the left or right channel.
  Configured by the selected condition. Details: `doc/turn-cues.md`.
- **`inertial-sound` system** (configured on `<a-scene>`) — a motor sound
  that lags behind the rig's rotation, world-anchored and spatialized.
  Configured by the selected condition. Details: `doc/inertial-sound.md`.
- **`condition` system** (`condition="…"` on `<a-scene>`) — the experimental
  condition (No Mitigation, and Turn Tone / Flexible Tone each from Optical Flow
  or Rig Angular Acceleration, Inertial Motor Sound with constant or revving pitch), switchable with the select in the
  bottom-left corner or, in VR, cycled with B on the right controller. Locked
  while recording. Independent of the scene.
  Details: `doc/conditions.md`.

## Running

```bash
npm install
npm run build   # tsc + vite build
npm run lint
```

(Do not run `npm run dev` / `vite` in this environment — see `CLAUDE.md`.)
