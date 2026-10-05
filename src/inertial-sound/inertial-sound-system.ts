import 'aframe';
import type { Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
import { getAudio } from '../audio/audio-system';
import type { Unsubscribe } from '../optical-flow/types';
import { headMatrixWorld } from '../rig';
import { getRigKinematics, isIntegrable, type RigKinematicsSample } from '../rig-kinematics/rig-kinematics-system';
import { fromRotationVector } from '../rotation';
import { InertialMass } from './inertial-mass';
import { InertialSphere } from './inertial-sphere';
import { MotorSound, REFERENCE_DISTANCE_M } from './motor-sound';

const THREE = AFRAME.THREE;

/**
 * Which rig motion deflects the source: `rotation` turns it with the lag of an
 * `InertialSphere` (angular acceleration), `translation` shifts it by the
 * offset of an `InertialMass` (linear acceleration).
 */
export type InertialMotion = 'rotation' | 'translation';

export type InertialSoundData = {
  enabled: boolean;
  motion: InertialMotion;
  /** Undamped natural period of the sphere's or mass's spring, in milliseconds. */
  naturalPeriodMs: number;
  /** 1 = critically damped. */
  dampingRatio: number;
  /**
   * `rotation`: the source's lag is the sphere's lag times this, over all axes:
   * sets the size of the swing while `naturalPeriodMs` and `dampingRatio` set
   * its timing. Must be > 0.
   */
  lagGain: number;
  /** `rotation`: the source's lag is clamped to this angle, in degrees. */
  maxLagDeg: number;
  /** `translation`: the source's offset is the mass's offset times this. Must be > 0. */
  offsetGain: number;
  /** `translation`: the source's offset is clamped to this distance, in metres. */
  maxOffsetM: number;
  /**
   * Rest direction of the source below the rig's forward axis (itself pitched
   * down by `tour-flight`), in degrees; −90 is straight below in the rig frame.
   */
  elevationDeg: number;
  /**
   * Whether the motor revs with the deflection (firing rate, body pitch and
   * noise band rise with `lagFraction`) or keeps a constant timbre. See `MotorSound`.
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
   * `rotation`: rotation of the source from its rest direction, relative to the
   * rig: the sphere's lag times `lagGain`, as a rotation vector in rig
   * coordinates, in degrees (x pitch, y yaw, z roll; y > 0 = sound turned left).
   * Zero under `translation`.
   */
  lagRotationVectorDeg: [number, number, number];
  /**
   * `translation`: shift of the source from its rest position: the mass's offset
   * times `offsetGain`, in rig coordinates, in metres (z > 0 = sound moved back).
   * Zero under `rotation`.
   */
  offsetRigM: [number, number, number];
  /** Position of the source in rig coordinates (x right, y up, −z forward), relative to the head, in metres. */
  sourcePositionRig: [number, number, number];
  /** Position of the source in head coordinates (x right, y up, −z forward), in metres. */
  sourcePositionHead: [number, number, number];
  /** Deflection over its clamp (`maxLagDeg` or `maxOffsetM`), 0..1: how far the motor revs. */
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
    sourceOffset: Vector3;
    position: Vector3;
    positionRig: Vector3;
    lagQuaternion: Quaternion;
    rigQuaternion: Quaternion;
    rigAngularVelocity: Vector3;
    rigPosition: Vector3;
    rigVelocity: Vector3;
    headPosition: Vector3;
    headQuaternion: Quaternion;
    headScale: Vector3;
  };
  step(model: InertialModel, sound: MotorSound, sample: RigKinematicsSample, aligned: boolean): void;
  teardown(): void;
};

/** The model that deflects the source, chosen by `motion`. */
type InertialModel = { motion: 'rotation'; sphere: InertialSphere } | { motion: 'translation'; mass: InertialMass };

/**
 * Inertial motor sound: a world-anchored, HRTF-spatialized motor sound whose
 * source is deflected from its rest position by the rig's acceleration: under
 * `motion: 'rotation'` it lags behind the rig's rotation by `lagGain` times the
 * lag of an `InertialSphere`, under `'translation'` it is shifted by
 * `offsetGain` times the offset of an `InertialMass`. Driven by
 * `rig-kinematics`; configured per experimental condition through the schema.
 */
