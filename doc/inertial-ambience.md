# Inertial ambience

Audio countermeasure without an added sound: the scene's own ambient sources
(Big Room: fridge, birds, construction site, ventilation) are turned about the
listener's head by the lag of the same inertial sphere the
[inertial motor sound](inertial-sound.md) uses. At rest and in steady turns
every source sits where its object is. When the rig's rotation accelerates, the
whole auditory scene swings off the visible one, and settles back once the
acceleration ends.

Only the Big Room has ambient sources. In other scenes these conditions play
nothing and log no ambient samples.

## Model

`InertialSphere` (`src/inertial-sound/inertial-sphere.ts`) is shared with the
motor sound. Its lag θ (rig frame) obeys θ'' + 2ζωₙθ' + ωₙ²θ = −α_rig, with
α_rig the rig's angular acceleration, in all three axes. See
[inertial-sound.md](inertial-sound.md#rotation-mode-motion-rotation). The
system `inertial-ambience` (`src/inertial-ambience/inertial-ambience-system.ts`)
steps the sphere on every `rig-kinematics` sample and resets it to the rig on the
first sample, after a restart (teleport, paused frame) and after frames over
100 ms (`isIntegrable` in `rig-kinematics-system.ts`).

The rotation applied to the sources is

    L = exp(s · lagGain · θ),   clamped to maxLagDeg,

as a rotation in rig coordinates, with s = +1 or −1 from `swing` (below).

## Placement

The `ambient-sound` system (`src/audio/ambient-sound.ts`) places every
`ambient-sound` source once per frame. The listener keeps Web Audio's default
pose, and each `PannerNode` gets the source's head-frame position:

    heard = q_head⁻¹ · q_rig · L · q_rig⁻¹ · (p_source − p_head)

The source's direction from the head is turned in the rig frame. Its distance,
and with it the 1/distance rolloff, stays unchanged. In every other condition L
is the identity, so this is the plain world-anchored source.

**Same-frame ordering.** A-Frame runs all component `tock`s first, then the
systems' `tock`s in registration order. `ambient-sound.ts` imports
`inertial-ambience-system.ts`, which imports `rig-kinematics-system.ts`, so ES
module evaluation registers rig-kinematics → inertial-ambience → ambient-sound.
The L used in a frame is stepped from that frame's rig pose. A recorded log
confirms it: the logged heard positions match the logged poses and lag of the
same `sceneTimeMs` to floating-point precision.

## The two conditions: `swing`

The sphere's lag settles at −α/ωₙ², against the angular acceleration.

| condition | `swing` | s | at the onset of a left turn |
|---|---|---|---|
| `inertial-ambience-against-acceleration` | `against-acceleration` | +1 | sounds turn right, further than the visible room turns past the rig: the auditory scene over-rotates. Same sense as the motor sound's swing. |
| `inertial-ambience-with-acceleration` | `with-acceleration` | −1 | sounds turn left: they are carried along with the rig and trail the visible room. |

When the turn ends (deceleration), both swing to the other side before settling.
In both conditions turn cues are not played (`output: 'none'`) and the motor
sound is off.

## Configuration

**Where to set it:** per condition, in the `'inertial-ambience'` object of the
two conditions in `src/conditions/conditions.ts`, e.g.

```ts
{
  id: 'inertial-ambience-with-acceleration',
  label: 'Inertial Ambience (With Acceleration)',
  mitigations: {
    'turn-cues': { output: 'none' },
    'inertial-sound': NO_INERTIAL_SOUND,
    'inertial-ambience': { enabled: true, swing: 'with-acceleration', naturalPeriodMs: 2000, maxLagDeg: 60 },
  },
},
```

Change both conditions alike if the two signs should stay comparable. A
property a condition leaves out takes the default from the `schema` of the
`inertial-ambience` system in
`src/inertial-ambience/inertial-ambience-system.ts`. Change a default only if
it should apply to every condition. Every other condition sets
`NO_INERTIAL_AMBIENCE` (`enabled: false`).

| property | default | effect |
|---|---|---|
| `enabled` | false | off in every other condition |
| `swing` | `against-acceleration` | sign of the rotation, see above |
| `naturalPeriodMs` | 8000 | undamped period of the sphere's spring. **Timing and size:** a longer period swings further (lag ∝ T²) and returns more slowly |
| `dampingRatio` | 1 | 1 = critically damped, no wobble of its own; < 1 overshoots |
| `lagGain` | 2 | rotation = sphere lag × this; scales the size without changing the timing. > 0 |
| `maxLagDeg` | 45 | clamp of the rotation's angle. At the clamp the sphere rides along with the rig |

**Untuned.** The defaults came from the tour, whose turns peak around
40 °/s². The drone is much more agile. In the first recorded Big Room session,
its angular acceleration about the rig's up axis was 116 °/s² at the median,
466 °/s² at the 90th percentile and about 1000 °/s² at the 99th. With the
defaults the rotation sat at the 45° clamp 23 % of the time, so it mostly
flipped between ±45°.

Replaying that session's yaw through the model (gain 1, no clamp) gives this
sphere lag:

| `naturalPeriodMs` | median | 90th pct. | 99th pct. | max |
|---|---|---|---|---|
| 8000 | 15° | 73° | 79° | 79° |
| 4000 | 9° | 32° | 50° | 51° |
| 2000 | 3° | 12° | 20° | 24° |
| 1500 | 2° | 7° | 12° | 18° |
| 1000 | 1° | 4° | 6° | 11° |

Multiply by `lagGain` for the rotation. For example, `naturalPeriodMs: 2000`
with `lagGain: 2` keeps the rotation mostly within 25–40° and returns within
about 2 s.

**The mismatch is the stimulus.** Every degree of rotation moves the sources
off their visible objects (the fridge's hum no longer comes from the fridge).
Large rotations are not just a stronger cue but a new audio–visual conflict.

## Logging

The session log (format version 10) stores:

- `inertialAmbience`: the effective configuration.
- `ambientSounds`: the scene's sources (`id`, `src`, `positionWorld`, `gain`,
  `refDistance`). Empty in scenes without any.
- `inertialAmbienceSamples[]`, one per frame while enabled:
  `lagRotationVectorDeg` (L as a rotation vector, rig frame, x pitch / y yaw /
  z roll, y > 0 = sounds turned left) and `lagFraction` (angle / `maxLagDeg`).
- `ambientSoundSamples[]`, one per frame with playing sources, **in every
  condition**: per source `anchoredHead` (where its object is) and `heardHead`
  (where it is played from), both in head coordinates, in metres.

## Analysis

- `analysis/ambient_sound.py` writes `ambient-sound.mp4`. It shows:
  - the scene ray-cast from the logged view pose, with every source as a ring
    (object) and a dot (heard), with trails; sources off-screen appear as edge
    triangles;
  - the head-frame directions on the unit sphere;
  - the room from above, with the drone path, the rig's heading and the heard
    positions placed in the world;
  - timelines of L and of each source's angle between its object and where it
    is heard.

  The script works for any Big Room log; in the control the two markers coincide.
- `analysis/replay_session.py` shows L in the last panel of `timeseries.png`.

## Limitations

- **Untuned** for the drone (see above).
- **Generic HRTF, headphones, latency:** as for the motor sound
  ([inertial-sound.md](inertial-sound.md#limitations)). Azimuth changes carry
  the cue best. Pitch and roll components move sources in elevation, where
  Chromium's HRTF is weak.
- **No room acoustics:** the sources are dry point sources. Rotation changes
  only their direction, not any reverberation, since there is none.
- An ambisonic alternative that rotates a rendered sound field is sketched, not
  implemented, in [ambisonic-field-rotation.md](ambisonic-field-rotation.md).
