import '../audio/ambient-sound';
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

/**
 * Looped ambient sounds, in world coordinates. The fridge (the model's
 * `Frridge` material, x 3.7…4.5, z 3.3…4.2, 1.7 m high) hums near its base;
 * the birds sing outside the window front (`Finestre`, x −5…1.6 at z ≈ −2.9);
 * the construction site is outside the opposite wall (z ≈ 5), across from the
 * bike (`Bici`, x −4…−1.9, z ≈ −2.4); the ventilation hums above the big book
 * shelf (`ScaffaleLibri`, x ≈ 6, z −4.8…−0.8, 1.9 m high).
 */
const AMBIENT_SOUNDS = [
  { id: 'fridge-sound', src: '/refrigerator-sound-effect.mp3', position: '4.1 0.4 3.7', gain: 0.4, refDistance: 1 },
  { id: 'bird-sound', src: '/morning-birds-singing.mp3', position: '-1.7 4 -7', gain: 0.6, refDistance: 4 },
  {
    id: 'construction-sound',
    src: '/exterior-of-construction-site-with-some-background-noises.mp3',
    position: '-2.9 1.5 5.5',
    gain: 0.5,
    refDistance: 3,
  },
  { id: 'ventilation-sound', src: '/restaurant-kitchen-ventilation-noise.mp3', position: '6 2.5 -2.4', gain: 0.3, refDistance: 1.5 },
] as const;

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

    ${AMBIENT_SOUNDS.map(({ id, src, position, gain, refDistance }) => `
    <a-entity id="${id}" position="${position}" ambient-sound="src: ${src}; gain: ${gain}; refDistance: ${refDistance}"></a-entity>`).join('')}

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
