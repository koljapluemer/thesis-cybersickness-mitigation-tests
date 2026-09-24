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

/** The experimental conditions, in select and cycle order. */
export const CONDITIONS = [
  {
    id: 'no-mitigation',
    label: 'No Mitigation',
    // Cues are still detected and logged, just not played: the silent control.
    mitigations: { 'turn-cues': { output: 'none' } },
  },
  {
    id: 'turn-tones',
    label: 'Turn Tones',
    mitigations: { 'turn-cues': { output: 'stereo-tone' } },
  },
] as const satisfies readonly Condition[];

export type ConditionId = (typeof CONDITIONS)[number]['id'];

export const CONDITION_IDS: ConditionId[] = CONDITIONS.map((condition) => condition.id);
