# Turn cues

Audio countermeasure after a condition from the literature: turning direction
conveyed by a 1000 ms, 800 Hz sine on the left channel for a left turn and on
the right channel for a right turn. A continuous variant (Flexible Tone) plays
the tone all the time, with its loudness on each ear following the turn
strength in that direction. The turn is detected either from the **live
rig-induced optical flow** (see `optical-flow.md`) or from the **rig's angular
acceleration about its local up axis**, never from the path.

## Pipeline

Code lives in `src/turn-cues/`. Three independent parts, wired by the A-Frame
system `turn-cues` (`turn-cue-system.ts`):

1. **Source** (`TurnSignalSource`): delivers signed turn-strength samples,
   positive = left (counter-clockwise from above). The unit depends on the
   source (`TURN_SOURCE_UNITS` in `turn-cue-system.ts`), and so do the
   thresholds and `fullScale` a condition sets.
   - `optical-flow` (`optical-flow-turn-source.ts`): from the rig-induced
     field's horizontal flow in the left and right half of the view. A yaw
     moves both halves sideways at the same angular rate regardless of depth;
     forward motion moves them apart. The lateral flow the halves share (the
     smaller one if both have the same sign, else 0) is the turn rate. Image
     moving right = turning left. Unit °/s.
   - `rig-angular-acceleration` (`rig-angular-acceleration-turn-source.ts`):
     from the `rig-kinematics` system (`src/rig-kinematics/`). In `tock`,
     after `tour-flight` has moved the rig, it takes the rig's rotation since
     the previous frame in the rig's own previous frame, and the y component of
     its rotation vector over the frame time is the yaw rate about the rig's
     **local** up axis. The rig is pitched 30° down, so a world-up yaw ω shows
     up as ω·cos 30° here. The difference of two consecutive rates over the
     spacing of their frame centres is the angular acceleration, in °/s².
     It leads the turn rate: the onset of a left turn is a left cue, its end
     (decelerating) a right cue.
2. **Detector** (`turn-detector.ts`): drops samples measured over more than
   100 ms, then median of 5 (removes one-frame spikes), exponential smoothing
   (`smoothingMs`), and a threshold with hysteresis: a cue fires when the
   smoothed strength exceeds `onThreshold`, and the detector re-arms once
   it falls below `offThreshold`. Cues are at least `toneDurationMs`
   apart.
3. **Output** (`TurnOutput`): receives every smoothed signal and every cue,
   and presents what it is made for.
   - `stereo-tone` (`stereo-tone-output.ts`): Web Audio sine →
     gain envelope (`fadeMs` ramps, no clicks) → `StereoPannerNode` at ±1 →
     speakers, through the shared `audio` system's context. Head-locked stereo
     on purpose, not A-Frame's `sound` / `PositionalAudio`, which would be
     HRTF-spatialized and world-anchored. Disposing it (on a condition switch)
     cuts off a tone still playing. Ignores the continuous signal.
   - `flexible-tone` (`flexible-tone-output.ts`): one continuous sine →
     separate left and right `GainNode`s → `ChannelMergerNode` → speakers.
     Each smoothed signal sets the channel of the turn direction to
     `gain · min(1, |strength| / fullScale)` and the other to 0
     (`setTargetAtTime` with `fadeMs` as time constant, no zipper noise), so
     zero strength is silent. Starts with the first signal once audio is
     running; disposing it fades the tone out. Presents no discrete cues, so
     they are logged with `presented: false`.

## Configuration

The `turn-cues` schema is set by the experimental condition (see
`conditions.md`), not in the scene markup. Each condition in
`src/conditions/conditions.ts` states the properties it changes; the rest keep
their defaults:

| property | default | |
|---|---|---|
| `source` | `optical-flow` | `rig-angular-acceleration`: see above; `none` disables detection |
| `output` | `stereo-tone` | `flexible-tone`: continuous tone; `none`: cues are still detected and logged, nothing is played (the "No Mitigation" condition) |
| `onThreshold` / `offThreshold` | 5 / 2 | hysteresis on the smoothed turn strength, source unit |
| `smoothingMs` | 250 | EMA time constant |
| `toneFrequencyHz` / `toneDurationMs` / `fadeMs` / `gain` | 800 / 1000 / 15 / 0.3 | tone (`toneDurationMs` also the refractory period between cues) |
| `fullScale` | 20 | `flexible-tone`: smoothed turn strength at which a channel reaches `gain`, source unit |

The defaults fit `optical-flow` (°/s). The rig-acceleration conditions set
`onThreshold` 10, `offThreshold` 4 and `fullScale` 30 (°/s²): in a recorded
tour the smoothed acceleration stays below ~10 °/s² 90 % of the time and
peaks around 40 °/s².

Flow tracking off entirely is `optical-flow="enabled: false"`; the
`optical-flow` source then never emits.

A new signal source or presentation (e.g. a visual
cue) is a key in `SOURCES` or `OUTPUTS` in `turn-cue-system.ts`, with a
factory for a `TurnSignalSource` (plus its unit in `TURN_SOURCE_UNITS`) or
`TurnOutput`, plus the schema's `oneOf`.
A condition then selects it.

## Audio unlock

Browsers only allow audio after a user gesture. The `audio` system
(`src/audio/audio-system.ts`) owns one `AudioContext` for the scene and never
closes it, so switching conditions keeps audio unlocked. The context is
created and resumed on the first `pointerdown` / `keydown` / `touchend`
anywhere on the page (the Enter-VR button and the recording button count),
on `enter-vr`, and on controller `select` inside a VR session. If it is
suspended or interrupted later, the listeners re-arm. Until it is running,
cues are logged with `presented: false`.

## Logging

The session log records the configuration (`turnCues`), every detector sample
(`turnSignals`, raw and smoothed) and every cue (`events`, type `turn-cue`).
`analysis/replay_session.py` plots them in the last panel of `timeseries.png`,
which is the place to tune the thresholds.

## Limitations

- **Reactive, not anticipatory:** the optical-flow cue follows the turn by the
  readback latency (1–3 frames) plus the smoothing (~250 ms). The rig
  acceleration has no readback latency and peaks at the turn's onset, but is a
  second difference of the poses and therefore noisier.
- **Head yaw in VR** (optical flow only): with the head turned far to one side, the rig's forward
  motion appears as lateral flow in both halves and can be taken for a turn.
- **Thresholds are untuned** defaults until checked against recorded sessions.
- **Speaker leakage:** on the Quest's built-in speakers, left/right separation
  is weaker than with headphones.
