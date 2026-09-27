import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import { getAudio } from '../audio/audio-system';
import type { Unsubscribe } from '../optical-flow/types';
import { headMatrixWorld } from '../rig';
import { getRigKinematics, type RigKinematicsSample } from '../rig-kinematics/rig-kinematics-system';
import { fromRotationVector } from '../rotation';
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
  /**
   * The source's lag is the sphere's lag times this, over all axes: sets the
   * size of the swing while `naturalPeriodMs` and `dampingRatio` set its timing.
   * Must be > 0.
   */
  lagGain: number;
  /** The source's lag is clamped to this angle, in degrees; also the lag at which the motor revs fully. */
  maxLagDeg: number;
  /** Rest direction of the source below the rig's forward axis (itself pitched down by `tour-flight`), in degrees. */
  elevationDeg: number;
  /**
   * Whether the motor revs with the lag (firing rate, body pitch and noise band
   * rise with `lagFraction`) or keeps a constant timbre. See `MotorSound`.
   */
  revWithLag: boolean;
  gain: number;
  /** Time constant of the fade in and out, in milliseconds. */
  fadeMs: number;
};

export type InertialSoundSample = {
  sceneTimeMs: number;
  /** Frame interval the sphere was stepped over, in milliseconds. */
  deltaMs: number;
  /**
   * Rotation of the source from its rest direction, relative to the rig: the
   * sphere's lag times `lagGain`, as a rotation vector in rig coordinates, in
   * degrees (x pitch, y yaw, z roll; y > 0 = sound turned left).
   */
  lagRotationVectorDeg: [number, number, number];
  /** Unit vector to the source in rig coordinates (x right, y up, −z forward): the rest direction turned by the lag. */
  sourceDirectionRig: [number, number, number];
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
    sourceLag: Vector3;
    direction: Vector3;
    directionRig: Vector3;
    lagQuaternion: Quaternion;
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
 * Inertial motor sound: a motor sound that lags behind the rig's rotation by
 * `lagGain` times the lag of an `InertialSphere`, world-anchored and
 * HRTF-spatialized. Driven by `rig-kinematics`; configured per experimental
 * condition through the schema.
 */
AFRAME.registerSystem('inertial-sound', {
  schema: {
    enabled: { type: 'boolean', default: false },
    naturalPeriodMs: { type: 'number', default: 8000 },
    dampingRatio: { type: 'number', default: 1 },
    lagGain: { type: 'number', default: 1 },
    maxLagDeg: { type: 'number', default: 150 },
    elevationDeg: { type: 'number', default: -30 },
    revWithLag: { type: 'boolean', default: false },
    gain: { type: 'number', default: 0.3 },
    fadeMs: { type: 'number', default: 50 },
  },

  init(this: InertialSoundInternals) {
    this.listeners = new Set();
    this.sound = null;
    this.unsubscribeKinematics = null;
    this.scratch = {
      rest: new THREE.Vector3(),
      sourceLag: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      directionRig: new THREE.Vector3(),
      lagQuaternion: new THREE.Quaternion(),
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

    // Clamping the sphere at maxLagDeg / lagGain clamps the source at maxLagDeg.
    const sphere = new InertialSphere({ ...data, maxLagDeg: data.maxLagDeg / data.lagGain });
    const sound = new MotorSound(getAudio(this.sceneEl), { gain: data.gain, fadeMs: data.fadeMs, revWithLag: data.revWithLag });
    let aligned = false;

    this.sound = sound;
    this.unsubscribeKinematics = getRigKinematics(this.sceneEl).onSample((sample) => {
      this.step(sphere, sound, sample, aligned);
      aligned = true;
    });
  },

  step(this: InertialSoundInternals, sphere: InertialSphere, sound: MotorSound, sample: RigKinematicsSample, aligned: boolean) {
    const { rest, sourceLag, direction, directionRig, lagQuaternion, rigQuaternion, rigAngularVelocity, headPosition, headQuaternion, headScale } = this.scratch;
    rigQuaternion.fromArray(sample.rigQuaternion);
    rigAngularVelocity.fromArray(sample.angularVelocityRadPerSec);

    if (aligned && sample.frameDeltaMs <= MAX_STEP_MS) {
      sphere.step(rigQuaternion, rigAngularVelocity, sample.frameDeltaMs / 1000);
    } else {
      sphere.reset(rigQuaternion, rigAngularVelocity);
    }

    sourceLag.copy(sphere.lag).multiplyScalar(this.data.lagGain);
    directionRig.copy(rest).applyQuaternion(fromRotationVector(sourceLag, lagQuaternion));

    headMatrixWorld(this.sceneEl).decompose(headPosition, headQuaternion, headScale);
    direction.copy(directionRig).applyQuaternion(rigQuaternion).applyQuaternion(headQuaternion.invert());

    const lagFraction = Math.min(1, sourceLag.length() / THREE.MathUtils.degToRad(this.data.maxLagDeg));
    sound.update(direction, lagFraction);

    const toDeg = THREE.MathUtils.radToDeg;
    const logged: InertialSoundSample = {
      sceneTimeMs: sample.sceneTimeMs,
      deltaMs: sample.frameDeltaMs,
      lagRotationVectorDeg: [toDeg(sourceLag.x), toDeg(sourceLag.y), toDeg(sourceLag.z)],
      sourceDirectionRig: [directionRig.x, directionRig.y, directionRig.z],
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
