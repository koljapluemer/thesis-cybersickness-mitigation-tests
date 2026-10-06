import 'aframe';
import type { Component, Entity, Scene } from 'aframe';
import { announceRigTeleport } from '../rig';
import { forEachSample, planLoop, sampleLoop, type FlightLimits, type MinSnapLoop, type Vec3 } from './min-snap';

const THREE = AFRAME.THREE;

const GRAVITY = 9.81;
/** Below this the heading (direction of horizontal travel) is undefined, m/s. */
const MIN_HORIZONTAL_SPEED = 0.2;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const PREVIEW_COLOR = '#ff8800';

export type DroneFlightData = FlightLimits & {
  /** Parent entity whose child entities are the waypoints, in order. */
  waypoints: Entity;
  /** 0: the rig only yaws (level horizon); 1: it leans like the drone (thrust axis along a + g). */
  tiltCoupling: number;
};

export type DroneFlightComponent = Component<DroneFlightData> & {
  loop: MinSnapLoop | null;
  /** Current position on the loop, s. */
  pathTimeSec: number;
  speedMps: number;
  teleportPending: boolean;
  previewVisible: boolean;
  watched: Entity[];
  onWaypointChange: (event: Event) => void;
  onWaypointsChange: () => void;
  heading: InstanceType<typeof THREE.Vector3>;
  up: InstanceType<typeof THREE.Vector3>;
  right: InstanceType<typeof THREE.Vector3>;
  back: InstanceType<typeof THREE.Vector3>;
  basis: InstanceType<typeof THREE.Matrix4>;
  tilted: InstanceType<typeof THREE.Quaternion>;
};

function waypointEntities(component: DroneFlightComponent): Entity[] {
  return Array.from(component.data.waypoints.children).filter((child): child is Entity => (child as { isEntity?: boolean }).isEntity === true);
}

function samePoints(a: Vec3[], b: Vec3[]): boolean {
  return a.length === b.length && a.every((point, i) => point.every((value, axis) => value === b[i][axis]));
}

/** The loop through `points`, checked to keep moving horizontally (the rig faces its horizontal velocity). */
function planFlight(points: Vec3[], limits: FlightLimits): MinSnapLoop {
  const loop = planLoop(points, limits);

  forEachSample(loop, ({ velocity }, segment) => {
    if (Math.hypot(velocity[0], velocity[2]) < MIN_HORIZONTAL_SPEED) {
      throw new Error(
        `Drone flight: horizontal speed drops below ${MIN_HORIZONTAL_SPEED} m/s between waypoints ${segment} and ${(segment + 1) % points.length}, so the heading is undefined there. Move them further apart horizontally.`,
      );
    }
  });

  return loop;
}

function waypointsLiteral(points: Vec3[]): string {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `export const WAYPOINTS: Vec3[] = [\n${points.map((point) => `  [${point.map(round).join(', ')}],`).join('\n')}\n];`;
}

/** Faces the horizontal velocity; `up` is the rig's up axis. Writes the rotation into `target`. */
function setAttitude(component: DroneFlightComponent, up: InstanceType<typeof THREE.Vector3>, target: InstanceType<typeof THREE.Quaternion>): void {
  component.right.crossVectors(component.heading, up).normalize();
  component.back.crossVectors(component.right, up);
  component.basis.makeBasis(component.right, up, component.back);
  target.setFromRotationMatrix(component.basis);
}

function showPreview(component: DroneFlightComponent, visible: boolean): void {
  component.previewVisible = visible;
  component.watched.forEach((waypoint) => (waypoint.object3D.visible = visible));
  const line = component.data.waypoints.getObject3D('path-preview');

  if (line) {
    line.visible = visible;
  }
}

function buildPreview(component: DroneFlightComponent, loop: MinSnapLoop): void {
  const positions: number[] = [];
  forEachSample(loop, ({ position }) => positions.push(...position));
  positions.push(...loop.points[0]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: PREVIEW_COLOR }));
  line.visible = component.previewVisible;

  const waypointsEl = component.data.waypoints;
  const previous = waypointsEl.getObject3D('path-preview') as InstanceType<typeof THREE.Line> | undefined;
  previous?.geometry.dispose();
  (previous?.material as InstanceType<typeof THREE.LineBasicMaterial> | undefined)?.dispose();
  // The parent sits at the origin, so the world-space samples draw in place.
  waypointsEl.setObject3D('path-preview', line);
}

/** Listens to every current waypoint, so moving one in the inspector re-plans. */
function watchWaypoints(component: DroneFlightComponent): void {
  component.watched.forEach((waypoint) => waypoint.removeEventListener('componentchanged', component.onWaypointChange));
  component.watched = waypointEntities(component);
  component.watched.forEach((waypoint) => {
    waypoint.addEventListener('componentchanged', component.onWaypointChange);
    waypoint.object3D.visible = component.previewVisible;
  });
}

