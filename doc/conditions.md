# Experimental conditions

A condition is one combination of cybersickness mitigations. On desktop,
conditions are switched with the select in the bottom-left corner. In VR, the
B button on the right controller cycles through them; the select shows the
current one but is not meant to be used from VR.

| id | label | turn cues | inertial sound |
|---|---|---|---|
| `no-mitigation` | No Mitigation | detected and logged, not played | off |
| `turn-tone-optical-flow` | Turn Tone (Optical Flow) | stereo tones, turns from the optical flow (`turn-cues.md`) | off |
| `flexible-tone-optical-flow` | Flexible Tone (Optical Flow) | continuous tone, per-ear loudness following the optical-flow turn rate | off |
| `turn-tone-rig-acceleration` | Turn Tone (Rig Angular Acceleration) | stereo tones, turns from the rig's angular acceleration about its local up axis | off |
| `flexible-tone-rig-acceleration` | Flexible Tone (Rig Angular Acceleration) | continuous tone, per-ear loudness following that angular acceleration | off |
| `inertial-motor-sound` | Inertial Motor Sound | detected and logged, not played | on: world-anchored motor sound lagging behind the rig's rotation (`inertial-sound.md`) |

## Architecture

Code lives in `src/conditions/`.

- **Mitigations** are A-Frame scene systems with a schema (`turn-cues`,
  `inertial-sound`). They know nothing about conditions and are configured only
  through their schema.
- **`conditions.ts`** is the registry: `CONDITIONS` lists each condition's id,
  label and `mitigations`, the config of *every* mitigation system
  (`MitigationConfigs`). Properties a condition leaves out take the system's
  schema defaults, never values from the previous condition.
- **`condition` system** (`condition-system.ts`, `condition="turn-tone-optical-flow"` on
  `<a-scene>`) applies a condition by writing each mitigation's config with
  `sceneEl.setAttribute(system, …)`. A-Frame then runs that system's `update`.
  API through `getCondition(sceneEl)`: `state` (id, label, locked),
  `select(id)`, `cycle()`, `lock()`, `onChange(listener)`.
- **`condition-select.ts`** mounts the DOM `<select>`: one option per
  condition, kept in sync through `onChange`, disabled while locked.
- **`condition-cycle` component** (`condition-cycle.ts`) calls `cycle()` on an
  entity event. In `main.ts` it sits on a model-less
  `meta-touch-controls="hand: right"` entity with `event: bbuttondown`.

## Recording

The recorder locks the condition for the whole recording: the select is
disabled, and the B button does nothing. The log stores `condition`
(the id) and the effective `turnCues` and `inertialSound` configurations.

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
