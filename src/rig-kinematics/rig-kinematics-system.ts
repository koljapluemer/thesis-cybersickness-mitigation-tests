import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import type { Unsubscribe } from '../optical-flow/types';
import { findRig } from '../rig';

const THREE = AFRAME.THREE;

/** Rotation of the rig about its own (local) up axis, positive = left. */
export type RigKinematicsSample = {
  sceneTimeMs: number;
  /** Spacing of the two yaw-rate intervals the acceleration is taken over, in milliseconds. */
  deltaMs: number;
  /** Over the last frame, in degrees per second. */
  localYawRateDegPerSec: number;
  /** Change of `localYawRateDegPerSec` between the last two frames, in degrees per second squared. */
  localYawAccelerationDegPerSec2: number;
};

export type RigKinematicsSystem = System & {
  /** Called every frame once two consecutive yaw rates exist. */
  onSample(listener: (sample: RigKinematicsSample) => void): Unsubscribe;
};

type RigKinematicsInternals = RigKinematicsSystem & {
  sceneEl: Scene;
  listeners: Set<(sample: RigKinematicsSample) => void>;
  prevQuaternion: Quaternion | null;
  prevYawRate: { degPerSec: number; deltaMs: number } | null;
  scratch: { position: Vector3; quaternion: Quaternion; scale: Vector3; relative: Quaternion };
};

/**
 * Rotation of `q` in radians about the y axis of the frame `q` is expressed in:
 * the y component of its rotation vector, taking the shorter of the two
 * equivalent rotations.
 */
function yawAngle(q: Quaternion): number {
  const sign = q.w < 0 ? -1 : 1;
  const sinHalf = Math.hypot(q.x, q.y, q.z);
  const angleOverSinHalf = sinHalf < 1e-9 ? 2 : (2 * Math.atan2(sinHalf, sign * q.w)) / sinHalf;
  return sign * q.y * angleOverSinHalf;
}

/**
 * Rig rotation about its **local** up axis, read from the rig's world pose
 * after all components have moved it (`tock`). The rig is pitched and banked
 * by `tour-flight`, so this is not the heading change about world up. Rates are
 * taken between consecutive frames; the acceleration from two consecutive
 * rates, over the spacing of their interval centres.
 */
AFRAME.registerSystem('rig-kinematics', {
  init(this: RigKinematicsInternals) {
    this.listeners = new Set();
    this.prevQuaternion = null;
    this.prevYawRate = null;
    this.scratch = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      relative: new THREE.Quaternion(),
    };
  },

  onSample(this: RigKinematicsInternals, listener: (sample: RigKinematicsSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  tock(this: RigKinematicsInternals, time: number, timeDelta: number) {
    const rig = findRig(this.sceneEl);

    if (!rig || timeDelta <= 0) {
      this.prevQuaternion = null;
      this.prevYawRate = null;
      return;
    }

    const { position, quaternion, scale, relative } = this.scratch;
    rig.matrixWorld.decompose(position, quaternion, scale);

    if (!this.prevQuaternion) {
      this.prevQuaternion = quaternion.clone();
      return;
    }

    // Rotation since the last frame, expressed in the rig's previous local frame.
    relative.copy(this.prevQuaternion).invert().multiply(quaternion);
    this.prevQuaternion.copy(quaternion);

    const yawRate = { degPerSec: THREE.MathUtils.radToDeg(yawAngle(relative)) / (timeDelta / 1000), deltaMs: timeDelta };
    const prev = this.prevYawRate;
    this.prevYawRate = yawRate;

    if (!prev) {
      return;
    }

    // Each rate is the mean over its frame, so their centres are half of both frames apart.
    const deltaMs = (prev.deltaMs + yawRate.deltaMs) / 2;
    const sample: RigKinematicsSample = {
      sceneTimeMs: time,
      deltaMs,
      localYawRateDegPerSec: yawRate.degPerSec,
      localYawAccelerationDegPerSec2: (yawRate.degPerSec - prev.degPerSec) / (deltaMs / 1000),
    };
    this.listeners.forEach((listener) => listener(sample));
  },
});

export function getRigKinematics(sceneEl: Element): RigKinematicsSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['rig-kinematics'] as RigKinematicsSystem;
}
