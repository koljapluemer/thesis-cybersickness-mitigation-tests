# Inertial ambience

Audio countermeasure without an added sound: the scene's own ambient sources
(Big Room: fridge, birds, construction site, ventilation) follow the lag of the
same inertial sphere the [inertial motor sound](inertial-sound.md) uses. At rest
and in steady turns every source sits where its object is, at its own level.
When the rig's rotation accelerates, the lag acts in one of two ways (`effect`):

- `rotation`: the whole auditory scene swings off the visible one about the
  listener's head.
- `loudness`: every source stays at its object, and the levels tilt towards one
  side (see [Effect: loudness](#effect-loudness)).

Both settle back once the acceleration ends.

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

Both effects start from the signed lag

    φ = s · lagGain · θ,   clamped to maxLagDeg,

a rotation vector in rig coordinates, with s = +1 or −1 from `swing` (below).
Under `rotation` the sources are turned by L = exp(φ); under `loudness` L is the
identity and φ sets the level tilt.

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

## Effect: loudness

Under `effect: 'loudness'` the sources keep their heard position (heard =
anchored), and each gets a level change in its own gain stage
(`panner → tilt → master`, so the fade-in on `master` is untouched):

    u      = (maxGainDb / maxLagDeg) · (φ × f),   f = rig forward (0, 0, −1)
    gain_dB = u · d̂

with d̂ the source's unit direction from the head, in **rig** coordinates. The
tilt u (`loudnessTiltDb` of the `inertial-ambience` system) is the small-angle
form of exp(φ)·f − f: it points to where φ turns the rig's forward axis, and
sources on that side get louder, sources on the other side quieter. A pure
dipole:

- Under yaw it is a left/right tilt. Sources straight ahead or behind keep
  their level; roll (φ ∥ f) changes nothing; pitch tilts up/down.
- |u| ≤ `maxGainDb`: a source exactly to the side gets ±`maxGainDb` at full lag.
- In rig coordinates, so turning the head does not change the levels (the
  vestibular system senses head turns; only the rig's rotation is in conflict).
- Not normalized: the summed level may drift slightly. The Big Room's four
  sources surround the room, so the tilt mostly redistributes level.

## The four conditions: `effect` × `swing`

The sphere's lag settles at −α/ωₙ², against the angular acceleration.

| condition | `effect` | `swing` | s | at the onset of a left turn |
|---|---|---|---|---|
| `inertial-ambience-against-acceleration` | `rotation` | `against-acceleration` | +1 | sounds turn right, further than the visible room turns past the rig: the auditory scene over-rotates. Same sense as the motor sound's swing. |
| `inertial-ambience-with-acceleration` | `rotation` | `with-acceleration` | −1 | sounds turn left: they are carried along with the rig and trail the visible room. |
| `inertial-ambience-loudness-against-acceleration` | `loudness` | `against-acceleration` | +1 | sources on the right get louder, those on the left quieter: the level lags to the outside of the turn. |
| `inertial-ambience-loudness-with-acceleration` | `loudness` | `with-acceleration` | −1 | sources on the left get louder: the level leads into the turn. |

When the turn ends (deceleration), all swing to the other side before settling.
In all four conditions turn cues are not played (`output: 'none'`) and the motor
sound is off.

## Configuration

**Where to set it:** per condition, in the `'inertial-ambience'` object of the
four conditions in `src/conditions/conditions.ts`, e.g.

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

Change the conditions of an effect alike if the two signs should stay
comparable, and keep the timing of both effects alike if they should be
compared with each other. A
property a condition leaves out takes the default from the `schema` of the
`inertial-ambience` system in
`src/inertial-ambience/inertial-ambience-system.ts`. Change a default only if
it should apply to every condition. Every other condition sets
`NO_INERTIAL_AMBIENCE` (`enabled: false`).

| property | default | effect |
|---|---|---|
| `enabled` | false | off in every other condition |
| `swing` | `against-acceleration` | sign s of φ, see above |
| `effect` | `rotation` | `rotation` (turn the sources) or `loudness` (tilt their levels) |
| `naturalPeriodMs` | 8000 | undamped period of the sphere's spring. **Timing and size:** a longer period swings further (lag ∝ T²) and returns more slowly |
| `dampingRatio` | 1 | 1 = critically damped, no wobble of its own; < 1 overshoots |
| `lagGain` | 2 | φ = sphere lag × this; scales the size without changing the timing. > 0 |
| `maxLagDeg` | 45 | clamp of φ's angle. At the clamp the sphere rides along with the rig |
| `maxGainDb` | 6 | `loudness` only: level change of a source exactly to the side at full lag (φ at `maxLagDeg`). Untuned; the loudness JND is about 1 dB |

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

Multiply by `lagGain` for φ. For example, `naturalPeriodMs: 2000`
with `lagGain: 2` keeps the rotation mostly within 25–40° and returns within
about 2 s.

**The mismatch is the stimulus** (`rotation`). Every degree of rotation moves
the sources off their visible objects (the fridge's hum no longer comes from the
fridge). Large rotations are not just a stronger cue but a new audio–visual
conflict. `loudness` avoids that conflict, but a level change has no built-in
meaning of motion; a louder fridge may just be heard as a louder fridge.

## Logging

The session log (format version 11) stores:

- `inertialAmbience`: the effective configuration.
- `ambientSounds`: the scene's sources (`id`, `src`, `positionWorld`, `gain`,
  `refDistance`). Empty in scenes without any.
- `inertialAmbienceSamples[]`, one per frame while enabled:
  `lagRotationVectorDeg` (φ, rig frame, x pitch / y yaw / z roll, y > 0 =
  turned left), `lagFraction` (angle / `maxLagDeg`) and `loudnessTiltDb`
  (u, rig frame, dB; zero under `rotation`).
- `ambientSoundSamples[]`, one per frame with playing sources, **in every
  condition**: per source `anchoredHead` (where its object is) and `heardHead`
  (where it is played from), both in head coordinates, in metres, and `gainDb`
  (its level change; 0 except under `loudness`).

## Analysis

- `analysis/ambient_sound.py` writes `ambient-sound.mp4`. It shows:
  - the scene ray-cast from the logged view pose, with every source as a ring
    (object) and a dot (heard), with trails; sources off-screen appear as edge
    triangles;
  - the head-frame directions on the unit sphere;
  - the room from above, with the drone path, the rig's heading and the heard
    positions placed in the world;
  - timelines of φ, of each source's angle between its object and where it
    is heard, and of each source's level change in dB.

  The script works for any Big Room log; in the control and under `loudness`
  the two markers coincide.
- `analysis/replay_session.py` shows φ in the last panel of `timeseries.png`,
  and under `loudness` the tilt's left/right component on a second axis.

## Limitations

- **Untuned** for the drone (see above).
- **Generic HRTF, headphones, latency:** as for the motor sound
  ([inertial-sound.md](inertial-sound.md#limitations)). Azimuth changes carry
  the cue best. Pitch and roll components move sources in elevation, where
  Chromium's HRTF is weak.
- **No room acoustics:** the sources are dry point sources. Rotation changes
  only their direction, not any reverberation, since there is none.
- **Loudness and distance:** a level change can also be heard as the source
  coming closer or moving away; the 1/distance rolloff is the scene's other
  level cue, and the tilt acts on top of it as a ratio.
- An ambisonic alternative that rotates a rendered sound field is sketched, not
  implemented, in [ambisonic-field-rotation.md](ambisonic-field-rotation.md).
