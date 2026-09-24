# Experimental conditions

A condition is one combination of cybersickness mitigations. On desktop,
conditions are switched with the select in the bottom-left corner. In VR, the
B button on the right controller cycles through them; the select shows the
current one but is not meant to be used from VR.

| id | label | turn cues |
|---|---|---|
| `no-mitigation` | No Mitigation | detected and logged, not played |
| `turn-tones` | Turn Tones | stereo tones (`turn-cues.md`) |
| `flexible-tone` | Flexible Tone | continuous tone, per-ear loudness following the turn rate (`turn-cues.md`) |

## Architecture

Code lives in `src/conditions/`.

- **Mitigations** are A-Frame scene systems with a schema (so far only
  `turn-cues`). They know nothing about conditions and are configured only
  through their schema.
- **`conditions.ts`** is the registry: `CONDITIONS` lists each condition's id,
  label and `mitigations`, the config of *every* mitigation system
  (`MitigationConfigs`). Properties a condition leaves out take the system's
  schema defaults, never values from the previous condition.
- **`condition` system** (`condition-system.ts`, `condition="turn-tones"` on
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
(the id) and the effective `turnCues` configuration.

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
