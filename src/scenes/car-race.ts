import '../car-race/car-drive';
import type { CarDriveComponent } from '../car-race/car-drive';
import { FORMULA_CAR_ASSET, formulaCarMarkup, formulaCarModel } from './formula-car';
import { queryEntity, worldModel, type SceneDefinition } from './scene-definition';

const THREE = AFRAME.THREE;

const TRACK_SRC = '/car-race/track.glb';

type CarRaceFrameState = {
  /** Along the car's forward axis, m/s (negative when reversing). */
  speedMps: number;
  yawRateDegPerSec: number;
  steerAngleDeg: number;
  /** Input, see `DriveCommand`. */
  steer: number;
  throttle: number;
  brake: number;
};

/** The player drives a formula car around a race track, seen from the cockpit. */
export const CAR_RACE = {
  id: 'car-race',
  label: 'Car Race',
  referenceSpaceType: 'local',

  markup: () => `
    <a-assets>
      <a-asset-item id="race-track" src="${TRACK_SRC}"></a-asset-item>
      ${FORMULA_CAR_ASSET}
    </a-assets>

    <a-entity id="track" gltf-model="#race-track"></a-entity>

    ${formulaCarMarkup('car-drive')}
  `,

  recording(sceneEl) {
    const trackEl = queryEntity(sceneEl, '#track');
    const carDrive = queryEntity(sceneEl, '#car').components['car-drive'] as unknown as CarDriveComponent;
    const toDeg = THREE.MathUtils.radToDeg;

    return {
      describe: () => ({
        id: 'car-race',
        staticModels: [worldModel(trackEl, TRACK_SRC)],
        rigFixedModels: [formulaCarModel(sceneEl)],
        motion: { component: 'car-drive', config: { ...carDrive.data, spawn: carDrive.spawn } },
      }),
      frameState: () => {
        const car = carDrive.car?.state;
        const { steer, throttle, brake } = carDrive.lastInput;
        return {
          speedMps: car?.forwardSpeed ?? 0,
          yawRateDegPerSec: toDeg(car?.yawRate ?? 0),
          steerAngleDeg: toDeg(car?.steerAngle ?? 0),
          steer,
          throttle,
          brake,
        };
      },
    };
  },
} as const satisfies SceneDefinition<'car-race', CarRaceFrameState>;
