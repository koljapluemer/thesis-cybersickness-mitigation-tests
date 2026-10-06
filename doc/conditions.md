# Experimental conditions

A condition is one combination of cybersickness mitigations. Conditions are
independent of the test scene (`scenes.md`). On desktop, conditions are
switched with the lower select in the bottom-left corner (the upper one picks
the scene). In VR, the B button on the right controller cycles through them;
the select shows the current one but is not meant to be used from VR.

The current condition is mirrored in the URL's `condition` parameter, and a
link with it starts in that condition (see `scenes.md`).

| id | label | turn cues | inertial sound | inertial ambience |
|---|---|---|---|---|
| `no-mitigation` | No Mitigation | detected and logged, not played | off | off |
| `turn-tone-optical-flow` | Turn Tone (Optical Flow) | stereo tones, turns from the optical flow (`turn-cues.md`) | off | off |
| `flexible-tone-optical-flow` | Flexible Tone (Optical Flow) | continuous tone, per-ear loudness following the optical-flow turn rate | off | off |
| `turn-tone-rig-acceleration` | Turn Tone (Rig Angular Acceleration) | stereo tones, turns from the rig's angular acceleration about its local up axis | off | off |
| `flexible-tone-rig-acceleration` | Flexible Tone (Rig Angular Acceleration) | continuous tone, per-ear loudness following that angular acceleration | off | off |
| `inertial-motor-sound-constant` | Inertial Motor Sound (Constant Pitch) | detected and logged, not played | on: world-anchored motor sound lagging behind the rig's rotation, constant timbre (`inertial-sound.md`) | off |
| `inertial-motor-sound-revving` | Inertial Motor Sound (Revving Pitch) | detected and logged, not played | on: as above, the motor revs (rising pitch) with the size of the lag | off |
| `inertial-motor-sound-linear` | Inertial Motor Sound (Linear Acceleration) | detected and logged, not played | on: motor sound straight below the user, shifted against the rig's linear acceleration (incl. centripetal), constant timbre; rotation alone does not move it | off |
| `inertial-ambience-against-acceleration` | Inertial Ambience (Against Acceleration) | detected and logged, not played | off | on: the scene's ambient sounds turn about the head by the inertial sphere's lag, in its sense (over-rotating at a turn onset; `inertial-ambience.md`). Big Room only |
| `inertial-ambience-with-acceleration` | Inertial Ambience (With Acceleration) | detected and logged, not played | off | on: as above, turned the opposite way (carried along with the rig at a turn onset). Big Room only |
| `inertial-ambience-loudness-against-acceleration` | Inertial Ambience Loudness (Against Acceleration) | detected and logged, not played | off | on: the ambient sounds stay at their objects; their levels tilt by the same lag, towards the outside of a turn at its onset. Big Room only |
| `inertial-ambience-loudness-with-acceleration` | Inertial Ambience Loudness (With Acceleration) | detected and logged, not played | off | on: as above, tilted the opposite way (towards the inside of a turn at its onset). Big Room only |

## Architecture

Code lives in `src/conditions/`.

- **Mitigations** are A-Frame scene systems with a schema (`turn-cues`,
  `inertial-sound`, `inertial-ambience`). They know nothing about conditions and are configured only
  through their schema.
- **`conditions.ts`** is the registry: `CONDITIONS` lists each condition's id,
  label and `mitigations`, the config of *every* mitigation system
  (`MitigationConfigs`). Properties a condition leaves out take the system's
  schema defaults, never values from the previous condition.
- **`condition` system** (`condition-system.ts`, `condition="…"` on
  `<a-scene>`, initially the URL's condition) applies a condition by writing each mitigation's config with
  `sceneEl.setAttribute(system, …)`. A-Frame then runs that system's `update`.
  API through `getCondition(sceneEl)`: `state` (id, label, locked),
  `select(id)`, `cycle()`, `lock()`, `onChange(listener)`.
- **`condition-select.ts`** mounts the DOM `<select>`: one option per
  condition, kept in sync through `onChange`, disabled while locked.
  `main.ts` also writes every change to the URL.
- **`condition-cycle` component** (`condition-cycle.ts`) calls `cycle()` on an
  entity event. The shared rig (`src/scenes/rig-markup.ts`) puts it on a
  model-less `meta-touch-controls="hand: right"` entity with
  `event: bbuttondown`.

## Recording

The recorder locks the condition for the whole recording: both selects are
disabled, and the B button does nothing. The log stores `condition`
(the id) and the effective `turnCues`, `inertialSound` and `inertialAmbience`
configurations.

## Adding a condition

Add an entry to `CONDITIONS` in `src/conditions/conditions.ts`. The select,
the cycle order, the schema's `oneOf` and the `ConditionId` type follow from it.

## Adding a mitigation

1. Implement it as an A-Frame system with a schema. Its "off" state must be a
   schema value, since every condition configures it.
2. Import it in `conditions.ts` (that registers it before any condition is
   applied) and add its config type to `MitigationConfigs`.
   TypeScript then requires every condition to state its config.
3. Sounds use `getAudio(sceneEl).runningContext()` from
   `src/audio/audio-system.ts`.
4. Add what analysis needs to the session log (`session-recorder.ts`).