AFRAME.registerSystem('inertial-sound', {
  schema: {
    enabled: { type: 'boolean', default: false },
    motion: { type: 'string', default: 'rotation', oneOf: ['rotation', 'translation'] },
    naturalPeriodMs: { type: 'number', default: 8000 },
    dampingRatio: { type: 'number', default: 1 },
    lagGain: { type: 'number', default: 1 },
    maxLagDeg: { type: 'number', default: 150 },
    offsetGain: { type: 'number', default: 1 },
    maxOffsetM: { type: 'number', default: 0.5 },
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
      sourceOffset: new THREE.Vector3(),
      position: new THREE.Vector3(),
      positionRig: new THREE.Vector3(),
      lagQuaternion: new THREE.Quaternion(),
      rigQuaternion: new THREE.Quaternion(),
      rigAngularVelocity: new THREE.Vector3(),
      rigPosition: new THREE.Vector3(),
      rigVelocity: new THREE.Vector3(),
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
    this.scratch.rest.set(0, Math.sin(elevation), -Math.cos(elevation)).multiplyScalar(REFERENCE_DISTANCE_M);

    // Clamping the sphere or mass at the source's clamp over its gain clamps the source.
    const model: InertialModel =
      data.motion === 'translation'
        ? { motion: 'translation', mass: new InertialMass({ ...data, maxOffsetM: data.maxOffsetM / data.offsetGain }) }
        : { motion: 'rotation', sphere: new InertialSphere({ ...data, maxLagDeg: data.maxLagDeg / data.lagGain }) };
    const sound = new MotorSound(getAudio(this.sceneEl), { gain: data.gain, fadeMs: data.fadeMs, revWithLag: data.revWithLag });
    let aligned = false;

    this.sound = sound;
    this.unsubscribeKinematics = getRigKinematics(this.sceneEl).onSample((sample) => {
      this.step(model, sound, sample, aligned);
      aligned = true;
    });
  },

  step(this: InertialSoundInternals, model: InertialModel, sound: MotorSound, sample: RigKinematicsSample, aligned: boolean) {
    const { rest, sourceLag, sourceOffset, position, positionRig, lagQuaternion, rigQuaternion, rigAngularVelocity, rigPosition, rigVelocity, headPosition, headQuaternion, headScale } = this.scratch;
    rigQuaternion.fromArray(sample.rigQuaternion);
    rigAngularVelocity.fromArray(sample.angularVelocityRadPerSec);
    rigPosition.fromArray(sample.rigPositionM);
    rigVelocity.fromArray(sample.linearVelocityMps);
    const integrate = isIntegrable(sample, aligned);
    const dtSec = sample.frameDeltaMs / 1000;
    let lagFraction: number;

    if (model.motion === 'rotation') {
      if (integrate) {
        model.sphere.step(rigQuaternion, rigAngularVelocity, dtSec);
      } else {
        model.sphere.reset(rigQuaternion, rigAngularVelocity);
      }

      sourceLag.copy(model.sphere.lag).multiplyScalar(this.data.lagGain);
      sourceOffset.set(0, 0, 0);
      positionRig.copy(rest).applyQuaternion(fromRotationVector(sourceLag, lagQuaternion));
      lagFraction = Math.min(1, sourceLag.length() / THREE.MathUtils.degToRad(this.data.maxLagDeg));
    } else {
      if (integrate) {
        model.mass.step(rigPosition, rigQuaternion, rigVelocity, dtSec);
      } else {
        model.mass.reset(rigPosition, rigVelocity);
      }

      sourceLag.set(0, 0, 0);
      sourceOffset.copy(model.mass.offset).multiplyScalar(this.data.offsetGain);
      positionRig.copy(rest).add(sourceOffset);
      lagFraction = Math.min(1, sourceOffset.length() / this.data.maxOffsetM);
    }

    headMatrixWorld(this.sceneEl).decompose(headPosition, headQuaternion, headScale);
    position.copy(positionRig).applyQuaternion(rigQuaternion).applyQuaternion(headQuaternion.invert());

    sound.update(position, lagFraction);

    const toDeg = THREE.MathUtils.radToDeg;
    const logged: InertialSoundSample = {
      sceneTimeMs: sample.sceneTimeMs,
      deltaMs: sample.frameDeltaMs,
      lagRotationVectorDeg: [toDeg(sourceLag.x), toDeg(sourceLag.y), toDeg(sourceLag.z)],
      offsetRigM: [sourceOffset.x, sourceOffset.y, sourceOffset.z],
      sourcePositionRig: [positionRig.x, positionRig.y, positionRig.z],
      sourcePositionHead: [position.x, position.y, position.z],
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
