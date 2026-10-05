# Test scenes

A test scene is the world and the way the rig moves through it. Four exist:

| id | label | rig motion |
|---|---|---|
| `mountain-flight` | Mountain Flight | `tour-flight`: automatic helicopter flight along a scripted path over a mountain landscape; the user can only look around |
| `car-race` | Car Race | `car-drive`: the user drives a formula car around a race track, seen from the cockpit |
| `city-drive` | City Drive | `straight-drive`: the formula car stands in a city street, accelerates straight ahead from standstill for a fixed time, then jumps back to the start, in a loop; the user can only look around |
| `big-room` | Big Room | `drone-flight`: a drone flies a closed minimum-snap loop through editable waypoints in a furnished loft, leaning like a quadcopter; the user can only look around |

Every mitigation works in every scene: the mitigation systems only read the
rig (the camera's parent, `src/rig.ts`) and know nothing about scenes.
Conditions (`conditions.md`) are independent of the scene.

## Choosing a scene: selects and URL

The bottom-left corner holds two selects: the scene above the condition. Both
are mirrored in the URL, so a link reproduces the setup:

```
https://…/?scene=car-race&condition=inertial-motor-sound-revving
```

- On load, `readSelection()` (`src/scenes/url-selection.ts`) reads `scene`
  and `condition`. A missing parameter takes the default (`mountain-flight`,
  `turn-tone-optical-flow`); an unknown one also takes the default and logs a
  warning with the known ids. The URL is then rewritten with both parameters,
  so the address bar always holds a complete link.
- Changing the **condition** switches live and updates the URL
  (`history.replaceState`, no reload).
- Changing the **scene** reloads the page with the new `scene` parameter,
  keeping the condition. A scene is only ever built on page load, so no state
  (rig kinematics, inertial sphere, flow history, audio) carries over from one
  scene to another, and no scene needs teardown code.
- Both selects are disabled while recording. They blur after a change, so
  keys go to the scene (driving) and not to the select.

## Architecture

Code lives in `src/scenes/`.

- **`scene-definition.ts`**: `SceneDefinition`: `id`, `label`, the WebXR
  `referenceSpaceType`, `markup()` (assets, world and rig inside `<a-scene>`)
  and `recording(sceneEl)`, which gives the session recorder the scene's
  `describe()` (static description, logged once) and `frameState()` (logged
  every frame as `sceneState`). Also helpers to describe glTF models for the
  log (`worldModel`, `rigModel`).
- **`scenes.ts`**: the registry `SCENES`, in select order, and the derived
  `SceneId` and `SceneFrameState` types.
- **`rig-markup.ts`**: `rigMarkup(attributes)`, the rig every scene uses: the
  camera and the right controller whose B button cycles the condition.
  Scenes only choose where the rig sits and what moves it.
- **`mountain-flight.ts`**, **`car-race.ts`**, **`city-drive.ts`**, **`big-room.ts`**: the scenes.
- **`formula-car.ts`**: the formula car with the rig on its seat, shared by
  Car Race and City Drive; the scene only chooses the component moving `#car`.
- **`url-selection.ts`**, **`scene-select.ts`**: see above.

`src/main.ts` builds `<a-scene>` with the shared lights and systems around the
selected scene's markup, then wires the recorder and the selects.

### Rig teleports

When whatever moves the rig makes it jump instead of moving continuously
(placing it on start, a reset), it calls `announceRigTeleport(sceneEl)`
(`src/rig.ts`) right after setting the new pose. Then:

- `rig-kinematics` restarts its history; its next sample has `restarted: true`.
- `inertial-sound` snaps its sphere or mass to the rig instead of swinging it.
- `optical-flow` does not measure that frame (`flow: null`).
- The recorder logs a `rig-teleport` event with the frame's `sceneTimeMs`, and
  `analysis/` computes no rate across it.

`tour-flight` announces its first placement on the path; `car-drive` its spawn
and every reset.

### Rig-fixed geometry

Geometry that moves with the rig, such as the car body around the seat, is
marked with the `rig-fixed` component (`src/rig-fixed.ts`). It puts the
entity's meshes on render layer `RIG_FIXED_LAYER` and makes the camera render
that layer. The optical flow meter renders that layer in a separate pass,
because those surfaces are not static in the world: they get only the head's
motion relative to the rig as flow and no rig-induced flow (see
`optical-flow.md`). The entity must not move relative to the rig.

## Car Race

Code lives in `src/car-race/`.

### Controls

| | desktop | VR |
|---|---|---|
| steer | A / D or ← / → | thumbstick x (either controller) |
| accelerate | W or ↑ | thumbstick forward |
| brake, then reverse from a standstill | S or ↓ | thumbstick back |
| reset to the start | R | A (right controller) |
| cycle condition | condition select | B (right controller) |

Keys are digital, so `DriveInput` (`drive-input.ts`) ramps them (steering
3/s towards full lock and 6/s back to centre, pedals 4/s on and 8/s off).
Thumbsticks are read directly from the WebXR input sources (xr-standard
mapping) with a radial deadzone. Keyboard and sticks add up.

### Car model

`CarPhysics` (`car-physics.ts`, plain TypeScript without A-Frame) is a planar
car on the flat track:

- Dynamic bicycle model: tyre lateral forces saturate with the slip angle
  (tanh, peak at 0.1 rad); the front has 90 % of the rear's grip, so at the
  limit the car understeers instead of spinning.
- Below 1.5 m/s it follows the kinematic bicycle model (no tyre slip), above
  4 m/s the dynamic one, blended in between, since slip angles are
  ill-defined near a standstill. Reversing is always kinematic.
- The steering lock shrinks with speed: `maxSteerDeg / (1 + v / steerFalloffSpeed)`.
- Throttle drives forward with an acceleration tapering to zero at
  `topSpeed`; brake decelerates, and at a standstill it reverses (up to
  `reverseSpeed`). Rolling off the throttle engine-brakes.
- Integrated in fixed 240 Hz substeps (frame time clamped to 50 ms), so the
  handling does not depend on the display's frame rate.
- Walls (`track-walls.ts`): the body is two circles along its axis. On
  contact the car is pushed out, the velocity into the wall is reflected with
  restitution 0.2, tangential speed and yaw rate are damped, so the car
  scrapes along instead of spinning off.

Measured headless with the defaults: 0–100 km/h in about 6 s, top speed
about 42 m/s after 20 s, full braking from there in 2.4 s, steady cornering up
to about 1.5 g.

`car-drive` (`car-drive.ts`) loads `track.json`, places the car at the spawn,
and every `tick` reads the input, advances the physics and writes the car
entity's pose. Its schema holds the `CarTuning` values:

| property | default | meaning |
|---|---|---|
| `src` | `/car-race/track.json` | walls, spawn, car dimensions |
| `topSpeed` | 45 | m/s |
| `acceleration` | 8 | m/s² from standstill at full throttle |
| `brakeDeceleration` | 16 | m/s² at full brake |
| `reverseSpeed` | 8 | m/s |
| `maxSteerDeg` | 30 | front wheel angle at full lock when standing |
| `steerFalloffSpeed` | 12 | m/s at which the lock has halved |
| `grip` | 1.6 | peak lateral acceleration of the rear tyres, g |

### Rig and cockpit view

```
#car        car-drive          origin: centre of mass on the ground
├─ #car-body  gltf, rig-fixed
└─ #rig       seat, at the driver's eye (SEAT_POSITION in formula-car.ts)
   ├─ camera
   └─ right controller
```

The rig is the seat, rigidly attached to the car, so rig kinematics, the
inertial sound and the flow all see the car's motion. The scene uses the
WebXR reference space `local`: the headset's origin is the head pose at
session start, which puts a seated player's eye at the seat. Recentering the
headset moves it back there.

### Logged per frame (`sceneState`)

`speedMps` (along the car, negative when reversing), `yawRateDegPerSec`,
`steerAngleDeg` (front wheels), and the input: `steer`, `throttle`, `brake`.
The car's pose is in `rigMatrixWorld`.

### Assets

`public/car-race/`, from the CC0 "Racing asset pack" by eracoon
(`license.txt`), converted once from its .blend with Blender:

- `track.glb`: the finished track `racetrack-racoon`, asphalt at y = 0.
- `car-formula-red.glb`: the formula car, origin at its centre on the ground,
  front towards −Z, the driver's helmet removed (the player's eye sits in it).
  Cycles materials were rebuilt as Principled BSDF for glTF.
