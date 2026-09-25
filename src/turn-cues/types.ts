import type { Unsubscribe } from '../optical-flow/types';

export type TurnDirection = 'left' | 'right';

/** One raw turn estimate, as delivered by a `TurnSignalSource`. */
export type TurnSample = {
  sceneTimeMs: number;
  /** Interval the estimate was measured over, in milliseconds. */
  deltaMs: number;
  /**
   * Signed turn strength in the source's unit (see `TURN_SOURCE_UNITS`),
   * positive = left (counter-clockwise seen from above).
   */
  strength: number;
};

/** A raw sample together with the detector's denoised value. */
export type TurnSignal = TurnSample & {
  smoothed: number;
};

export type TurnCue = {
  sceneTimeMs: number;
  direction: TurnDirection;
  /** Smoothed turn strength that triggered the cue. */
  strength: number;
  /** Whether the output actually presented the cue (e.g. false while audio is still locked). */
  presented: boolean;
};

/** Where turn estimates come from (e.g. optical flow, rig kinematics). */
export type TurnSignalSource = {
  subscribe(listener: (sample: TurnSample) => void): Unsubscribe;
};

/**
 * How turns are presented to the user: discrete cues (e.g. a stereo tone per
 * turn), the continuous smoothed signal (e.g. a tone following the turn
 * strength), or both. An output ignores what it does not present.
 */
export type TurnOutput = {
  /** Called for every accepted sample with the smoothed turn strength. */
  signal(signal: TurnSignal): void;
  /** Presents a detected cue; returns whether it was actually presented. */
  present(direction: TurnDirection): boolean;
  dispose(): void;
};
