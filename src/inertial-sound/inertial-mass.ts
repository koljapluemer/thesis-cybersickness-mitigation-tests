import 'aframe';
import type { Quaternion, Vector3 } from 'three';

const THREE = AFRAME.THREE;

export type InertialMassOptions = {
  /** Undamped natural period of the spring, in milliseconds. */
  naturalPeriodMs: number;
  /** 1 = critically damped. */
  dampingRatio: number;
  /** The offset is clamped to this distance, in metres. */
  maxOffsetM: number;
};

/**
 * A point mass tied to the rig's origin by a spring and a damper that both act
 * relative to the rig, free in all three linear directions. With its world
 * position `x` and velocity `v`, it follows
 *
 *     v' = ωₙ² · (p_rig − x) + 2ζωₙ · (v_rig − v)
 *
 * integrated semi-implicitly: `x ← x + v·dt` first, over the frame the rig has
 * just moved through, then `v` against the rig's new pose. (The other order
 * would evaluate the spring against a mass one frame behind, so at speed the
 * mass would settle v_rig·dt ahead of the rig.) The offset
 * o = x − p_rig obeys o'' + 2ζωₙo' + ωₙ²o = −a_rig, so a constant linear
 * acceleration a of the rig settles at o = −a/ωₙ², and constant velocity at
 * o = 0. Integrated in the world frame, so the centripetal acceleration of a
 * turning rig counts as well: in a turn the mass swings outward.
 */
export class InertialMass {
  private readonly naturalFrequency: number;
  private readonly dampingRatio: number;
  private readonly maxOffsetM: number;
  private readonly x = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly offsetVector = new THREE.Vector3();
  private readonly scratch = {
    quaternion: new THREE.Quaternion(),
    spring: new THREE.Vector3(),
    damping: new THREE.Vector3(),
  };

  constructor(options: InertialMassOptions) {
    this.naturalFrequency = (2 * Math.PI) / (options.naturalPeriodMs / 1000);
    this.dampingRatio = options.dampingRatio;
    this.maxOffsetM = options.maxOffsetM;
  }

  /**
   * Position of the mass relative to the rig's origin, in rig coordinates
   * (x right, y up, −z forward), in metres. Its z component > 0: the mass is
   * behind its rest position, as when the rig accelerates forward.
   */
  get offset(): Readonly<Vector3> {
    return this.offsetVector;
  }

  /** Puts the mass at the rig's origin and gives it the rig's velocity. */
  reset(rigPosition: Vector3, rigVelocity: Vector3): void {
    this.x.copy(rigPosition);
    this.v.copy(rigVelocity);
    this.offsetVector.set(0, 0, 0);
  }

  step(rigPosition: Vector3, rigQuaternion: Quaternion, rigVelocity: Vector3, dtSec: number): void {
    const { quaternion, spring, damping } = this.scratch;
    const wn = this.naturalFrequency;

    this.x.addScaledVector(this.v, dtSec);
    spring.copy(rigPosition).sub(this.x).multiplyScalar(wn * wn);
    damping.copy(rigVelocity).sub(this.v).multiplyScalar(2 * this.dampingRatio * wn);
    this.v.addScaledVector(spring.add(damping), dtSec);

    const toRig = quaternion.copy(rigQuaternion).invert();
    this.offsetVector.copy(this.x).sub(rigPosition).applyQuaternion(toRig);

    if (this.offsetVector.length() > this.maxOffsetM) {
      this.offsetVector.setLength(this.maxOffsetM);
      this.x.copy(this.offsetVector).applyQuaternion(rigQuaternion).add(rigPosition);
      this.v.copy(rigVelocity);
    }
  }
}