- `track.json`: the pack's collision walls (their bottom edges, as closed
  `[x, z]` polylines; a small seam gap in one loop was closed), the spawn on
  the start/finish straight, and the car's axle positions and half extents.

Blender units were scaled by 2.5 to metres (the car is then 5.5 m long) and
converted from Z-up to Y-up: `(x, y, z) → (x, z, −y)`.

## City Drive

Code lives in `src/city-drive/`. The city is the staircase repo's
(`thesis-cybersickness-staircase`): `public/city/city.glb` and `sky.jpg` were
exported there from `blender/city_scene.blend` by `scripts/export_city.py`
(lights removed, materials baked, Draco geometry, WebP textures). The Draco
decoder loads from A-Frame's default CDN (gstatic), so the headset needs
internet access. The car and rig are the Car Race's (`formula-car.ts`).

`straight-drive` (`straight-drive.ts`) moves `#car` in cycles:

1. It puts the car on the start pose (an announced rig teleport) and holds it
   still for `holdS`.
2. It accelerates from standstill at `acceleration` for `durationS`, straight
   along the heading; the distance ½·a·t² is evaluated at each frame's time.
3. It jumps back to 1.

`RUN` in `src/scenes/city-drive.ts` sets `acceleration` (3 m/s²),
`durationS` (10 s) and `holdS` (2 s). The road ahead must be clear for
½·a·t² (150 m with these values).

