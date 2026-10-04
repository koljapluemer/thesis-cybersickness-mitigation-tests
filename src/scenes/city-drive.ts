import '../city-drive/straight-drive';
import type { StraightDriveComponent } from '../city-drive/straight-drive';
import { startPose } from '../city-drive/start-pose';
import { FORMULA_CAR_ASSET, formulaCarMarkup, formulaCarModel } from './formula-car';
import { queryEntity, worldModel, type SceneDefinition } from './scene-definition';

const CITY_SRC = '/city/city.glb';
const SKY_SRC = '/city/sky.jpg';

/** The run: from standstill, `acceleration` m/s² for `durationS` s, after `holdS` s at the start. */
const RUN = { acceleration: 3, durationS: 6.5, holdS: 2 };

type CityDriveFrameState = {
  cycle: number;
  /** From the start along the heading, m. */
  distanceM: number;
  speedMps: number;
};

/**
 * The formula car stands in a city street, then accelerates straight ahead
 * for a fixed time and jumps back to the start, in a loop. The player only
 * looks around.
 */
export const CITY_DRIVE = {
  id: 'city-drive',
  label: 'City Drive',
  referenceSpaceType: 'local',

  markup: () => {
    const { start, headingDeg } = startPose();
    const motion = `straight-drive="start: ${start}; headingDeg: ${headingDeg}; acceleration: ${RUN.acceleration}; durationS: ${RUN.durationS}; holdS: ${RUN.holdS}"`;

    return `
      <a-assets timeout="60000">
        <a-asset-item id="city-model" src="${CITY_SRC}"></a-asset-item>
        <img id="city-sky" src="${SKY_SRC}" crossorigin="anonymous">
        ${FORMULA_CAR_ASSET}
      </a-assets>

      <a-sky src="#city-sky" radius="900"></a-sky>
      <a-entity id="city" gltf-model="#city-model"></a-entity>

      ${formulaCarMarkup(motion)}
    `;
  },

  recording(sceneEl) {
    const cityEl = queryEntity(sceneEl, '#city');
    const drive = queryEntity(sceneEl, '#car').components['straight-drive'] as unknown as StraightDriveComponent;

    return {
      describe: () => ({
        id: 'city-drive',
        staticModels: [worldModel(cityEl, CITY_SRC)],
        rigFixedModels: [formulaCarModel(sceneEl)],
        motion: { component: 'straight-drive', config: { ...drive.data } },
      }),
      frameState: () => ({ cycle: drive.cycle, distanceM: drive.distanceM, speedMps: drive.speedMps }),
    };
  },
} as const satisfies SceneDefinition<'city-drive', CityDriveFrameState>;
