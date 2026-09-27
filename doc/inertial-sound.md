# Inertial sound

Audio countermeasure: a motor sound sits on an imaginary sphere around the
user, at rest in front of and below them ("at the feet"). The sphere has
rotational inertia and is tied to the rig by a torsional spring and a damper,
so it follows the rig's rotation sluggishly. When the rig's rotation
accelerates, the sound swings out against the acceleration. During a steady
turn it comes back to rest, and when the turn ends it swings to the other
side. The sound is HRTF-spatialized and world-anchored: turning the head
moves it relative to the ears, like a real source.

This is essentially the Steinhausen torsion-pendulum model of the
semicircular canals (endolymph inertia, cupula spring, viscous damping). The
sound conveys the rotation that the visual motion implies but the vestibular
system does not get.

## Model

Code lives in `src/inertial-sound/`, wired by the A-Frame system
`inertial-sound` (`inertial-sound-system.ts`).

`InertialSphere` (`inertial-sphere.ts`) holds the sphere's world orientation
`q` and angular velocity `ω`. For every `rig-kinematics` sample (rig world
orientation `q_rig` and angular velocity `ω_rig` over the last frame, see
below), with error `e = rotvec(q_rig · q⁻¹)`:

    ω ← ω + (ωₙ² · e + 2ζωₙ · (ω_rig − ω)) · dt
    q ← exp(ω · dt) · q

(semi-implicit Euler, full 3D, rotation vectors via `src/rotation.ts`). Spring
and damper both act **relative to the rig**. For the lag θ in rig
coordinates this gives θ'' + 2ζωₙθ' + ωₙ²θ = −α_rig, with α_rig the rig's
angular acceleration. So a constant α settles at θ = −α/ωₙ², and a steady turn
at θ = 0: the sound shows acceleration, not rate. ωₙ = 2π / `naturalPeriodMs`;
the default of 8 s gives ≈ 49° lag at a sustained 30 °/s².

- The lag is clamped to `maxLagDeg`.
- On the first sample, and after a frame longer than 100 ms (tab switch, XR
  session start), the sphere snaps to the rig instead of integrating.
- The rig is pitched 30° down, so a rotation about world up appears in the rig
  frame split into a yaw (y, cos 30°) and a roll (z, sin 30°) component. Pitch
  changes of the flight path show up as x.

`rig-kinematics` provides the rig's world quaternion and its world-frame
angular velocity over the last frame, from the same frame-to-frame rotation
vector as its local yaw rate.

## Source direction

The rest direction is the rig's forward axis (−z) tilted down by
`elevationDeg` (default −30°, i.e. 60° below the horizon with the rig's own
pitch). Each frame, the head-frame direction is `q_head⁻¹ · q · d`. `q_head`
comes from `headMatrixWorld` in `src/rig.ts`: the XR camera while presenting,
otherwise the scene camera. Both are current in `tock`, which A-Frame runs
after rendering.

## Sound

`MotorSound` (`motor-sound.ts`), built on the shared `audio` context, starts
with the first sample once audio is unlocked (see `turn-cues.md`):

- **Chug:** looped 4 s pink noise (Paul Kellet filter) → bandpass around
  1 kHz (Q 0.8) → a gain modulated 0..1 by a sine at the firing rate (25 Hz).
  This band carries the broadband energy HRTF localization needs.
- **Body:** a sawtooth at twice the firing rate → lowpass 500 Hz.
- Both go into one `PannerNode` (`HRTF`, `rolloffFactor: 0`) → a master gain
  (fades with `fadeMs`) → speakers. The listener keeps Web Audio's default
  pose (origin, −z forward, +y up, as a three.js camera). The source is set
  at 1 m in the head-frame direction (`setTargetAtTime`, 20 ms), so
  `AudioListener` is never touched.

**`revWithLag`** (schema property, set per condition):

- `true`: the firing rate (25 → 60 Hz), the body pitch and the noise band
  (1 → 2.5 kHz) rise with `lagFraction` = lag / `maxLagDeg`, so the size of the
  lag is audible where localization is weak.
- `false`: constant timbre; only the position carries information.

Switching condition fades the sound out and releases its nodes.

## Configuration

**Where to set it:** in `src/conditions/conditions.ts`, in the
`'inertial-sound'` object of each condition's `mitigations`, e.g.

```ts
{
  id: 'inertial-motor-sound-revving',
  label: 'Inertial Motor Sound (Revving Pitch)',
  mitigations: {
    'turn-cues': { output: 'none' },
    // Add e.g. `naturalPeriodMs: 12000` here to override the default for this condition.
    'inertial-sound': { enabled: true, revWithLag: true },
  },
},
```

Only `inertial-motor-sound-constant` and `inertial-motor-sound-revving` enable
it; they differ only in `revWithLag`. A property a condition leaves out takes
the default below, which lives in the `schema` of the `inertial-sound` system
in `src/inertial-sound/inertial-sound-system.ts`. Change a default there only
if it should apply to every condition.

| property | default | |
|---|---|---|
| `enabled` | false | off in every other condition |
| `naturalPeriodMs` | 8000 | undamped period of the spring |
| `dampingRatio` | 1 | 1 = critically damped, no wobble of its own |
| `maxLagDeg` | 150 | lag clamp; also the lag of full rev |
| `elevationDeg` | −30 | rest direction below the rig's forward axis |
| `revWithLag` | false | motor revs with the lag (see above) |
| `gain` / `fadeMs` | 0.3 / 50 | output level, fade in/out time constant |

**Untuned:** a turn onset of 15 °/s² over 2 s peaks at only ≈ 11° lag with the
default period. A longer `naturalPeriodMs` gives larger swings, which return
more slowly.

## Logging

The session log stores the effective configuration (`inertialSound`,
including `revWithLag`) and one `inertialSoundSamples[]` entry per frame:
`lagRotationVectorDeg` (rig frame, x pitch / y yaw / z roll, y > 0 = sound
turned left), `sourceDirectionRig` (unit vector, rig frame: the source's
place on the sphere), `sourceDirectionHead` (unit vector, head frame) and
`lagFraction`. `analysis/replay_session.py` plots the lag components and the
source's head-frame azimuth in the last panel of `timeseries.png`.
`analysis/sound_sphere.py` animates the source as a point with a trail on the
sphere, in the rig frame and in the head frame side by side.

## Limitations

- **Generic HRTF:** Chromium's built-in HRTF is not individualized. Azimuth
  works; elevation ("at the feet") and front/back are weak, which is why the
  motor can rev with the lag.
- **Headphones needed:** HRTF over the Quest's open speakers barely works.
- **Latency:** the head pose is this frame's, but the audio output latency
  (typically 20–40 ms) comes on top.
- **Very fast rotation:** at rig rotation rates of several rad/s (far above
  ωₙ and the tour's rates), the per-frame integration no longer settles
  cleanly to zero lag in a steady turn.
