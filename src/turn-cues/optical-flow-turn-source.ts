import type { OpticalFlowSystem } from '../optical-flow/optical-flow-system';
import type { FlowComponentStats } from '../optical-flow/types';
import type { TurnSample, TurnSignalSource } from './types';

/**
 * Turn rate from the horizontal flow the rig motion alone produces.
 *
 * A yaw of the rig moves the whole image sideways by the same angular rate,
 * independent of depth. Forward motion moves the left and right half of the
 * image in opposite directions (expansion), with rates that depend on depth.
 * So the lateral motion both halves share, the smaller of the two if they
 * agree in sign and zero otherwise, is the rotation, even over asymmetric
 * terrain. The image moving right means the rig turns left.
 */
export function sharedLateralTurnDegPerSec(rigInduced: FlowComponentStats): number {
  const { leftMeanDegPerSec: left, rightMeanDegPerSec: right } = rigInduced.horizontal;

  if (Math.sign(left) !== Math.sign(right)) {
    return 0;
  }

  return Math.sign(left) * Math.min(Math.abs(left), Math.abs(right));
}

export function createOpticalFlowTurnSource(meter: OpticalFlowSystem): TurnSignalSource {
  return {
    subscribe(listener: (sample: TurnSample) => void) {
      return meter.onSample((sample) => listener({
        sceneTimeMs: sample.sceneTimeMs,
        deltaMs: sample.deltaMs,
        turnDegPerSec: sharedLateralTurnDegPerSec(sample.combined.rigInduced),
      }));
    },
  };
}
