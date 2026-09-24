# Optical Flow Test

A WebXR (A-Frame) scene that auto-flies the viewer along a scripted path over a
3D landscape ("helicopter flight"). Works on desktop and in VR.

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
| `src/main.ts` | Scene markup and wiring of the flow recorder, its button and the condition select. |
| `src/tour-flight.ts` | `tour-flight` component that flies the camera rig along the path. |
| `src/optical-flow/` | Live optical flow measurement (`optical-flow` A-Frame system) and session recorder. See `doc/optical-flow.md`. |
| `src/turn-cues/` | Turn cues (`turn-cues` A-Frame system): turn rate from the live rig-induced flow → detector → left/right stereo tone, or a continuous tone whose per-ear loudness follows the turn rate. See `doc/turn-cues.md`. |
| `src/conditions/` | Experimental conditions (`condition` A-Frame system): registry of conditions, each configuring every mitigation system, plus the DOM select and the VR controller cycling to switch them. See `doc/conditions.md`. |
| `src/audio/` | `audio` A-Frame system: the scene's shared, gesture-unlocked `AudioContext`. |
| `src/recording-button.ts` | Start/stop button for flow recording; stopping downloads the session log as JSON. |
| `doc/optical-flow.md` | How flow tracking, the live API, the log format and offline validation work. |
| `doc/turn-cues.md` | Turn cue pipeline, configuration and audio unlock. |
| `doc/conditions.md` | Experimental conditions: architecture, switching, adding conditions and mitigations. |
| `analysis/` | uv project; `replay_session.py` replays a session log offline, validates the live flow measurement and compares it with the pose kinematics. |
| `doc/pose-flow-agreement.md` | Rig and head kinematics from the logged poses and the statistics of their agreement with the optical flow. |
| `src/style.css` | Fullscreen layout reset for the embedded `<a-scene>`. |
| `index.html` | Entry point, mounts the scene into `#app`, loads a GoatCounter analytics beacon. |
| `public/tour-path.json` | `{ duration, points: [{ t, position }] }` — the pre-baked flight path (600 samples over 120 s, `duration` must equal the last `t`), flown as a closed loop with Catmull-Rom interpolation at runtime. |
| `public/export_tour_path.py` | Blender script: samples a curve object named `TourPath` in a `.blend` file and exports it to `tour-path.json`, converting Blender's Z-up axis convention to A-Frame's Y-up. Run inside Blender's scripting console, not part of the app build. |
| `public/mountains/` | The glTF landscape flown over. |
| `issues/` | Free-form dev notes/TODOs, not formal issue tracking. |

## Scene structure

- **`tour-flight` component** — drives the camera rig. On `init` it fetches
  `tour-path.json`; on every `tick` it samples the current position and a
  short look-ahead position (`samplePath`, time-parameterized Catmull-Rom
  spline through the keyframes, looping seamlessly via a closing segment back
  to the first keyframe), transforms both into world space (`applyWorldTransform`: scale →
  rotate by a fixed `rotationY` → offset), then sets `object3D.position` and
  calls `object3D.lookAt(lookTarget)` before applying a fixed pitch tilt. This
  is what makes the camera *bank and turn on its own*.
- The `<a-camera>` is nested inside the `tour-flight` entity with
  `wasd-controls-enabled="false"`: the user cannot steer, only rotate their
  view. In VR mode, WebXR writes the headset's real orientation onto the camera
  object on top of whatever the `tour-flight` component sets on its parent. On
  desktop, A-Frame's default `look-controls` provide mouse-drag look as a
  debugging stand-in for head rotation (recorded as head motion, like in VR).
- **`optical-flow` system** (configured on `<a-scene>`) — measures the optical
  flow of every rendered frame per eye, split into total flow and flow caused
  by the rig motion alone. Its API is `getOpticalFlow(sceneEl)`. The
  "Record optical flow" button logs every frame and downloads the log as JSON.
  Details: `doc/optical-flow.md`.
- **`turn-cues` system** (configured on `<a-scene>`) — detects turns from the
  live rig-induced flow and plays an 800 Hz tone on the left or right channel.
  Configured by the selected condition. Details: `doc/turn-cues.md`.
- **`condition` system** (`condition="…"` on `<a-scene>`) — the experimental
  condition (No Mitigation, Turn Tones, Flexible Tone), switchable with the select in the
  bottom-left corner or, in VR, cycled with B on the right controller. Locked
  while recording.
  Details: `doc/conditions.md`.

## Running

```bash
npm install
npm run build   # tsc + vite build
npm run lint
```

(Do not run `npm run dev` / `vite` in this environment — see `CLAUDE.md`.)
