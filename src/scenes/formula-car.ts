import type { Scene } from 'aframe';
import '../rig-fixed';
import { rigMarkup } from './rig-markup';
import { queryEntity, rigModel, type SceneDescription } from './scene-definition';

export const FORMULA_CAR_SRC = '/car-race/car-formula-red.glb';
/** Driver's eye in the car model: above the windscreen, where the (removed) helmet was. */
const SEAT_POSITION = '0 1.05 0.1';

/** Goes into the scene's `<a-assets>`. */
export const FORMULA_CAR_ASSET = `<a-asset-item id="formula-car" src="${FORMULA_CAR_SRC}"></a-asset-item>`;

/**
 * The formula car with the rig on its seat. `motion` goes on `#car`, the
 * entity whose origin is the car's centre on the ground and which the motion
 * component moves; the body is `rig-fixed`.
 */
export function formulaCarMarkup(motion: string): string {
  return `
    <a-entity id="car" ${motion}>
      <a-entity id="car-body" gltf-model="#formula-car" rig-fixed></a-entity>
      ${rigMarkup(`position="${SEAT_POSITION}"`)}
    </a-entity>
  `;
}

/** The car body for `SceneDescription.rigFixedModels`. */
export function formulaCarModel(sceneEl: Scene): SceneDescription['rigFixedModels'][number] {
  return rigModel(queryEntity(sceneEl, '#car-body'), queryEntity(sceneEl, '#rig'), FORMULA_CAR_SRC);
}
