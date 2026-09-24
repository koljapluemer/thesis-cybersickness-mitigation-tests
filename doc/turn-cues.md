# Turn cues

Audio countermeasure after a condition from the literature: turning direction
conveyed by a 1000 ms, 800 Hz sine on the left channel for a left turn and on
the right channel for a right turn. Here the turn is detected from the **live
rig-induced optical flow** (see `optical-flow.md`), not from the path or the
rig kinematics.

## Pipeline

Code lives in `src/turn-cues/`. Three independent parts, wired by the A-Frame
system `turn-cues` (`turn-cue-system.ts`):

1. **Source** (`TurnSignalSource`): delivers turn-rate samples in °/s,
   positive = left (counter-clockwise from above).
   - `optical-flow` (`optical-flow-turn-source.ts`): from the rig-induced
     field's horizontal flow in the left and right half of the view. A yaw
     moves both halves sideways at the same angular rate regardless of depth;
     forward motion moves them apart. The lateral flow the halves share (the
     smaller one if both have the same sign, else 0) is the turn rate. Image
     moving right = turning left.
2. **Detector** (`turn-detector.ts`): drops samples measured over more than
   100 ms, then median of 5 (removes one-frame spikes), exponential smoothing
   (`smoothingMs`), and a threshold with hysteresis: a cue fires when the
   smoothed rate exceeds `onThresholdDegPerSec`, and the detector re-arms once
   it falls below `offThresholdDegPerSec`. Cues are at least `toneDurationMs`
   apart.
3. **Output** (`CueOutput`): presents a cue.
   - `stereo-tone` (`stereo-tone-output.ts`): Web Audio sine →
     gain envelope (`fadeMs` ramps, no clicks) → `StereoPannerNode` at ±1 →
     speakers, through the shared `audio` system's context. Head-locked stereo
     on purpose, not A-Frame's `sound` / `PositionalAudio`, which would be
     HRTF-spatialized and world-anchored. Disposing it (on a condition switch)
     cuts off a tone still playing.

## Configuration

The `turn-cues` schema is set by the experimental condition (see
`conditions.md`), not in the scene markup. Each condition in
`src/conditions/conditions.ts` states the properties it changes; the rest keep
their defaults:

| property | default | |
|---|---|---|
| `source` | `optical-flow` | `none` disables detection |
| `output` | `stereo-tone` | `none`: cues are still detected and logged, nothing is played (the "No Mitigation" condition) |
| `onThresholdDegPerSec` / `offThresholdDegPerSec` | 10 / 5 | hysteresis on the smoothed turn rate |
| `smoothingMs` | 250 | EMA time constant |
| `toneFrequencyHz` / `toneDurationMs` / `fadeMs` / `gain` | 800 / 1000 / 15 / 0.3 | tone |

Flow tracking off entirely is `optical-flow="enabled: false"`; the
`optical-flow` source then never emits.

A new signal source (e.g. rig acceleration) or cue presentation (e.g. a visual
cue) is a key in `SOURCES` or `OUTPUTS` in `turn-cue-system.ts`, with a
factory for a `TurnSignalSource` or `CueOutput`, plus the schema's `oneOf`.
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

- **Reactive, not anticipatory:** the cue follows the turn by the readback
  latency (1–3 frames) plus the smoothing (~250 ms).
- **Head yaw in VR:** with the head turned far to one side, the rig's forward
  motion appears as lateral flow in both halves and can be taken for a turn.
- **Thresholds are untuned** defaults until checked against recorded sessions.
- **Speaker leakage:** on the Quest's built-in speakers, left/right separation
  is weaker than with headphones.
