import 'aframe';
import type { Quaternion, Vector3 } from 'three';
import { fromRotationVector, rotationVector } from '../rotation';

const THREE = AFRAME.THREE;

export type InertialSphereOptions = {
  /** Undamped natural period of the spring, in milliseconds. */
  naturalPeriodMs: number;
  /** 1 = critically damped. */
  dampingRatio: number;
  /** The lag is clamped to this angle, in degrees. */
  maxLagDeg: number;
};

/**
 * A sphere with rotational inertia around the rig, tied to it by a torsional
 * spring and a damper that both act relative to the rig. With error
 * `e = rotvec(q_rig · q⁻¹)` (world frame), it follows
 *
 *     ω' = ωₙ² · e + 2ζωₙ · (ω_rig − ω)
 *
 * integrated semi-implicitly: `ω` first, then `q ← exp(ω·dt) · q`. In rig
 * coordinates, the lag θ obeys θ'' + 2ζωₙθ' + ωₙ²θ = −α_rig, so a constant
 * angular acceleration α of the rig settles at θ = −α/ωₙ², and a steady turn at
 * θ = 0.
 */
export class InertialSphere {
  private readonly naturalFrequency: number;
  private readonly dampingRatio: number;
  private readonly maxLagRad: number;
  private readonly q = new THREE.Quaternion();
  private readonly omega = new THREE.Vector3();
  private readonly lagVector = new THREE.Vector3();
  private readonly scratch = {
    quaternion: new THREE.Quaternion(),
    error: new THREE.Vector3(),
    damping: new THREE.Vector3(),
  };

  constructor(options: InertialSphereOptions) {
    this.naturalFrequency = (2 * Math.PI) / (options.naturalPeriodMs / 1000);
    this.dampingRatio = options.dampingRatio;
    this.maxLagRad = THREE.MathUtils.degToRad(options.maxLagDeg);
  }

  /** World orientation of the sphere; equals the rig's at rest. */
  get orientation(): Readonly<Quaternion> {
    return this.q;
  }

  /**
   * Rotation of the sphere relative to the rig, as a rotation vector in rig
   * coordinates, in radians. Its y component > 0: the sphere, and the sound on
   * it, is turned left of its rest position.
   */
  get lag(): Readonly<Vector3> {
    return this.lagVector;
  }

  /** Aligns the sphere with the rig and gives it the rig's angular velocity. */
  reset(rigQuaternion: Quaternion, rigAngularVelocity: Vector3): void {
    this.q.copy(rigQuaternion);
    this.omega.copy(rigAngularVelocity);
    this.lagVector.set(0, 0, 0);
  }

  step(rigQuaternion: Quaternion, rigAngularVelocity: Vector3, dtSec: number): void {
    const { quaternion, error, damping } = this.scratch;
    const wn = this.naturalFrequency;

    rotationVector(quaternion.copy(this.q).invert().premultiply(rigQuaternion), error);
    damping.copy(rigAngularVelocity).sub(this.omega).multiplyScalar(2 * this.dampingRatio * wn);
    this.omega.addScaledVector(error.multiplyScalar(wn * wn).add(damping), dtSec);

    fromRotationVector(error.copy(this.omega).multiplyScalar(dtSec), quaternion);
    this.q.premultiply(quaternion).normalize();

    rotationVector(quaternion.copy(rigQuaternion).invert().multiply(this.q), this.lagVector);

    if (this.lagVector.length() > this.maxLagRad) {
      this.lagVector.setLength(this.maxLagRad);
      this.q.copy(rigQuaternion).multiply(fromRotationVector(this.lagVector, quaternion));
      this.omega.copy(rigAngularVelocity);
    }
  }
}