### Start pose

`START_POSE_BLENDER` in `src/city-drive/start-pose.ts` holds the car's ground
point and a second point it drives towards, in **Blender** coordinates of the
city (Z up), so they can be read straight off the .blend: put the 3D cursor on
the road (Shift + right-click) and copy its location from the N panel → View →
3D Cursor. `startPose()` converts them to A-Frame (`(x, y, z) → (x, z, −y)`)
and to a heading. It is still a placeholder (the origin, facing +Y).

Logged per frame: `cycle`, `distanceM`, `speedMps`. Reference space: `local`.

## Big Room

`public/big_room.glb` is "Big Room" by Francesco Coldesina
(https://sketchfab.com/3d-models/big-room-0b5da073be88481091dbef7e55f1d180),
CC-BY-4.0. Its units are about 2 cm, so `src/scenes/big-room.ts` scales it by
0.02 (ceiling ≈ 3.1 m) and centres it horizontally on the origin.

Code lives in `src/big-room/`.

### Motion

`drone-flight` (`drone-flight.ts`, on `#rig`) flies a closed loop through the
waypoints, the child entities of `#drone-waypoints`, in DOM order and from
the last back to the first.

- **Path** (`min-snap.ts`): the minimum-snap curve through the waypoints, a
  septic polynomial per segment that is continuous up to the 6th derivative
  at every waypoint, including the seam. Snap is what a quadcopter's motor
  commands follow, so acceleration and jerk never jump, unlike the Catmull-Rom
  tour of Mountain Flight.
- **Timing**: each segment first gets its length / `cruiseSpeed` (2.5 m/s).
  Then the whole loop is slowed uniformly until the peak speed is at most
  `maxSpeed` (4 m/s) and the peak acceleration at most `maxAcceleration`
  (4 m/s²). Uniform time scaling keeps the path's shape.
- **Attitude**: the rig faces its horizontal velocity. With `tiltCoupling` 1
  it also leans as a quadcopter must: its up axis is the thrust axis a + g, so
  it tips forward when speeding up, back when braking and banks into turns.
  With 0 it only yaws and the horizon stays level; values in between slerp.
  The head moves freely on top, as in every scene.
- The heading needs horizontal motion: if the horizontal speed falls below
  0.2 m/s anywhere (e.g. two waypoints stacked vertically), the plan is
  rejected.

The rig teleport is announced on the first placement and after every
re-plan. Logged per frame: `pathTimeSec`, `speedMps`. `describe()` logs the
limits, `tiltCoupling`, the waypoints and the segment durations. Reference
space: `local`.

### Editing the waypoints

`WAYPOINTS` in `src/big-room/waypoints.ts` holds the loop, in world
coordinates (m, y up; the room's floor is at y = 0).

1. Open the A-Frame inspector with ctrl + alt + i. It pauses the scene, and
   while paused the waypoints (orange spheres) and the planned path (orange
   line) are shown. Otherwise they are hidden, so they are never seen in the
   study or measured by the optical flow.
2. Drag a waypoint, or edit its position. Each change re-plans and redraws the
   path. You can add, delete or reorder children of `#drone-waypoints`. A new
   waypoint is planned where it is created, so move it into place.
3. Close the inspector (ctrl + alt + i) to fly the new loop.
4. Inspector edits are lost on reload. After each change, `drone-flight` logs
   the `WAYPOINTS` literal to the console: paste it into `waypoints.ts`.

A rejected edit is logged as an error and the previous loop kept.

## Mountain Flight

`tour-flight` (`src/tour-flight.ts`) flies the rig along
`public/tour-path.json`, a closed time-parameterized Catmull-Rom loop, pitched
30° down. See the README's scene structure section. Logged per frame:
`pathTimeSec`. Reference space: `local-floor`.

## Adding a scene

1. Write a `SceneDefinition` in `src/scenes/` whose markup places
   `rigMarkup(…)` and whatever moves the rig. That component announces jumps
   with `announceRigTeleport`. Mark geometry moving with the rig `rig-fixed`.
2. Add it to `SCENES` in `scenes.ts`. The select, the URL parameter and the
   log's `SceneFrameState` type follow from it.
3. For offline replay, `describe()` must list every visible glTF model:
   `staticModels` (world matrix) and `rigFixedModels` (matrix relative to the
   rig).
