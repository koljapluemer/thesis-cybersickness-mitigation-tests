import 'aframe';
import type { Component, Scene } from 'aframe';
import { announceRigTeleport } from '../rig';

export type RoomLoopData = {
  /** Centre of the loop, A-Frame world coordinates; its y is the flight height. */
  center: { x: number; y: number; z: number };
  /** Half-axes of the horizontal ellipse along x and z, m. */
  radiusX: number;
  radiusZ: number;
  /** Time for one lap, s. */
  periodS: number;
};

export type RoomLoopComponent = Component<RoomLoopData> & {
  /** Current position on the loop in seconds. */
  pathTimeSec: number;
  /** Whether the rig has been put on the loop yet. */
  placed: boolean;
};

/**
 * PLACEHOLDER motion for Big Room until the drone flight exists: flies the rig
 * counter-clockwise (seen from above) around a horizontal ellipse at constant
 * angular rate, facing along the path.
 */
AFRAME.registerComponent('room-loop', {
  schema: {
    center: { type: 'vec3', default: { x: 0, y: 1.6, z: 0 } },
    radiusX: { type: 'number', default: 3 },
    radiusZ: { type: 'number', default: 2 },
    periodS: { type: 'number', default: 30 },
  },

  init(this: RoomLoopComponent) {
    this.pathTimeSec = 0;
    this.placed = false;
  },

  tick(this: RoomLoopComponent, time: number) {
    const { center, radiusX, radiusZ, periodS } = this.data;
    this.pathTimeSec = (time / 1000) % periodS;
    const angle = (2 * Math.PI * this.pathTimeSec) / periodS;

    this.el.object3D.position.set(
      center.x + radiusX * Math.cos(angle),
      center.y,
      center.z - radiusZ * Math.sin(angle),
    );
    // Face the velocity; the rig looks down −Z at rotation.y = 0.
    const vx = -radiusX * Math.sin(angle);
    const vz = -radiusZ * Math.cos(angle);
    this.el.object3D.rotation.set(0, Math.atan2(-vx, -vz), 0);

    if (!this.placed) {
      this.placed = true;
      announceRigTeleport(this.el.sceneEl as Scene);
    }
  },
});
