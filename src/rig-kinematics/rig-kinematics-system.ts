import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import type { Unsubscribe } from '../optical-flow/types';
import { findRig, RigTeleportFlag } from '../rig';
import { rotationVector } from '../rotation';

const THREE = AFRAME.THREE;

/** Rig pose, rotation and translation; yaw is about the rig's own (local) up axis, positive = left. */
export type RigKinematicsSample = {
  sceneTimeMs: number;
  /** Spacing of the two yaw-rate intervals the acceleration is taken over, in milliseconds. */
  deltaMs: number;
  /** The last frame's interval, which the rates are taken over, in milliseconds. */
  frameDeltaMs: number;
  /** Over the last frame, in degrees per second. */
  localYawRateDegPerSec: number;
  /** Change of `localYawRateDegPerSec` between the last two frames, in degrees per second squared. */
  localYawAccelerationDegPerSec2: number;
  /** World orientation of the rig, `[x, y, z, w]`. */
  rigQuaternion: [number, number, number, number];
  /** Angular velocity of the rig over the last frame, world frame, in radians per second. */
  angularVelocityRadPerSec: [number, number, number];
  /** World position of the rig, in metres. */
  rigPositionM: [number, number, number];
  /** Velocity of the rig over the last frame, world frame, in metres per second. */
  linearVelocityMps: [number, number, number];
  /**
   * True for the first sample after the history restarted (start, paused
   * frame, rig teleport): state carried over from earlier samples is stale.
   */
  restarted: boolean;
};

export type RigKinematicsSystem = System & {
  /** Called every frame once two consecutive rates exist. */
  onSample(listener: (sample: RigKinematicsSample) => void): Unsubscribe;
};

type RigKinematicsInternals = RigKinematicsSystem & {
  sceneEl: Scene;
  listeners: Set<(sample: RigKinematicsSample) => void>;
  prevQuaternion: Quaternion | null;
  prevPosition: Vector3 | null;
  prevYawRate: { degPerSec: number; deltaMs: number } | null;
  restarted: boolean;
  teleports: RigTeleportFlag;
  scratch: { position: Vector3; quaternion: Quaternion; scale: Vector3; relative: Quaternion; rotation: Vector3; velocity: Vector3 };
};

/**
 * Rig rotation, read from the rig's world pose after all components have
 * moved it (`tock`). The rotation since the previous frame, as a rotation
 * vector over the frame time, is the angular velocity; its y component in the
 * rig's previous frame is the yaw rate about the rig's **local** up axis. The
 * rig is pitched by `tour-flight`, so this is not the heading change about
 * world up. The yaw acceleration is taken from two consecutive rates, over the
 * spacing of their interval centres. The position change over the frame
 * time is the linear velocity.
 */
AFRAME.registerSystem('rig-kinematics', {
  init(this: RigKinematicsInternals) {
    this.listeners = new Set();
    this.prevQuaternion = null;
    this.prevPosition = null;
    this.prevYawRate = null;
    this.restarted = true;
    this.teleports = new RigTeleportFlag(this.sceneEl);
    this.scratch = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      relative: new THREE.Quaternion(),
      rotation: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
    };
  },

  onSample(this: RigKinematicsInternals, listener: (sample: RigKinematicsSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  tock(this: RigKinematicsInternals, time: number, timeDelta: number) {
    const rig = findRig(this.sceneEl);
    const teleported = this.teleports.consume();

    if (!rig || timeDelta <= 0 || teleported) {
      this.prevQuaternion = null;
      this.prevPosition = null;
      this.prevYawRate = null;
      this.restarted = true;
    }

    if (!rig || timeDelta <= 0) {
      return;
    }

    const { position, quaternion, scale, relative, rotation, velocity } = this.scratch;
    rig.matrixWorld.decompose(position, quaternion, scale);

    if (!this.prevQuaternion || !this.prevPosition) {
      this.prevQuaternion = quaternion.clone();
      this.prevPosition = position.clone();
      return;
    }

    // Rotation since the last frame, expressed in the rig's previous local frame.
    relative.copy(this.prevQuaternion).invert().multiply(quaternion);
    rotationVector(relative, rotation).divideScalar(timeDelta / 1000);
    const yawRate = { degPerSec: THREE.MathUtils.radToDeg(rotation.y), deltaMs: timeDelta };
    // The same angular velocity in world coordinates.
    rotation.applyQuaternion(this.prevQuaternion);
    this.prevQuaternion.copy(quaternion);
    velocity.copy(position).sub(this.prevPosition).divideScalar(timeDelta / 1000);
    this.prevPosition.copy(position);

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
      frameDeltaMs: timeDelta,
      localYawRateDegPerSec: yawRate.degPerSec,
      localYawAccelerationDegPerSec2: (yawRate.degPerSec - prev.degPerSec) / (deltaMs / 1000),
      rigQuaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      angularVelocityRadPerSec: [rotation.x, rotation.y, rotation.z],
      rigPositionM: [position.x, position.y, position.z],
      linearVelocityMps: [velocity.x, velocity.y, velocity.z],
      restarted: this.restarted,
    };
    this.restarted = false;
    this.listeners.forEach((listener) => listener(sample));
  },
});

/** Frames longer than this (tab switch, XR session start) re-align integrated models with the rig instead of integrating. */
const MAX_INTEGRATION_STEP_MS = 100;

/**
 * Whether a model driven by these samples (`InertialSphere`, `InertialMass`)
 * may integrate over this one: `aligned` means it has already been reset to
 * the rig once. Otherwise it should snap to the rig: on its first sample,
 * after a restart (start, paused frame, rig teleport) and after a long frame.
 */
export function isIntegrable(sample: RigKinematicsSample, aligned: boolean): boolean {
  return aligned && !sample.restarted && sample.frameDeltaMs <= MAX_INTEGRATION_STEP_MS;
}

export function getRigKinematics(sceneEl: Element): RigKinematicsSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['rig-kinematics'] as RigKinematicsSystem;
}
