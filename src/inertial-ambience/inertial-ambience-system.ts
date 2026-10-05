import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import { InertialSphere } from '../inertial-sound/inertial-sphere';
import type { Unsubscribe } from '../optical-flow/types';
import { getRigKinematics, isIntegrable, type RigKinematicsSample } from '../rig-kinematics/rig-kinematics-system';
import { fromRotationVector } from '../rotation';

const THREE = AFRAME.THREE;

/**
 * Sense of the ambient sources' rotation relative to the sphere's lag, which
 * settles at −α_rig/ωₙ² (against the rig's angular acceleration):
 * `against-acceleration` turns the sources with the lag, as the motor sound of
 * the `inertial-sound` conditions moves; `with-acceleration` turns them the
 * other way.
 */
export type AmbienceSwing = 'against-acceleration' | 'with-acceleration';

export type InertialAmbienceData = {
  enabled: boolean;
  swing: AmbienceSwing;
  /** Undamped natural period of the sphere's spring, in milliseconds. */
  naturalPeriodMs: number;
  /** 1 = critically damped. */
  dampingRatio: number;
  /** The sources' rotation is the sphere's lag times this, over all axes. Must be > 0. */
  lagGain: number;
  /** The sources' rotation is clamped to this angle, in degrees. */
  maxLagDeg: number;
};

export type InertialAmbienceSample = {
  sceneTimeMs: number;
  /** Frame interval the sphere was stepped over, in milliseconds. */
  deltaMs: number;
  /**
   * Rotation applied to the ambient sources about the head: the sphere's lag
   * times `lagGain`, negated under `with-acceleration`, as a rotation vector in
   * rig coordinates, in degrees (x pitch, y yaw, z roll; y > 0 = sounds turned left).
   */
  lagRotationVectorDeg: [number, number, number];
  /** The rotation's angle over `maxLagDeg`, 0..1. */
  lagFraction: number;
};

export type InertialAmbienceSystem = System<InertialAmbienceData> & {
  /**
   * Rotation to apply to every ambient source's direction from the head, in rig
   * coordinates. Identity while disabled. Current for this frame once
   * `rig-kinematics` has run its `tock`.
   */
  readonly lagRotation: Readonly<Quaternion>;
  /** Called every frame while enabled. */
  onSample(listener: (sample: InertialAmbienceSample) => void): Unsubscribe;
};

type InertialAmbienceInternals = InertialAmbienceSystem & {
  sceneEl: Scene;
  lagRotation: Quaternion;
  listeners: Set<(sample: InertialAmbienceSample) => void>;
  unsubscribeKinematics: Unsubscribe | null;
  scratch: { lag: Vector3; rigQuaternion: Quaternion; rigAngularVelocity: Vector3 };
  step(sphere: InertialSphere, sample: RigKinematicsSample, aligned: boolean): void;
  teardown(): void;
};

/**
 * Inertial ambience: the scene's ambient sounds (`ambient-sound`) are turned
 * about the head by `lagGain` times the lag of an `InertialSphere`, the same
 * rig-angular-acceleration model as the `inertial-sound` mitigation, instead of
 * moving a dedicated motor sound. At rest and in steady turns the sources sit
 * where their objects are. Driven by `rig-kinematics`; configured per
 * experimental condition through the schema. The `ambient-sound` system reads
 * `lagRotation` and places the sources.
 */
AFRAME.registerSystem('inertial-ambience', {
  schema: {
    enabled: { type: 'boolean', default: false },
    swing: { type: 'string', default: 'against-acceleration', oneOf: ['against-acceleration', 'with-acceleration'] },
    naturalPeriodMs: { type: 'number', default: 8000 },
    dampingRatio: { type: 'number', default: 1 },
    lagGain: { type: 'number', default: 2 },
    maxLagDeg: { type: 'number', default: 45 },
  },

  init(this: InertialAmbienceInternals) {
    this.lagRotation = new THREE.Quaternion();
    this.listeners = new Set();
    this.unsubscribeKinematics = null;
    this.scratch = {
      lag: new THREE.Vector3(),
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
    const { lag, rigQuaternion, rigAngularVelocity } = this.scratch;
    rigQuaternion.fromArray(sample.rigQuaternion);
    rigAngularVelocity.fromArray(sample.angularVelocityRadPerSec);

    if (isIntegrable(sample, aligned)) {
      sphere.step(rigQuaternion, rigAngularVelocity, sample.frameDeltaMs / 1000);
    } else {
      sphere.reset(rigQuaternion, rigAngularVelocity);
    }

    const sign = this.data.swing === 'with-acceleration' ? -1 : 1;
    lag.copy(sphere.lag).multiplyScalar(sign * this.data.lagGain);
    fromRotationVector(lag, this.lagRotation);

    const toDeg = THREE.MathUtils.radToDeg;
    const logged: InertialAmbienceSample = {
      sceneTimeMs: sample.sceneTimeMs,
      deltaMs: sample.frameDeltaMs,
      lagRotationVectorDeg: [toDeg(lag.x), toDeg(lag.y), toDeg(lag.z)],
      lagFraction: Math.min(1, toDeg(lag.length()) / this.data.maxLagDeg),
    };
    this.listeners.forEach((listener) => listener(logged));
  },

  teardown(this: InertialAmbienceInternals) {
    this.unsubscribeKinematics?.();
    this.unsubscribeKinematics = null;
    this.lagRotation.identity();
  },

  onSample(this: InertialAmbienceInternals, listener: (sample: InertialAmbienceSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
});

export function getInertialAmbience(sceneEl: Element): InertialAmbienceSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['inertial-ambience'] as InertialAmbienceSystem;
}
