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

The same system has a second mode for **linear** acceleration, the otoliths'
counterpart: the motor sits straight below the user on a point mass that
is tied to the rig by a spring and a damper in all three linear directions.
When the rig speeds up, the sound slides back; braking slides it forward, a
turn pushes it outward, a dip lifts it. The schema property `motion` picks
the mode: `rotation` (the sphere, below) or `translation` (the mass, see
[Linear mode](#linear-mode-motion-translation)). Each condition uses one.

## Rotation mode (`motion: 'rotation'`)

Code lives in `src/inertial-sound/`, wired by the A-Frame system
`inertial-sound` (`inertial-sound-system.ts`).

`InertialSphere` (`inertial-sphere.ts`) holds the sphere's world orientation
`q` and angular velocity `ω`. For every `rig-kinematics` sample (rig world
orientation `q_rig` and angular velocity `ω_rig` over the last frame, see
below), with error `e = rotvec(q_rig · q⁻¹)`:

    q ← exp(ω · dt) · q
    ω ← ω + (ωₙ² · e + 2ζωₙ · (ω_rig − ω)) · dt

(semi-implicit Euler, full 3D, rotation vectors via `src/rotation.ts`; `e` is
taken after the first line). The orientation steps first, over the frame the
rig has just turned through; the other order would leave the sphere one
frame's turn (`ω_rig · dt`, times `lagGain` at the source) ahead of the rig
in a steady turn. Spring
and damper both act **relative to the rig**. For the lag θ in rig
coordinates this gives θ'' + 2ζωₙθ' + ωₙ²θ = −α_rig, with α_rig the rig's
angular acceleration. So a constant α settles at θ = −α/ωₙ², and a steady turn
at θ = 0: the sound shows acceleration, not rate. ωₙ = 2π / `naturalPeriodMs`;
the default of 8 s gives ≈ 49° lag at a sustained 30 °/s².

The **source** does not sit on the sphere itself: its lag is the sphere's lag
times `lagGain`, over all three axes. The sphere's physical lag can never
exceed how far the rig has turned within about one response time, and the
tour's sharpest turns are only ≈ 50–75° over 2–4 s. So a halfway swing with a
return of a few seconds needs amplification: `naturalPeriodMs` and
`dampingRatio` set the timing, `lagGain` the size.

- The source's lag is clamped to `maxLagDeg` (the sphere's to
  `maxLagDeg / lagGain`).
- On the first sample, after a frame longer than 100 ms (tab switch, XR
  session start), and after a rig teleport (`restarted` samples, see
  `scenes.md`), the sphere snaps to the rig instead of integrating
  (`isIntegrable` in `rig-kinematics-system.ts`).
- The same sphere drives the inertial ambience (`inertial-ambience.md`), which
  turns the scene's ambient sounds instead of a motor sound.
- In Mountain Flight the rig is pitched 30° down, so a rotation about world up appears in the rig
  frame split into a yaw (y, cos 30°) and a roll (z, sin 30°) component. Pitch
  changes of the flight path show up as x.

`rig-kinematics` provides the rig's world quaternion and its world-frame
angular velocity over the last frame, from the same frame-to-frame rotation
vector as its local yaw rate.

## Linear mode (`motion: 'translation'`)

`InertialMass` (`inertial-mass.ts`) holds the world position `x` and velocity
`v` of a point mass whose rest position is the rig's origin. For every
`rig-kinematics` sample (rig world position `p_rig` and velocity `v_rig` over
the last frame):

    x ← x + v · dt
    v ← v + (ωₙ² · (p_rig − x) + 2ζωₙ · (v_rig − v)) · dt

The position steps first, over the frame the rig has just moved through; the
other order would leave the mass one frame's travel (`v_rig · dt`, 0.6 m at the
car's top speed) ahead of the rig. For the offset o = x − p_rig this gives
o'' + 2ζωₙo' + ωₙ²o = −a_rig: a constant acceleration a settles at
o = −a/ωₙ², constant velocity at o = 0. `naturalPeriodMs` and `dampingRatio`
are the same properties as in rotation mode, with ωₙ = 2π / `naturalPeriodMs`.

- The mass is integrated in the **world** frame, so a turning rig's
  centripetal acceleration v²/r counts as well, as the otoliths would sense it:
  in a turn the sound is pushed outward and stays there while the turn lasts.
  Rotation by itself does not move the source.
- The source's offset is the mass's offset (in rig coordinates) times
  `offsetGain`, clamped to `maxOffsetM` (the mass's to `maxOffsetM / offsetGain`;
  at the clamp the mass takes the rig's velocity).
- It resets like the sphere: on the first sample, after frames over 100 ms and
  after rig teleports.
- Gravity is not part of it: a level rig at rest leaves the sound at rest.

`rig-kinematics` provides the rig's world position and its velocity over the
last frame (position difference over the frame time).

## Source position

The rest position lies 1 m (`REFERENCE_DISTANCE_M` in `motor-sound.ts`) from
the head, along the rig's forward axis (−z) tilted down by `elevationDeg`:

- Rotation mode: the default −30° is 60° below the horizon with the tour rig's
  own pitch, 30° below it in the level car.
- The linear condition sets −90°, straight below in the rig frame. In Mountain
  Flight, the rig is pitched 30° down, so that is 30° behind world vertical.

In the rig frame the source sits at

- rotation: `exp(lagGain · θ) · r`, with θ the sphere's lag, so it stays at 1 m;
- translation: `r + offsetGain · o`, with o the mass's offset, so it moves
  closer and further away as well.

with `r` the rest position. Each frame, the head-frame position is
`q_head⁻¹ · q_rig · (rig-frame position)`. `q_head` comes from `headMatrixWorld`
in `src/rig.ts`: the XR camera while presenting, otherwise the scene camera.
Both are current in `tock`, which A-Frame runs after rendering. Head
translation is ignored: the source moves with the head's position and only
turning the head moves it relative to the ears.

With the rest point straight below, fore/aft and sideways offsets change the
source's direction (front/back and left/right below the listener), and
vertical offsets change its distance, heard as loudness (see below).

## Sound

`MotorSound` (`motor-sound.ts`), built on the shared `audio` context, starts
with the first sample once audio is unlocked (see `turn-cues.md`):

- **Chug:** looped 4 s pink noise (Paul Kellet filter) → bandpass around
  1 kHz (Q 0.8) → a gain modulated 0..1 by a sine at the firing rate (25 Hz).
  This band carries the broadband energy HRTF localization needs.
- **Body:** a sawtooth at twice the firing rate → lowpass 500 Hz.
- Both go into one `PannerNode` (`HRTF`, `rolloffFactor: 0`) → a distance
  gain → a master gain (fades with `fadeMs`) → speakers. The listener keeps
  Web Audio's default pose (origin, −z forward, +y up, as a three.js camera).
  The source is set at its head-frame position (`setTargetAtTime`, 20 ms), so
  `AudioListener` is never touched.
- **Distance:** the distance gain is 1 m / distance (not closer than 0.1 m),
  so the level is `gain` at the rest distance, +6 dB at half of it. Web
  Audio's own `inverse` model cannot get louder inside its reference distance,
  so the panner's rolloff stays off. In rotation mode the source is always at
  1 m and this changes nothing.

**`revWithLag`** (schema property, set per condition):

- `true`: the firing rate (25 → 60 Hz), the body pitch and the noise band
  (1 → 2.5 kHz) rise with `lagFraction` = lag / `maxLagDeg` (translation:
  offset / `maxOffsetM`), so the size of the lag is audible where
  localization is weak. The linear condition does not use it.
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

The linear condition, `inertial-motor-sound-linear`, sets:

```ts
'inertial-sound': { enabled: true, motion: 'translation', elevationDeg: -90, naturalPeriodMs: 2000 },
```

and could add e.g. `offsetGain: 0.5, maxOffsetM: 0.3` there.

Three conditions enable the inertial sound:

- `inertial-motor-sound-constant` and `inertial-motor-sound-revving` (rotation
  mode) differ in `revWithLag` (the constant one also sets `lagGain: 7`).
- `inertial-motor-sound-linear` uses translation mode.

A property a condition leaves out takes the default below, which lives in the
`schema` of the `inertial-sound` system in
`src/inertial-sound/inertial-sound-system.ts`. Change a default there only if
it should apply to every condition. Properties of the other mode are ignored.

| property | mode | default | |
|---|---|---|---|
| `enabled` | both | false | off in every other condition |
| `motion` | both | `rotation` | `rotation` (sphere, angular acceleration) or `translation` (mass, linear acceleration) |
| `naturalPeriodMs` | both | 8000 | undamped period of the spring |
| `dampingRatio` | both | 1 | 1 = critically damped, no wobble of its own |
| `elevationDeg` | both | −30 | rest direction below the rig's forward axis; −90 = straight below |
| `lagGain` | rotation | 1 | source lag = sphere lag × this; the size of the swing, > 0 |
| `maxLagDeg` | rotation | 150 | clamp of the source's lag; also the lag of full rev |
| `offsetGain` | translation | 1 | source offset = mass offset × this; the size of the slide, > 0 |
| `maxOffsetM` | translation | 0.5 | clamp of the source's offset, in metres; also the offset of full rev |
| `revWithLag` | both | false | motor revs with the lag or offset (see above) |
| `gain` / `fadeMs` | both | 0.3 / 50 | output level at the rest distance, fade in/out time constant |

**Untuned:** a turn onset of 15 °/s² over 2 s peaks at only ≈ 13° sphere lag
with the default period. A longer `naturalPeriodMs` gives larger swings, which
return more slowly; `lagGain` scales the swing without changing its timing.
Replaying the rig's yaw of a recorded tour through the model, the sharpest
turn peaks at ≈ 11° sphere lag with `naturalPeriodMs: 6000, dampingRatio: 1`
(no overshoot) and ≈ 15° with 8000, so `lagGain` ≈ 16 or ≈ 12 brings it near
180°.

**Untuned (linear):** the steady offset is a/ωₙ² = a · (T / 2π)², about 0.1 m
per m/s² at T = 2 s. The car's full throttle (8 m/s²) or a turn at its grip
limit reaches the 0.5 m clamp; a gentle 2 m/s² gives 0.2 m. A longer period
gives larger, slower slides; `offsetGain` scales them without changing their
timing. The Mountain Flight's accelerations have not been measured yet.

## Logging

The session log stores the effective configuration (`inertialSound`,
including `motion` and `revWithLag`) and one `inertialSoundSamples[]` entry
per frame:

- `lagRotationVectorDeg`: the source's lag, i.e. sphere lag × `lagGain`; rig
  frame, x pitch / y yaw / z roll, y > 0 = sound turned left. Zero in
  translation mode.
- `offsetRigM`: the source's offset, i.e. mass offset × `offsetGain`; rig
  frame, in metres, x right / y up / z back. Zero in rotation mode.
- `sourcePositionRig`: rig frame, in metres, relative to the head; the rest
  position turned by the lag or shifted by the offset.
- `sourcePositionHead`: head frame, in metres.
- `lagFraction`.

Analysis:

- `analysis/replay_session.py` plots, in the last panel of `timeseries.png`,
  the lag components and the source's head-frame azimuth (rotation), or the
  offset components in cm (translation).
- `analysis/sound_sphere.py` animates the source as a point with a trail
  around the unit sphere of the rest distance, in the rig frame and in the head
  frame side by side. In translation mode, a third panel shows the offset from
  above within its clamp circle.

## Limitations

- **Generic HRTF:** Chromium's built-in HRTF is not individualized. Azimuth
  works; elevation ("at the feet") and front/back are weak, which is why the
  motor can rev with the lag.
- **Straight below (linear mode):** the rest position is the pole of the
  head's coordinate system, where azimuth is undefined. Small horizontal
  offsets there swing the azimuth strongly, so the first centimetres of a
  slide may sound like a jump. Chromium's HRTF set also reaches down only to
  about −45° elevation, so sources further below are rendered with that
  elevation's filters. Whether fore/aft is heard reliably has to be tested
  on headphones. Vertical offsets are mainly heard as loudness, and
  loudness alone cannot tell an up offset from a quieter motor.
- **Headphones needed:** HRTF over the Quest's open speakers barely works.
- **Latency:** the head pose is this frame's, but the audio output latency
  (typically 20–40 ms) comes on top.