/**
 * Re-plans from the waypoints' current positions. An invalid edit is reported
 * and the previous loop kept; an invalid initial loop throws.
 */
function replan(component: DroneFlightComponent, force: boolean): void {
  const points = component.watched.map((waypoint): Vec3 => {
    const { x, y, z } = waypoint.object3D.position;
    return [x, y, z];
  });
  const previous = component.loop;

  if (previous && !force && samePoints(points, previous.points)) {
    return;
  }

  try {
    component.loop = planFlight(points, component.data);
  } catch (error) {
    if (!previous) {
      throw error;
    }

    console.error(error);
    return;
  }

  buildPreview(component, component.loop);
  component.teleportPending = true;

  if (previous && !samePoints(points, previous.points)) {
    console.log(`Drone flight waypoints changed; paste into src/big-room/waypoints.ts:\n${waypointsLiteral(points)}`);
  }
}

/**
 * Flies the entity (the rig) on a closed minimum-snap loop through the child
 * entities of `waypoints`. It faces its horizontal velocity and, scaled by
 * `tiltCoupling`, leans so its up axis is the thrust axis a + g, as a
 * quadcopter must. Editing the waypoints (in the inspector) re-plans live;
 * while the scene is paused, which the inspector does, the waypoints and the
 * path are shown.
 */
AFRAME.registerComponent('drone-flight', {
  schema: {
    waypoints: { type: 'selector' },
    cruiseSpeed: { type: 'number', default: 1.8 },
    maxSpeed: { type: 'number', default: 4 },
    maxAcceleration: { type: 'number', default: 5 },
    tiltCoupling: { type: 'number', default: 1 },
  },

  init(this: DroneFlightComponent) {
    if (!this.data.waypoints) {
      throw new Error('drone-flight needs a waypoints entity.');
    }

    this.loop = null;
    this.pathTimeSec = 0;
    this.speedMps = 0;
    this.teleportPending = false;
    this.previewVisible = false;
    this.watched = [];
    this.heading = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.back = new THREE.Vector3();
    this.basis = new THREE.Matrix4();
    this.tilted = new THREE.Quaternion();

    this.onWaypointChange = (event: Event) => {
      if ((event as CustomEvent<{ name: string }>).detail.name === 'position') {
        replan(this, false);
      }
    };
    this.onWaypointsChange = () => {
      watchWaypoints(this);
      replan(this, false);
    };

    // Waypoint positions are only set once the waypoints have loaded, which
    // the scene's `loaded` guarantees for all of them.
    const start = () => {
      this.data.waypoints.addEventListener('child-attached', this.onWaypointsChange);
      this.data.waypoints.addEventListener('child-detached', this.onWaypointsChange);
      watchWaypoints(this);
      replan(this, true);
    };
    const sceneEl = this.el.sceneEl as Scene;

    if (sceneEl.hasLoaded) {
      start();
    } else {
      sceneEl.addEventListener('loaded', start);
    }
  },

  /** Limits or coupling changed (e.g. in the inspector) after the first plan. */
  update(this: DroneFlightComponent) {
    if (this.loop) {
      replan(this, true);
    }
  },

  remove(this: DroneFlightComponent) {
    this.data.waypoints.removeEventListener('child-attached', this.onWaypointsChange);
    this.data.waypoints.removeEventListener('child-detached', this.onWaypointsChange);
    this.watched.forEach((waypoint) => waypoint.removeEventListener('componentchanged', this.onWaypointChange));
  },

  play(this: DroneFlightComponent) {
    showPreview(this, false);
  },

  pause(this: DroneFlightComponent) {
    showPreview(this, true);
  },

  tick(this: DroneFlightComponent, time: number) {
    const loop = this.loop;

    if (!loop) {
      return;
    }

    this.pathTimeSec = (time / 1000) % loop.period;
    const { position, velocity, acceleration } = sampleLoop(loop, this.pathTimeSec);
    const object = this.el.object3D;

    object.position.set(position[0], position[1], position[2]);
    this.speedMps = Math.hypot(velocity[0], velocity[1], velocity[2]);
    this.heading.set(velocity[0], 0, velocity[2]).normalize();

    setAttitude(this, WORLD_UP, object.quaternion);
    this.up.set(acceleration[0], acceleration[1] + GRAVITY, acceleration[2]).normalize();
    setAttitude(this, this.up, this.tilted);
    object.quaternion.slerp(this.tilted, this.data.tiltCoupling);

    if (this.teleportPending) {
      this.teleportPending = false;
      announceRigTeleport(this.el.sceneEl as Scene);
    }
  },
});
