import type { Vec3 } from './min-snap';

/**
 * The drone's loop through the room, in world coordinates (m, y up), flown in
 * this order and back to the first. Edit them in the A-Frame inspector and
 * paste the literal `drone-flight` logs back here (see `doc/scenes.md`).
 */
export const WAYPOINTS: Vec3[] = [
  [-4.5, 1.2, -1.5],
  [-1, 1.6, -2],
  [2.5, 1.2, -2],
  [3, 1, 0.5],
  [2, 1.4, 2.5],
  [0, 0.9, 3],
  [-3, 1.5, 3],
  [-5, 1.3, 1],
];
