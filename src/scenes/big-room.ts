import '../big-room/room-loop';
import type { RoomLoopComponent } from '../big-room/room-loop';
import { rigMarkup } from './rig-markup';
import { queryEntity, worldModel, type SceneDefinition } from './scene-definition';

const ROOM_SRC = '/big_room.glb';

/**
 * The model's units are about 2 cm (ceiling ≈ 157 units). Its floor is at y = 0;
 * the position centres its bounding box horizontally on the origin.
 */
const ROOM_TRANSFORM = { position: '-10.18 0 5.84', scale: 0.02 };

/** A flight through a furnished loft. The rig motion is a placeholder loop. */
export const BIG_ROOM = {
  id: 'big-room',
  label: 'Big Room',
  referenceSpaceType: 'local',

  markup: () => `
    <a-assets timeout="60000">
      <a-asset-item id="big-room-model" src="${ROOM_SRC}"></a-asset-item>
    </a-assets>

    <a-entity
      id="room"
      gltf-model="#big-room-model"
      position="${ROOM_TRANSFORM.position}"
      scale="${ROOM_TRANSFORM.scale} ${ROOM_TRANSFORM.scale} ${ROOM_TRANSFORM.scale}"
    ></a-entity>

    ${rigMarkup('room-loop="center: 0 1.6 0; radiusX: 3; radiusZ: 2; periodS: 30"')}
  `,

  recording(sceneEl) {
    const roomEl = queryEntity(sceneEl, '#room');
    const loop = queryEntity(sceneEl, '#rig').components['room-loop'] as unknown as RoomLoopComponent;

    return {
      describe: () => ({
        id: 'big-room',
        staticModels: [worldModel(roomEl, ROOM_SRC)],
        rigFixedModels: [],
        motion: { component: 'room-loop', config: { ...loop.data } },
      }),
      frameState: () => ({ pathTimeSec: loop.pathTimeSec }),
    };
  },
} as const satisfies SceneDefinition<'big-room', { pathTimeSec: number }>;
