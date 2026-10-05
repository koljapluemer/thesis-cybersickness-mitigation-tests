import '../big-room/drone-flight';
import type { DroneFlightComponent } from '../big-room/drone-flight';
import type { MinSnapLoop } from '../big-room/min-snap';
import { WAYPOINTS } from '../big-room/waypoints';
import { rigMarkup } from './rig-markup';
import { queryEntity, worldModel, type SceneDefinition } from './scene-definition';

const ROOM_SRC = '/big_room.glb';

/**
 * The model's units are about 2 cm (ceiling ≈ 157 units). Its floor is at y = 0;
 * the position centres its bounding box horizontally on the origin.
 */
const ROOM_TRANSFORM = { position: '-10.18 0 5.84', scale: 0.02 };

/** Waypoint markers, shown only while the scene is paused (in the inspector). */
const waypointMarkup = ([x, y, z]: readonly number[]) => `
  <a-entity
    class="drone-waypoint"
    position="${x} ${y} ${z}"
    geometry="primitive: sphere; radius: 0.08"
    material="color: #ff8800; shader: flat"
  ></a-entity>`;

/** A drone flight through a furnished loft, on a loop through editable waypoints. */
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

    <a-entity id="drone-waypoints">${WAYPOINTS.map(waypointMarkup).join('')}
    </a-entity>

    ${rigMarkup('drone-flight="waypoints: #drone-waypoints"')}
  `,

  recording(sceneEl) {
    const roomEl = queryEntity(sceneEl, '#room');
    const flight = queryEntity(sceneEl, '#rig').components['drone-flight'] as unknown as DroneFlightComponent;

    return {
      describe: () => {
        const { cruiseSpeed, maxSpeed, maxAcceleration, tiltCoupling } = flight.data;
        const loop = flight.loop as MinSnapLoop;

        return {
          id: 'big-room',
          staticModels: [worldModel(roomEl, ROOM_SRC)],
          rigFixedModels: [],
          motion: {
            component: 'drone-flight',
            config: { cruiseSpeed, maxSpeed, maxAcceleration, tiltCoupling, waypoints: loop.points, segmentDurations: loop.durations },
          },
        };
      },
      frameState: () => ({ pathTimeSec: flight.pathTimeSec, speedMps: flight.speedMps }),
    };
  },
} as const satisfies SceneDefinition<'big-room', { pathTimeSec: number; speedMps: number }>;
