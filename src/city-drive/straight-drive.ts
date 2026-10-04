import 'aframe';
import type { Component, Scene } from 'aframe';
import { announceRigTeleport } from '../rig';

const THREE = AFRAME.THREE;

export type StraightDriveData = {
  /** Start on the ground, A-Frame world coordinates. */
  start: { x: number; y: number; z: number };
  /** Rotation about +Y; 0 faces −Z, the car model's front. */
  headingDeg: number;
  /** m/s², constant during the run. */
  acceleration: number;
  /** Length of the run, s. */
  durationS: number;
  /** Standstill at the start before each run, s. */
  holdS: number;
};

export type StraightDriveComponent = Component<StraightDriveData> & {
  /** Scene time at which the current cycle (hold, then run) began. */
  cycleStartMs: number | null;
  /** Completed and current cycles. */
  cycle: number;
  distanceM: number;
  speedMps: number;
};

/**
 * Drives the entity (the car, carrying the rig) along a straight horizontal
 * line, in cycles: it stands at `start` for `holdS`, then accelerates from
 * standstill at `acceleration` for `durationS`, then jumps back to `start`
 * (an announced rig teleport). Distance is evaluated at each frame's time,
 * so frame drops change smoothness but not the motion.
 */
AFRAME.registerComponent('straight-drive', {
  schema: {
    start: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    headingDeg: { type: 'number', default: 0 },
    acceleration: { type: 'number', default: 3 },
    durationS: { type: 'number', default: 10 },
    holdS: { type: 'number', default: 2 },
  },

  init(this: StraightDriveComponent) {
    this.cycleStartMs = null;
    this.cycle = 0;
    this.distanceM = 0;
    this.speedMps = 0;
  },

  tick(this: StraightDriveComponent, time: number) {
    const { start, headingDeg, acceleration, durationS, holdS } = this.data;

    if (this.cycleStartMs === null || (time - this.cycleStartMs) / 1000 >= holdS + durationS) {
      this.cycleStartMs = time;
      this.cycle += 1;
      this.distanceM = 0;
      this.speedMps = 0;
      this.el.object3D.position.set(start.x, start.y, start.z);
      this.el.object3D.rotation.set(0, THREE.MathUtils.degToRad(headingDeg), 0);
      announceRigTeleport(this.el.sceneEl as Scene);
      return;
    }

    const runS = Math.max(0, (time - this.cycleStartMs) / 1000 - holdS);
    this.distanceM = 0.5 * acceleration * runS * runS;
    this.speedMps = acceleration * runS;

    const heading = THREE.MathUtils.degToRad(headingDeg);
    this.el.object3D.position.set(
      start.x - Math.sin(heading) * this.distanceM,
      start.y,
      start.z - Math.cos(heading) * this.distanceM,
    );
  },
});
