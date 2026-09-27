import type { TrackWalls } from './track-walls';

/** Car dimensions from `track.json`, in model coordinates (metres, forward = −z, origin = centre of mass). */
export type CarGeometry = {
  frontAxleZ: number;
  rearAxleZ: number;
  halfWidth: number;
  halfLength: number;
};

export type CarTuning = {
  /** m/s */
  topSpeed: number;
  /** Forward acceleration from standstill at full throttle, m/s². */
  acceleration: number;
  /** m/s² at full brake. */
  brakeDeceleration: number;
  /** m/s */
  reverseSpeed: number;
  /** Front wheel steering angle at full lock when standing, degrees. */
  maxSteerDeg: number;
  /** Speed at which the steering lock has halved, m/s. */
  steerFalloffSpeed: number;
  /** Peak lateral acceleration the rear tyres can hold, in g. */
  grip: number;
};

export type DriveCommand = {
  /** −1..1, positive = left. */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1; at a standstill it reverses. */
  brake: number;
};

/** Pose on the ground plane: A-Frame x/z in metres, heading = rotation about +Y in radians (0 = facing −Z). */
export type CarPose = { x: number; z: number; heading: number };

export type CarState = CarPose & {
  /** Along the car's forward axis, m/s. */
  forwardSpeed: number;
  /** Along the car's left axis, m/s. */
  lateralSpeed: number;
  /** rad/s, positive = turning left. */
  yawRate: number;
  /** Front wheel angle, rad, positive = left. */
  steerAngle: number;
};

const SUBSTEP_SEC = 1 / 240;
const MAX_FRAME_SEC = 0.05;
const GRAVITY = 9.81;
const MASS_KG = 700;
/** Slip angle at which a tyre reaches its peak force (tanh curve), rad. */
const SLIP_PEAK_RAD = 0.1;
/** Front grip relative to rear: below 1 the car understeers at the limit instead of spinning. */
const FRONT_GRIP_SHARE = 0.9;
/** Below the lower speed the car follows the kinematic bicycle model, above the upper the dynamic one. */
const KINEMATIC_BLEND_MPS = [1.5, 4] as const;
/** Below this speed the car counts as standing: throttle drives forward, brake reverses. */
const STANDSTILL_MPS = 0.5;
const ROLLING_DECELERATION = 0.3;
/** Deceleration when rolling off the throttle, m/s². */
const ENGINE_BRAKING = 1.2;
const WALL_RESTITUTION = 0.2;
/** Share of the tangential speed lost per substep while scraping a wall. */
const WALL_SCRUB = 0.005;
/** Share of the yaw rate kept per substep in wall contact, so a hit does not spin the car. */
const WALL_YAW_DAMPING = 0.9;

/**
 * Planar car on a flat track: a dynamic bicycle model with saturating (tanh)
 * tyre forces, blended into the kinematic bicycle model at walking speed where
 * the slip angles are ill-defined. Integrated in fixed substeps, so handling
 * does not depend on the frame rate. The body collides with the walls as two
 * circles along its axis.
 */
export class CarPhysics {
  readonly state: CarState = { x: 0, z: 0, heading: 0, forwardSpeed: 0, lateralSpeed: 0, yawRate: 0, steerAngle: 0 };
  private readonly tuning: CarTuning;
  private readonly walls: TrackWalls;
  /** Distances from the centre of mass to the front and rear axle. */
  private readonly toFront: number;
  private readonly toRear: number;
  private readonly yawInertia: number;
  /** Local z of the two collision circle centres. */
  private readonly circleZs: [number, number];
  private readonly circleRadius: number;
  private carrySec = 0;

  constructor(geometry: CarGeometry, tuning: CarTuning, walls: TrackWalls) {
    this.tuning = tuning;
    this.walls = walls;
    this.toFront = -geometry.frontAxleZ;
    this.toRear = geometry.rearAxleZ;
    this.yawInertia = MASS_KG * this.toFront * this.toRear;
    this.circleRadius = geometry.halfWidth;
    const circleOffset = geometry.halfLength - geometry.halfWidth;
    this.circleZs = [-circleOffset, circleOffset];
  }

  reset(pose: CarPose): void {
    Object.assign(this.state, pose, { forwardSpeed: 0, lateralSpeed: 0, yawRate: 0, steerAngle: 0 });
    this.carrySec = 0;
  }

  /** Advances by `dtSec` (clamped), in fixed substeps; a remainder carries over to the next call. */
  advance(command: DriveCommand, dtSec: number): void {
    this.carrySec += Math.min(dtSec, MAX_FRAME_SEC);

    while (this.carrySec >= SUBSTEP_SEC) {
      this.carrySec -= SUBSTEP_SEC;
      this.step(command, SUBSTEP_SEC);
    }
  }

