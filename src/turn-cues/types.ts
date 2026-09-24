import type { Unsubscribe } from '../optical-flow/types';

export type TurnDirection = 'left' | 'right';

/** One raw turn-rate estimate, as delivered by a `TurnSignalSource`. */
export type TurnSample = {
  sceneTimeMs: number;
  /** Interval the estimate was measured over, in milliseconds. */
  deltaMs: number;
  /** Turn rate of the rig in degrees per second, positive = left (counter-clockwise seen from above). */
  turnDegPerSec: number;
};

/** A raw sample together with the detector's denoised value. */
export type TurnSignal = TurnSample & {
  smoothedDegPerSec: number;
};

export type TurnCue = {
  sceneTimeMs: number;
  direction: TurnDirection;
  /** Smoothed turn rate that triggered the cue. */
  turnDegPerSec: number;
  /** Whether the output actually presented the cue (e.g. false while audio is still locked). */
  presented: boolean;
};

/** Where turn-rate estimates come from (e.g. optical flow, later rig kinematics). */
export type TurnSignalSource = {
  subscribe(listener: (sample: TurnSample) => void): Unsubscribe;
};

/** How a cue is presented to the user (e.g. a stereo tone). */
export type CueOutput = {
  /** Presents the cue; returns whether it was actually presented. */
  present(direction: TurnDirection): boolean;
  dispose(): void;
};
