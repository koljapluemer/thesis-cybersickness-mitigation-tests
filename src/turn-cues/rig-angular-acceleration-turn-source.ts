import type { RigKinematicsSystem } from '../rig-kinematics/rig-kinematics-system';
import type { TurnSample, TurnSignalSource } from './types';

/**
 * Turn strength as the rig's angular acceleration about its local up axis,
 * in °/s², positive = accelerating leftward. It leads the turn rate: the
 * onset of a turn cues its direction, and its end cues the opposite one.
 */
export function createRigAngularAccelerationTurnSource(kinematics: RigKinematicsSystem): TurnSignalSource {
  return {
    subscribe(listener: (sample: TurnSample) => void) {
      return kinematics.onSample((sample) => listener({
        sceneTimeMs: sample.sceneTimeMs,
        deltaMs: sample.deltaMs,
        strength: sample.localYawAccelerationDegPerSec2,
      }));
    },
  };
}