  private step(command: DriveCommand, h: number): void {
    const s = this.state;
    const t = this.tuning;
    const a = this.toFront;
    const b = this.toRear;
    const wheelbase = a + b;

    const lock = toRad(t.maxSteerDeg) / (1 + Math.abs(s.forwardSpeed) / t.steerFalloffSpeed);
    const steer = command.steer * lock;
    s.steerAngle = steer;

    // Longitudinal: drive forward or in reverse, brake against the motion.
    let drive: number;
    let resist = ROLLING_DECELERATION + ENGINE_BRAKING * (1 - command.throttle);

    if (s.forwardSpeed > STANDSTILL_MPS) {
      drive = command.throttle * t.acceleration * Math.max(0, 1 - s.forwardSpeed / t.topSpeed);
      resist += command.brake * t.brakeDeceleration;
    } else if (s.forwardSpeed < -STANDSTILL_MPS) {
      drive = -command.brake * t.acceleration * Math.max(0, 1 + s.forwardSpeed / t.reverseSpeed);
      resist += command.throttle * t.brakeDeceleration;
    } else {
      drive = (command.throttle - command.brake) * t.acceleration;
    }

    // Lateral tyre forces (vehicle frame: x forward, y left), zero below the blend range.
    const vx = s.forwardSpeed;
    const vy = s.lateralSpeed;
    const r = s.yawRate;
    let frontForce = 0;
    let rearForce = 0;

    if (vx > KINEMATIC_BLEND_MPS[0]) {
      const frontLoad = MASS_KG * GRAVITY * b / wheelbase;
      const rearLoad = MASS_KG * GRAVITY * a / wheelbase;
      const frontSlip = Math.atan2(vy + a * r, vx) - steer;
      const rearSlip = Math.atan2(vy - b * r, vx);
      frontForce = -t.grip * FRONT_GRIP_SHARE * frontLoad * Math.tanh(frontSlip / SLIP_PEAK_RAD);
      rearForce = -t.grip * rearLoad * Math.tanh(rearSlip / SLIP_PEAK_RAD);
    }

    let forward = vx + (drive + vy * r - frontForce * Math.sin(steer) / MASS_KG) * h;
    const drop = resist * h;
    forward = Math.sign(forward) * Math.max(0, Math.abs(forward) - drop);

    const dynamicLateral = vy + ((frontForce * Math.cos(steer) + rearForce) / MASS_KG - vx * r) * h;
    const dynamicYawRate = r + ((a * frontForce * Math.cos(steer) - b * rearForce) / this.yawInertia) * h;

    // Kinematic bicycle: no slip at the rear axle.
    const kinematicYawRate = forward * Math.tan(steer) / wheelbase;
    const kinematicLateral = kinematicYawRate * b;
    const [low, high] = KINEMATIC_BLEND_MPS;
    const dynamicShare = Math.min(1, Math.max(0, (forward - low) / (high - low)));

    s.forwardSpeed = forward;
    s.lateralSpeed = kinematicLateral + (dynamicLateral - kinematicLateral) * dynamicShare;
    s.yawRate = kinematicYawRate + (dynamicYawRate - kinematicYawRate) * dynamicShare;
    s.heading += s.yawRate * h;

    const [fx, fz] = forwardAxis(s.heading);
    const [lx, lz] = leftAxis(fx, fz);
    s.x += (s.forwardSpeed * fx + s.lateralSpeed * lx) * h;
    s.z += (s.forwardSpeed * fz + s.lateralSpeed * lz) * h;

    this.collide();
  }

  /** Pushes the body circles out of the walls and removes the velocity into them. */
  private collide(): void {
    const s = this.state;

    for (const circleZ of this.circleZs) {
      const [fx, fz] = forwardAxis(s.heading);
      // Local z points backwards.
      const offsetX = -circleZ * fx;
      const offsetZ = -circleZ * fz;
      const contact = this.walls.deepestContact(s.x + offsetX, s.z + offsetZ, this.circleRadius);

      if (!contact) {
        continue;
      }

      const [nx, nz] = contact.normal;
      s.x += nx * contact.depth;
      s.z += nz * contact.depth;

      // World velocity of the centre and of the contact circle (ω × offset, ω = yawRate about +Y).
      const [lx, lz] = leftAxis(fx, fz);
      let vx = s.forwardSpeed * fx + s.lateralSpeed * lx;
      let vz = s.forwardSpeed * fz + s.lateralSpeed * lz;
      const pointNormalSpeed = (vx + s.yawRate * offsetZ) * nx + (vz - s.yawRate * offsetX) * nz;

      if (pointNormalSpeed < 0) {
        vx -= (1 + WALL_RESTITUTION) * pointNormalSpeed * nx;
        vz -= (1 + WALL_RESTITUTION) * pointNormalSpeed * nz;
      }

      const normalSpeed = vx * nx + vz * nz;
      vx = normalSpeed * nx + (vx - normalSpeed * nx) * (1 - WALL_SCRUB);
      vz = normalSpeed * nz + (vz - normalSpeed * nz) * (1 - WALL_SCRUB);

      s.forwardSpeed = vx * fx + vz * fz;
      s.lateralSpeed = vx * lx + vz * lz;
      s.yawRate *= WALL_YAW_DAMPING;
    }
  }
}

function toRad(degrees: number): number {
  return degrees * Math.PI / 180;
}

/** Unit forward vector `[x, z]` for a heading (0 = −Z). */
function forwardAxis(heading: number): [number, number] {
  return [-Math.sin(heading), -Math.cos(heading)];
}

/** Unit left vector `[x, z]` for a forward vector: forward turned 90° about +Y. */
function leftAxis(fx: number, fz: number): [number, number] {
  return [fz, -fx];
}
