import 'aframe';
import type { Component, Scene } from 'aframe';
import { announceRigTeleport } from '../rig';
import { CarPhysics, type CarGeometry, type CarPose, type CarTuning } from './car-physics';
import { DriveInput, type DriveInputState } from './drive-input';
import { TrackWalls, type GroundPoint } from './track-walls';

const THREE = AFRAME.THREE;

/** `public/car-race/track.json`: wall polylines, spawn pose and car dimensions, in metres. */
type TrackData = {
  walls: GroundPoint[][];
  spawn: { position: [number, number, number]; headingDeg: number };
  car: CarGeometry & { height: number };
};

export type CarDriveData = CarTuning & {
  src: string;
};

export type CarDriveComponent = Component<CarDriveData> & {
  car: CarPhysics | null;
  spawn: CarPose | null;
  input: DriveInput;
  /** Input applied in the latest frame. */
  lastInput: DriveInputState;
  place(pose: CarPose): void;
};

async function loadTrack(src: string): Promise<TrackData> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`Failed to load track from ${src}.`);
  }

  return (await response.json()) as TrackData;
}

/**
 * Drives the entity as a car on the track in `src`, from `DriveInput`. The
 * entity's origin is the car's centre of mass on the ground; the rig (seat)
 * is a child of it. Starts at the track's spawn, which the reset input
 * returns to.
 */
AFRAME.registerComponent('car-drive', {
  schema: {
    src: { type: 'string', default: '/car-race/track.json' },
    topSpeed: { type: 'number', default: 45 },
    acceleration: { type: 'number', default: 8 },
    brakeDeceleration: { type: 'number', default: 16 },
    reverseSpeed: { type: 'number', default: 8 },
    maxSteerDeg: { type: 'number', default: 30 },
    steerFalloffSpeed: { type: 'number', default: 12 },
    grip: { type: 'number', default: 1.6 },
  },

  init(this: CarDriveComponent) {
    this.car = null;
    this.spawn = null;
    this.input = new DriveInput(this.el.sceneEl as Scene);
    this.lastInput = { steer: 0, throttle: 0, brake: 0, reset: false };

    void loadTrack(this.data.src).then((track) => {
      this.car = new CarPhysics(track.car, this.data, new TrackWalls(track.walls));
      this.spawn = {
        x: track.spawn.position[0],
        z: track.spawn.position[2],
        heading: THREE.MathUtils.degToRad(track.spawn.headingDeg),
      };
      this.place(this.spawn);
    }).catch((error: unknown) => {
      console.error(error);
    });
  },

  remove(this: CarDriveComponent) {
    this.input.dispose();
  },

  place(this: CarDriveComponent, pose: CarPose) {
    this.car?.reset(pose);
    this.el.object3D.position.set(pose.x, 0, pose.z);
    this.el.object3D.rotation.set(0, pose.heading, 0);
    announceRigTeleport(this.el.sceneEl as Scene);
  },

  tick(this: CarDriveComponent, _time: number, timeDelta: number) {
    const dtSec = timeDelta / 1000;
    this.lastInput = this.input.read(dtSec);

    if (!this.car || !this.spawn) {
      return;
    }

    if (this.lastInput.reset) {
      this.place(this.spawn);
      return;
    }

    this.car.advance(this.lastInput, dtSec);
    const { x, z, heading } = this.car.state;
    this.el.object3D.position.set(x, 0, z);
    this.el.object3D.rotation.set(0, heading, 0);
  },
});
