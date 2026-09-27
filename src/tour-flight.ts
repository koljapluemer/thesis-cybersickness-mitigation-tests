import 'aframe';
import type { Component, Scene } from 'aframe';
import { announceRigTeleport } from './rig';

const THREE = AFRAME.THREE;

type TourPoint = {
  t: number;
  position: [number, number, number];
};

type TourPath = {
  duration: number;
  points: TourPoint[];
};

export type TourFlightData = {
  src: string;
  scale: number;
  offset: {
    x: number;
    y: number;
    z: number;
  };
  rotationY: number;
  lookAhead: number;
  pitch: number;
};

export type TourFlightComponent = Component<TourFlightData> & {
  path: ClosedPath | null;
  offsetVector: InstanceType<typeof AFRAME.THREE.Vector3>;
  worldPosition: InstanceType<typeof AFRAME.THREE.Vector3>;
  lookTarget: InstanceType<typeof AFRAME.THREE.Vector3>;
  rotationEuler: InstanceType<typeof AFRAME.THREE.Euler>;
  /** Current position on the path in seconds. */
  pathTimeSec: number;
  /** Whether the rig has been put on the path yet. */
  placed: boolean;
};

type Point = [number, number, number];

/**
 * The tour as a closed loop: uniformly timed keyframes plus a closing segment
 * from the last keyframe back to the first, flown at the mean speed of the two
 * adjacent segments so the speed does not jump at the seam.
 */
type ClosedPath = {
  points: Point[];
  /** Time between consecutive keyframes in seconds. */
  step: number;
  /** Time of the last keyframe, where the closing segment starts. */
  lastTime: number;
  /** Loop period: last keyframe time plus the closing segment. */
  period: number;
};

const UNIFORM_STEP_TOLERANCE = 1e-4;

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function createClosedPath(tourPath: TourPath): ClosedPath {
  const { points, duration } = tourPath;

  if (points.length < 4) {
    throw new Error('Tour path needs at least 4 points.');
  }

  const step = points[1].t - points[0].t;
  const lastTime = points[points.length - 1].t;

  if (points[0].t !== 0 || points.some((point, index) => Math.abs(point.t - index * step) > UNIFORM_STEP_TOLERANCE)) {
    throw new Error('Tour path points must start at t = 0 and be uniformly spaced in time.');
  }

  if (Math.abs(duration - lastTime) > UNIFORM_STEP_TOLERANCE) {
    throw new Error(`Tour path duration (${duration}) does not match its last point (t = ${lastTime}).`);
  }

  const positions = points.map((point) => point.position);
  const last = positions.length - 1;
  const seamSpeed = (distance(positions[last - 1], positions[last]) + distance(positions[0], positions[1])) / (2 * step);
  const closingTime = distance(positions[last], positions[0]) / seamSpeed;

  return { points: positions, step, lastTime, period: lastTime + closingTime };
}

/** Keyframe `index` of the endless loop: any integer, wrapping around with its time shifted by whole periods. */
function knot(path: ClosedPath, index: number): { time: number; position: Point } {
  const count = path.points.length;
  const lap = Math.floor(index / count);
  const wrapped = index - lap * count;
  return { time: wrapped * path.step + lap * path.period, position: path.points[wrapped] };
}

/**
 * Catmull-Rom spline parameterized by time: cubic Hermite interpolation between
 * k1 and k2 with finite-difference velocities, so speed stays continuous across
 * segments of different duration (the closing segment).
 */
function hermite(k0: ReturnType<typeof knot>, k1: ReturnType<typeof knot>, k2: ReturnType<typeof knot>, k3: ReturnType<typeof knot>, time: number): Point {
  const duration = k2.time - k1.time;
  const u = THREE.MathUtils.clamp((time - k1.time) / duration, 0, 1);
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  const axis = (a: number) => {
    const v1 = (k2.position[a] - k0.position[a]) / (k2.time - k0.time);
    const v2 = (k3.position[a] - k1.position[a]) / (k3.time - k1.time);
    return h00 * k1.position[a] + h10 * duration * v1 + h01 * k2.position[a] + h11 * duration * v2;
  };

  return [axis(0), axis(1), axis(2)];
}

/** Position at time t (any value; wraps around the loop). */
function samplePath(path: ClosedPath, t: number): Point {
  const time = ((t % path.period) + path.period) % path.period;
  const count = path.points.length;
  const index = time >= path.lastTime ? count - 1 : Math.min(count - 2, Math.floor(time / path.step));

  return hermite(knot(path, index - 1), knot(path, index), knot(path, index + 1), knot(path, index + 2), time);
}

function applyWorldTransform(
  component: TourFlightComponent,
  point: Point,
  target: InstanceType<typeof AFRAME.THREE.Vector3>,
): void {
  target.set(point[0], point[1], point[2]);
  target.multiplyScalar(component.data.scale);
  target.applyEuler(component.rotationEuler);
  target.add(component.offsetVector.set(
    component.data.offset.x,
    component.data.offset.y,
    component.data.offset.z,
  ));
}

async function loadTourPath(component: TourFlightComponent): Promise<void> {
  const response = await fetch(component.data.src);

  if (!response.ok) {
    throw new Error(`Failed to load tour path from ${component.data.src}.`);
  }

  component.path = createClosedPath((await response.json()) as TourPath);
}

AFRAME.registerComponent('tour-flight', {
  schema: {
    src: { type: 'string', default: '/tour-path.json' },
    scale: { type: 'number', default: 220 },
    offset: { type: 'vec3', default: { x: 0, y: 2.7, z: 0 } },
    rotationY: { type: 'number', default: 18 },
    lookAhead: { type: 'number', default: 1.2 },
    pitch: { type: 'number', default: 30 },
  },

  init(this: TourFlightComponent) {
    this.path = null;
    this.pathTimeSec = 0;
    this.placed = false;
    this.offsetVector = new THREE.Vector3();
    this.worldPosition = new THREE.Vector3();
    this.lookTarget = new THREE.Vector3();
    this.rotationEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.rotationEuler.set(0, THREE.MathUtils.degToRad(this.data.rotationY), 0);

    void loadTourPath(this).catch((error: unknown) => {
      console.error(error);
    });
  },

  update(this: TourFlightComponent) {
    this.rotationEuler.set(0, THREE.MathUtils.degToRad(this.data.rotationY), 0);
  },

  tick(this: TourFlightComponent, time: number) {
    if (!this.path) {
      return;
    }

    const elapsedSeconds = (time / 1000) % this.path.period;
    this.pathTimeSec = elapsedSeconds;
    const currentPoint = samplePath(this.path, elapsedSeconds);
    const lookAheadPoint = samplePath(this.path, elapsedSeconds + this.data.lookAhead);

    applyWorldTransform(this, currentPoint, this.worldPosition);
    applyWorldTransform(this, lookAheadPoint, this.lookTarget);

    this.el.object3D.position.copy(this.worldPosition);
    this.el.object3D.lookAt(this.lookTarget);
    this.el.object3D.rotateY(Math.PI);
    this.el.object3D.rotateX(-THREE.MathUtils.degToRad(this.data.pitch));

    if (!this.placed) {
      this.placed = true;
      announceRigTeleport(this.el.sceneEl as Scene);
    }
  },
});
