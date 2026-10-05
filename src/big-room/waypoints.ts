import type { Vec3 } from './min-snap';

/**
 * The drone's loop through the room, in world coordinates (m, y up), flown in
 * this order and back to the first. Edit them in the A-Frame inspector and
 * paste the literal `drone-flight` logs back here (see `doc/scenes.md`).
 */
export const WAYPOINTS: Vec3[] = [
  [-4.5, 1.2, -1.5],
  [-1.8, 1.6, -1.9],
  // Figure eight over the couch (x −2.5…0.1, z −0.6…0.4, 0.7 m high), crossing at its centre.
  [-1.2, 1.5, -0.1],
  [-0.1, 1.6, 0.8],
  [0.6, 1.7, -0.1],
  [-0.1, 1.6, -1],
  [-1.2, 1.5, -0.1],
  [-2.3, 1.6, 0.8],
  [-3, 1.7, -0.1],
  [-2.3, 1.6, -1],
  [2.5, 1.2, -2],
  [3, 1, 0.5],
  [2, 1.4, 2.5],
  [0, 0.9, 3],
  [-3, 1.5, 3],
  [-5, 1.3, 1],
];
