// Registers the mitigation systems configured below.
import '../inertial-sound/inertial-sound-system';
import type { InertialSoundData } from '../inertial-sound/inertial-sound-system';
import '../turn-cues/turn-cue-system';
import type { TurnCueData } from '../turn-cues/turn-cue-system';

/**
 * Configuration of every mitigation system, keyed by its A-Frame system name.
 * Each condition must configure each mitigation; properties left out take the
 * system's schema defaults, never values from a previously selected condition.
 */
export type MitigationConfigs = {
  'turn-cues': Partial<TurnCueData>;
  'inertial-sound': Partial<InertialSoundData>;
};

export type Condition = {
  id: string;
  /** Shown in the condition select. */
  label: string;
  mitigations: MitigationConfigs;
};

/**
 * Turn strength from the rig's angular acceleration about its local up axis,
 * in °/s². Untuned: the smoothed signal of a recorded tour stays below ~10 °/s²
 * 90 % of the time and peaks around 40 °/s².
 */
const RIG_ANGULAR_ACCELERATION = {
  source: 'rig-angular-acceleration',
  onThreshold: 10,
  offThreshold: 4,
  fullScale: 30,
} as const satisfies Partial<TurnCueData>;

const NO_INERTIAL_SOUND = { enabled: false } as const satisfies Partial<InertialSoundData>;

/** The experimental conditions, in select and cycle order. */
export const CONDITIONS = [
  {
    id: 'no-mitigation',
    label: 'No Mitigation',
    // Cues are still detected and logged, just not played: the silent control.
    mitigations: { 'turn-cues': { output: 'none' }, 'inertial-sound': NO_INERTIAL_SOUND },
  },
  {
    id: 'turn-tone-optical-flow',
    label: 'Turn Tone (Optical Flow)',
    mitigations: { 'turn-cues': { output: 'stereo-tone' }, 'inertial-sound': NO_INERTIAL_SOUND },
  },
  {
    id: 'flexible-tone-optical-flow',
    label: 'Flexible Tone (Optical Flow)',
    mitigations: { 'turn-cues': { output: 'flexible-tone' }, 'inertial-sound': NO_INERTIAL_SOUND },
  },
  {
    id: 'turn-tone-rig-acceleration',
    label: 'Turn Tone (Rig Angular Acceleration)',
    mitigations: {
      'turn-cues': { ...RIG_ANGULAR_ACCELERATION, output: 'stereo-tone' },
      'inertial-sound': NO_INERTIAL_SOUND,
    },
  },
  {
    id: 'flexible-tone-rig-acceleration',
    label: 'Flexible Tone (Rig Angular Acceleration)',
    mitigations: {
      'turn-cues': { ...RIG_ANGULAR_ACCELERATION, output: 'flexible-tone' },
      'inertial-sound': NO_INERTIAL_SOUND,
    },
  },
  // Inertial sound conditions: turn cues are detected and logged as in the control, not played.
  {
    id: 'inertial-motor-sound-constant',
    label: 'Inertial Motor Sound (Constant Pitch)',
    mitigations: { 'turn-cues': { output: 'none' }, 'inertial-sound': { enabled: true, revWithLag: false } },
  },
  {
    id: 'inertial-motor-sound-revving',
    label: 'Inertial Motor Sound (Revving Pitch)',
    mitigations: { 'turn-cues': { output: 'none' }, 'inertial-sound': { enabled: true, revWithLag: true } },
  },
] as const satisfies readonly Condition[];

export type ConditionId = (typeof CONDITIONS)[number]['id'];

export const CONDITION_IDS: ConditionId[] = CONDITIONS.map((condition) => condition.id);
