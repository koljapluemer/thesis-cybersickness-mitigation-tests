// Registers the mitigation systems configured below.
import '../inertial-ambience/inertial-ambience-system';
import type { InertialAmbienceData } from '../inertial-ambience/inertial-ambience-system';
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
  'inertial-ambience': Partial<InertialAmbienceData>;
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
const NO_INERTIAL_AMBIENCE = { enabled: false } as const satisfies Partial<InertialAmbienceData>;

/** The experimental conditions, in select and cycle order. */
export const CONDITIONS = [
  {
    id: 'no-mitigation',
    label: 'No Mitigation',
    // Cues are still detected and logged, just not played: the silent control.
    mitigations: { 'turn-cues': { output: 'none' }, 'inertial-sound': NO_INERTIAL_SOUND, 'inertial-ambience': NO_INERTIAL_AMBIENCE },
  },
  {
    id: 'turn-tone-optical-flow',
    label: 'Turn Tone (Optical Flow)',
    mitigations: { 'turn-cues': { output: 'stereo-tone' }, 'inertial-sound': NO_INERTIAL_SOUND, 'inertial-ambience': NO_INERTIAL_AMBIENCE },
  },
  {
    id: 'flexible-tone-optical-flow',
    label: 'Flexible Tone (Optical Flow)',
    mitigations: { 'turn-cues': { output: 'flexible-tone' }, 'inertial-sound': NO_INERTIAL_SOUND, 'inertial-ambience': NO_INERTIAL_AMBIENCE },
  },
  {
    id: 'turn-tone-rig-acceleration',
    label: 'Turn Tone (Rig Angular Acceleration)',
    mitigations: {
      'turn-cues': { ...RIG_ANGULAR_ACCELERATION, output: 'stereo-tone' },
      'inertial-sound': NO_INERTIAL_SOUND,
      'inertial-ambience': NO_INERTIAL_AMBIENCE,
    },
  },
  {
    id: 'flexible-tone-rig-acceleration',
    label: 'Flexible Tone (Rig Angular Acceleration)',
    mitigations: {
      'turn-cues': { ...RIG_ANGULAR_ACCELERATION, output: 'flexible-tone' },
      'inertial-sound': NO_INERTIAL_SOUND,
      'inertial-ambience': NO_INERTIAL_AMBIENCE,
    },
  },
  // Inertial sound conditions: turn cues are detected and logged as in the control, not played.
  {
    id: 'inertial-motor-sound-constant',
    label: 'Inertial Motor Sound (Constant Pitch)',
    mitigations: {
      'turn-cues': { output: 'none' },
      'inertial-sound': { enabled: true, revWithLag: false, lagGain: 7 },
      'inertial-ambience': NO_INERTIAL_AMBIENCE,
    },
  },
  {
    id: 'inertial-motor-sound-revving',
    label: 'Inertial Motor Sound (Revving Pitch)',
    mitigations: {
      'turn-cues': { output: 'none' },
      'inertial-sound': { enabled: true, revWithLag: true },
      'inertial-ambience': NO_INERTIAL_AMBIENCE,
    },
  },
  {
    id: 'inertial-motor-sound-linear',
    label: 'Inertial Motor Sound (Linear Acceleration)',
    mitigations: {
      'turn-cues': { output: 'none' },
      // Straight below the listener (rig frame), shifted by the rig's linear acceleration only. Untuned.
      'inertial-sound': { enabled: true, motion: 'translation', elevationDeg: -90, naturalPeriodMs: 2000 },
      'inertial-ambience': NO_INERTIAL_AMBIENCE,
    },
  },
  // Inertial ambience conditions: the scene's own ambient sounds follow the
  // inertial sphere's lag (doc/inertial-ambience.md), turned about the head
  // (`effect: 'rotation'`, the default) or tilted in level (`effect: 'loudness'`).
  // Only the Big Room has ambient sounds; elsewhere these play nothing. Tune them
  // here, per condition, e.g. `lagGain: 3, maxLagDeg: 60, naturalPeriodMs: 6000`
  // or `maxGainDb: 9`; the defaults are in the schema of
  // `src/inertial-ambience/inertial-ambience-system.ts`.
  {
    id: 'inertial-ambience-against-acceleration',
    label: 'Inertial Ambience (Against Acceleration)',
    mitigations: {
      'turn-cues': { output: 'none' },
      'inertial-sound': NO_INERTIAL_SOUND,
      'inertial-ambience': { enabled: true, swing: 'against-acceleration' },
    },
  },
  {
    id: 'inertial-ambience-with-acceleration',
    label: 'Inertial Ambience (With Acceleration)',
    mitigations: {
      'turn-cues': { output: 'none' },
      'inertial-sound': NO_INERTIAL_SOUND,
      'inertial-ambience': { enabled: true, swing: 'with-acceleration' },
    },
  },
  {
    id: 'inertial-ambience-loudness-against-acceleration',
    label: 'Inertial Ambience Loudness (Against Acceleration)',
    mitigations: {
      'turn-cues': { output: 'none' },
      'inertial-sound': NO_INERTIAL_SOUND,
      'inertial-ambience': { enabled: true, effect: 'loudness', swing: 'against-acceleration' },
    },
  },
  {
    id: 'inertial-ambience-loudness-with-acceleration',
    label: 'Inertial Ambience Loudness (With Acceleration)',
    mitigations: {
      'turn-cues': { output: 'none' },
      'inertial-sound': NO_INERTIAL_SOUND,
      'inertial-ambience': { enabled: true, effect: 'loudness', swing: 'with-acceleration' },
    },
  },
] as const satisfies readonly Condition[];

export type ConditionId = (typeof CONDITIONS)[number]['id'];

export const CONDITION_IDS: ConditionId[] = CONDITIONS.map((condition) => condition.id);
