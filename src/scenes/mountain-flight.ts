import '../tour-flight';
import type { TourFlightComponent } from '../tour-flight';
import { rigMarkup } from './rig-markup';
import { queryEntity, worldModel, type SceneDefinition } from './scene-definition';

const LANDSCAPE_SRC = '/mountains/scene.gltf';

/** Automatic helicopter flight along a scripted path over a mountain landscape. */
export const MOUNTAIN_FLIGHT = {
  id: 'mountain-flight',
  label: 'Mountain Flight',
  referenceSpaceType: 'local-floor',

  markup: () => `
    <a-assets>
      <a-asset-item id="mountain-landscape" src="${LANDSCAPE_SRC}"></a-asset-item>
    </a-assets>

    <a-entity
      id="landscape"
      gltf-model="#mountain-landscape"
      position="0 2.7 0"
      scale="220 220 220"
      rotation="0 18 0"
    ></a-entity>

    ${rigMarkup('tour-flight="src: /tour-path.json; scale: 220; offset: 0 2.7 0; rotationY: 18; pitch: 30"')}
  `,

  recording(sceneEl) {
    const landscapeEl = queryEntity(sceneEl, '#landscape');
    const tourFlight = queryEntity(sceneEl, '#rig').components['tour-flight'] as unknown as TourFlightComponent;

    return {
      describe: () => ({
        id: 'mountain-flight',
        staticModels: [worldModel(landscapeEl, LANDSCAPE_SRC)],
        rigFixedModels: [],
        motion: { component: 'tour-flight', config: { ...tourFlight.data } },
      }),
      frameState: () => ({ pathTimeSec: tourFlight.pathTimeSec }),
    };
  },
} as const satisfies SceneDefinition<'mountain-flight', { pathTimeSec: number }>;
