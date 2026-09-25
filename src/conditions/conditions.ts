// Registers the mitigation systems configured below.
import '../turn-cues/turn-cue-system';
import type { TurnCueData } from '../turn-cues/turn-cue-system';

/**
 * Configuration of every mitigation system, keyed by its A-Frame system name.
 * Each condition must configure each mitigation; properties left out take the
 * system's schema defaults, never values from a previously selected condition.
 */
export type MitigationConfigs = {
  'turn-cues': Partial<TurnCueData>;
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

/** The experimental conditions, in select and cycle order. */
export const CONDITIONS = [
  {
    id: 'no-mitigation',
    label: 'No Mitigation',
    // Cues are still detected and logged, just not played: the silent control.
    mitigations: { 'turn-cues': { output: 'none' } },
  },
  {
    id: 'turn-tone-optical-flow',
    label: 'Turn Tone (Optical Flow)',
    mitigations: { 'turn-cues': { output: 'stereo-tone' } },
  },
  {
    id: 'flexible-tone-optical-flow',
    label: 'Flexible Tone (Optical Flow)',
    mitigations: { 'turn-cues': { output: 'flexible-tone' } },
  },
  {
    id: 'turn-tone-rig-acceleration',
    label: 'Turn Tone (Rig Angular Acceleration)',
    mitigations: { 'turn-cues': { ...RIG_ANGULAR_ACCELERATION, output: 'stereo-tone' } },
  },
  {
    id: 'flexible-tone-rig-acceleration',
    label: 'Flexible Tone (Rig Angular Acceleration)',
    mitigations: { 'turn-cues': { ...RIG_ANGULAR_ACCELERATION, output: 'flexible-tone' } },
  },
] as const satisfies readonly Condition[];

export type ConditionId = (typeof CONDITIONS)[number]['id'];

export const CONDITION_IDS: ConditionId[] = CONDITIONS.map((condition) => condition.id);
