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
| `src/main.ts` | Entire application: scene bootstrap + all A-Frame components/shaders. Single file by design (see `AGENTS.md`). |
| `src/style.css` | Fullscreen layout reset for the embedded `<a-scene>`. |
| `index.html` | Entry point, mounts the scene into `#app`, loads a GoatCounter analytics beacon. |
| `public/tour-path.json` | `{ duration, points: [{ t, position }] }` — the pre-baked flight path (600 samples over 120s), keyframe-interpolated at runtime. |
| `public/export_tour_path.py` | Blender script: samples a curve object named `TourPath` in a `.blend` file and exports it to `tour-path.json`, converting Blender's Z-up axis convention to A-Frame's Y-up. Run inside Blender's scripting console, not part of the app build. |
| `public/mountains/` | The glTF landscape flown over. |
| `issues/` | Free-form dev notes/TODOs, not formal issue tracking. |

## Scene structure (`src/main.ts`)

- **`tour-flight` component** — drives the camera rig. On `init` it fetches
  `tour-path.json`; on every `tick` it samples the current position and a
  short look-ahead position (`samplePath`, linear interpolation between
  keyframes), transforms both into world space (`applyWorldTransform`: scale →
  rotate by a fixed `rotationY` → offset), then sets `object3D.position` and
  calls `object3D.lookAt(lookTarget)` before applying a fixed pitch tilt. This
  is what makes the camera *bank and turn on its own*.
- The `<a-camera>` is nested inside the `tour-flight` entity with
  `look-controls-enabled="false"` and `wasd-controls-enabled="false"`: the user
  cannot steer, only physically rotate their head inside the HMD. In VR mode,
  WebXR still writes the headset's real orientation onto the camera object on
  top of whatever the `tour-flight` component sets on its parent.

## Running

```bash
npm install
npm run build   # tsc + vite build
npm run lint
```

(Do not run `npm run dev` / `vite` in this environment — see `AGENTS.md`.)
