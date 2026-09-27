import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import { getAudio } from '../audio/audio-system';
import type { Unsubscribe } from '../optical-flow/types';
import { headMatrixWorld } from '../rig';
import { getRigKinematics, type RigKinematicsSample } from '../rig-kinematics/rig-kinematics-system';
import { InertialSphere } from './inertial-sphere';
import { MotorSound } from './motor-sound';

const THREE = AFRAME.THREE;

/** Frames longer than this (tab switch, XR session start) re-align the sphere with the rig instead of integrating. */
const MAX_STEP_MS = 100;

export type InertialSoundData = {
  enabled: boolean;
  /** Undamped natural period of the sphere's spring, in milliseconds. */
  naturalPeriodMs: number;
  /** 1 = critically damped. */
  dampingRatio: number;
  /** The lag is clamped to this angle, in degrees; also the lag at which the motor revs fully. */
  maxLagDeg: number;
  /** Rest direction of the source below the rig's forward axis (itself pitched down by `tour-flight`), in degrees. */
  elevationDeg: number;
  gain: number;
  /** Time constant of the fade in and out, in milliseconds. */
  fadeMs: number;
};

export type InertialSoundSample = {
  sceneTimeMs: number;
  /** Frame interval the sphere was stepped over, in milliseconds. */
  deltaMs: number;
  /**
   * Rotation of the sphere relative to the rig, as a rotation vector in rig
   * coordinates, in degrees (x pitch, y yaw, z roll; y > 0 = sound turned left).
   */
  lagRotationVectorDeg: [number, number, number];
  /** Unit vector to the source in head coordinates (x right, y up, −z forward). */
  sourceDirectionHead: [number, number, number];
  /** Lag angle over `maxLagDeg`, 0..1: how far the motor revs. */
  lagFraction: number;
};

export type InertialSoundSystem = System<InertialSoundData> & {
  /** Called every frame while enabled. */
  onSample(listener: (sample: InertialSoundSample) => void): Unsubscribe;
};

type InertialSoundInternals = InertialSoundSystem & {
  sceneEl: Scene;
  listeners: Set<(sample: InertialSoundSample) => void>;
  sound: MotorSound | null;
  unsubscribeKinematics: Unsubscribe | null;
  scratch: {
    rest: Vector3;
    direction: Vector3;
    rigQuaternion: Quaternion;
    rigAngularVelocity: Vector3;
    headPosition: Vector3;
    headQuaternion: Quaternion;
    headScale: Vector3;
  };
  step(sphere: InertialSphere, sound: MotorSound, sample: RigKinematicsSample, aligned: boolean): void;
  teardown(): void;
};

/**
 * Inertial motor sound: a motor sound on a sphere around the rig that lags
 * behind the rig's rotation (`InertialSphere`), world-anchored and
 * HRTF-spatialized. Driven by `rig-kinematics`; configured per experimental
 * condition through the schema.
 */
AFRAME.registerSystem('inertial-sound', {
  schema: {
    enabled: { type: 'boolean', default: false },
    naturalPeriodMs: { type: 'number', default: 8000 },
    dampingRatio: { type: 'number', default: 1 },
    maxLagDeg: { type: 'number', default: 150 },
    elevationDeg: { type: 'number', default: -30 },
    gain: { type: 'number', default: 0.3 },
    fadeMs: { type: 'number', default: 50 },
  },

  init(this: InertialSoundInternals) {
    this.listeners = new Set();
    this.sound = null;
    this.unsubscribeKinematics = null;
    this.scratch = {
      rest: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      rigQuaternion: new THREE.Quaternion(),
      rigAngularVelocity: new THREE.Vector3(),
      headPosition: new THREE.Vector3(),
      headQuaternion: new THREE.Quaternion(),
      headScale: new THREE.Vector3(),
    };
  },

  update(this: InertialSoundInternals) {
    this.teardown();

    const data = this.data;

    if (!data.enabled) {
      return;
    }

    const elevation = THREE.MathUtils.degToRad(data.elevationDeg);
    this.scratch.rest.set(0, Math.sin(elevation), -Math.cos(elevation));

    const sphere = new InertialSphere(data);
    const sound = new MotorSound(getAudio(this.sceneEl), { gain: data.gain, fadeMs: data.fadeMs });
    let aligned = false;

    this.sound = sound;
    this.unsubscribeKinematics = getRigKinematics(this.sceneEl).onSample((sample) => {
      this.step(sphere, sound, sample, aligned);
      aligned = true;
    });
  },

  step(this: InertialSoundInternals, sphere: InertialSphere, sound: MotorSound, sample: RigKinematicsSample, aligned: boolean) {
    const { rest, direction, rigQuaternion, rigAngularVelocity, headPosition, headQuaternion, headScale } = this.scratch;
    rigQuaternion.fromArray(sample.rigQuaternion);
    rigAngularVelocity.fromArray(sample.angularVelocityRadPerSec);

    if (aligned && sample.frameDeltaMs <= MAX_STEP_MS) {
      sphere.step(rigQuaternion, rigAngularVelocity, sample.frameDeltaMs / 1000);
    } else {
      sphere.reset(rigQuaternion, rigAngularVelocity);
    }

    headMatrixWorld(this.sceneEl).decompose(headPosition, headQuaternion, headScale);
    direction.copy(rest).applyQuaternion(sphere.orientation).applyQuaternion(headQuaternion.invert());

    const lag = sphere.lag;
    const lagFraction = Math.min(1, lag.length() / THREE.MathUtils.degToRad(this.data.maxLagDeg));
    sound.update(direction, lagFraction);

    const toDeg = THREE.MathUtils.radToDeg;
    const logged: InertialSoundSample = {
      sceneTimeMs: sample.sceneTimeMs,
      deltaMs: sample.frameDeltaMs,
      lagRotationVectorDeg: [toDeg(lag.x), toDeg(lag.y), toDeg(lag.z)],
      sourceDirectionHead: [direction.x, direction.y, direction.z],
      lagFraction,
    };
    this.listeners.forEach((listener) => listener(logged));
  },

  teardown(this: InertialSoundInternals) {
    this.unsubscribeKinematics?.();
    this.unsubscribeKinematics = null;
    this.sound?.dispose();
    this.sound = null;
  },

  onSample(this: InertialSoundInternals, listener: (sample: InertialSoundSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
});

export function getInertialSound(sceneEl: Element): InertialSoundSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['inertial-sound'] as InertialSoundSystem;
}
