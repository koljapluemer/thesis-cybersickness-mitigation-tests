import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import { InertialSphere } from '../inertial-sound/inertial-sphere';
import type { Unsubscribe } from '../optical-flow/types';
import { getRigKinematics, isIntegrable, type RigKinematicsSample } from '../rig-kinematics/rig-kinematics-system';
import { fromRotationVector } from '../rotation';

const THREE = AFRAME.THREE;

/** The rig's forward axis, in rig coordinates. */
const RIG_FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Sense of the ambient sources' rotation relative to the sphere's lag, which
 * settles at −α_rig/ωₙ² (against the rig's angular acceleration):
 * `against-acceleration` turns the sources with the lag, as the motor sound of
 * the `inertial-sound` conditions moves; `with-acceleration` turns them the
 * other way.
 */
export type AmbienceSwing = 'against-acceleration' | 'with-acceleration';

/**
 * What the signed lag φ does to the ambient sources: `rotation` turns their
 * directions about the head by exp(φ); `loudness` leaves them where their
 * objects are and tilts their levels towards where φ turns the rig's forward
 * axis (`loudnessTiltDb`).
 */
export type AmbienceEffect = 'rotation' | 'loudness';

export type InertialAmbienceData = {
  enabled: boolean;
  swing: AmbienceSwing;
  effect: AmbienceEffect;
  /** Undamped natural period of the sphere's spring, in milliseconds. */
  naturalPeriodMs: number;
  /** 1 = critically damped. */
  dampingRatio: number;
  /** The sources' rotation is the sphere's lag times this, over all axes. Must be > 0. */
  lagGain: number;
  /** The sources' rotation is clamped to this angle, in degrees. */
  maxLagDeg: number;
  /** `loudness` only: level change of a source exactly to the side of the rig's forward axis at full lag, in dB. */
  maxGainDb: number;
};

export type InertialAmbienceSample = {
  sceneTimeMs: number;
  /** Frame interval the sphere was stepped over, in milliseconds. */
  deltaMs: number;
  /**
   * The signed lag φ: the sphere's lag times `lagGain`, negated under
   * `with-acceleration`, clamped to `maxLagDeg`, as a rotation vector in rig
   * coordinates, in degrees (x pitch, y yaw, z roll; y > 0 = turned left). Under
   * `rotation` the sources are turned by it; under `loudness` it sets the tilt.
   */
  lagRotationVectorDeg: [number, number, number];
  /** φ's angle over `maxLagDeg`, 0..1. */
  lagFraction: number;
  /** `loudnessTiltDb` (rig frame, dB); zero under `rotation`. */
  loudnessTiltDb: [number, number, number];
};

export type InertialAmbienceSystem = System<InertialAmbienceData> & {
  /**
   * Rotation to apply to every ambient source's direction from the head, in rig
   * coordinates. Identity while disabled. Current for this frame once
   * `rig-kinematics` has run its `tock`.
   */
  readonly lagRotation: Readonly<Quaternion>;
  /**
   * Level tilt u of the ambient sources, in rig coordinates, in dB: a source in
   * unit direction d̂ from the head (rig coordinates) plays at u · d̂ dB. Zero
   * while disabled and under `rotation`. Current for this frame like `lagRotation`.
   */
  readonly loudnessTiltDb: Readonly<Vector3>;
  /** Called every frame while enabled. */
  onSample(listener: (sample: InertialAmbienceSample) => void): Unsubscribe;
};

type InertialAmbienceInternals = InertialAmbienceSystem & {
  sceneEl: Scene;
  lagRotation: Quaternion;
  loudnessTiltDb: Vector3;
  listeners: Set<(sample: InertialAmbienceSample) => void>;
  unsubscribeKinematics: Unsubscribe | null;
  scratch: { lag: Vector3; lagDeg: Vector3; rigQuaternion: Quaternion; rigAngularVelocity: Vector3 };
  step(sphere: InertialSphere, sample: RigKinematicsSample, aligned: boolean): void;
  teardown(): void;
};

/**
 * Inertial ambience: the scene's ambient sounds (`ambient-sound`) follow the
 * signed lag φ = s · `lagGain` · θ of an `InertialSphere`, the same
 * rig-angular-acceleration model as the `inertial-sound` mitigation, instead of
 * moving a dedicated motor sound. Under `rotation` they are turned about the
 * head by exp(φ); under `loudness` they stay put and their levels tilt by
 *
 *     u = (maxGainDb / maxLagDeg) · (φ × f),   f = rig forward (0, 0, −1),
 *
 * a dipole towards where φ turns the forward axis (the small-angle form of
 * exp(φ)·f − f). At rest and in steady turns φ = 0. Driven by `rig-kinematics`;
 * configured per experimental condition through the schema. The `ambient-sound`
 * system reads `lagRotation` and `loudnessTiltDb` and places the sources.
 */
AFRAME.registerSystem('inertial-ambience', {
  schema: {
    enabled: { type: 'boolean', default: false },
    swing: { type: 'string', default: 'against-acceleration', oneOf: ['against-acceleration', 'with-acceleration'] },
    effect: { type: 'string', default: 'rotation', oneOf: ['rotation', 'loudness'] },
    naturalPeriodMs: { type: 'number', default: 8000 },
    dampingRatio: { type: 'number', default: 1 },
    lagGain: { type: 'number', default: 2 },
    maxLagDeg: { type: 'number', default: 45 },
    maxGainDb: { type: 'number', default: 6 },
  },

  init(this: InertialAmbienceInternals) {
    this.lagRotation = new THREE.Quaternion();
    this.loudnessTiltDb = new THREE.Vector3();
    this.listeners = new Set();
    this.unsubscribeKinematics = null;
    this.scratch = {
      lag: new THREE.Vector3(),
      lagDeg: new THREE.Vector3(),
      rigQuaternion: new THREE.Quaternion(),
      rigAngularVelocity: new THREE.Vector3(),
    };
  },

  update(this: InertialAmbienceInternals) {
    this.teardown();

    if (!this.data.enabled) {
      return;
    }

    // Clamping the sphere at the sources' clamp over the gain clamps the sources.
    const sphere = new InertialSphere({ ...this.data, maxLagDeg: this.data.maxLagDeg / this.data.lagGain });
    let aligned = false;

    this.unsubscribeKinematics = getRigKinematics(this.sceneEl).onSample((sample) => {
      this.step(sphere, sample, aligned);
      aligned = true;
    });
  },

  step(this: InertialAmbienceInternals, sphere: InertialSphere, sample: RigKinematicsSample, aligned: boolean) {
    const { lag, lagDeg, rigQuaternion, rigAngularVelocity } = this.scratch;
    rigQuaternion.fromArray(sample.rigQuaternion);
    rigAngularVelocity.fromArray(sample.angularVelocityRadPerSec);

    if (isIntegrable(sample, aligned)) {
      sphere.step(rigQuaternion, rigAngularVelocity, sample.frameDeltaMs / 1000);
    } else {
      sphere.reset(rigQuaternion, rigAngularVelocity);
    }

    const sign = this.data.swing === 'with-acceleration' ? -1 : 1;
    lag.copy(sphere.lag).multiplyScalar(sign * this.data.lagGain);
    lagDeg.copy(lag).multiplyScalar(THREE.MathUtils.RAD2DEG);

    if (this.data.effect === 'loudness') {
      this.lagRotation.identity();
      this.loudnessTiltDb.crossVectors(lagDeg, RIG_FORWARD).multiplyScalar(this.data.maxGainDb / this.data.maxLagDeg);
    } else {
      fromRotationVector(lag, this.lagRotation);
      this.loudnessTiltDb.set(0, 0, 0);
    }

    const tilt = this.loudnessTiltDb;
    const logged: InertialAmbienceSample = {
      sceneTimeMs: sample.sceneTimeMs,
      deltaMs: sample.frameDeltaMs,
      lagRotationVectorDeg: [lagDeg.x, lagDeg.y, lagDeg.z],
      lagFraction: Math.min(1, lagDeg.length() / this.data.maxLagDeg),
      loudnessTiltDb: [tilt.x, tilt.y, tilt.z],
    };
    this.listeners.forEach((listener) => listener(logged));
  },

  teardown(this: InertialAmbienceInternals) {
    this.unsubscribeKinematics?.();
    this.unsubscribeKinematics = null;
    this.lagRotation.identity();
    this.loudnessTiltDb.set(0, 0, 0);
  },

  onSample(this: InertialAmbienceInternals, listener: (sample: InertialAmbienceSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
});

export function getInertialAmbience(sceneEl: Element): InertialAmbienceSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['inertial-ambience'] as InertialAmbienceSystem;
}
