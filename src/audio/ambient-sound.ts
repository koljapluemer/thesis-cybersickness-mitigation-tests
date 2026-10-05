import 'aframe';
import type { Component, Scene, System } from 'aframe';
import type { Quaternion, Vector3 } from 'three';
// Imported for its registration order as well: see the `ambient-sound` system.
import { getInertialAmbience } from '../inertial-ambience/inertial-ambience-system';
import type { Unsubscribe } from '../optical-flow/types';
import { findRig, headMatrixWorld } from '../rig';
import { getAudio } from './audio-system';

const THREE = AFRAME.THREE;

/** Time constant of the source position changes, in seconds. */
const POSITION_SMOOTHING_SEC = 0.02;
/** Time constant of the fade in, in seconds. */
const FADE_IN_SEC = 0.5;

export type AmbientSoundData = {
  /** Audio file URL (under `public/`). */
  src: string;
  /** Output gain at `refDistance`, 0..1. */
  gain: number;
  /** Distance at which the sound plays at `gain`; farther, it falls with 1/distance, in metres. */
  refDistance: number;
};

type AmbientGraph = {
  source: AudioBufferSourceNode;
  panner: PannerNode;
  master: GainNode;
};

type AmbientSoundComponent = Component<AmbientSoundData> & {
  /** The decoded file, or its pending decode, once the shared context runs. */
  buffer: Promise<AudioBuffer> | null;
  graph: AmbientGraph | null;
  /** Starts decoding on the first call; the graph exists once that is done. */
  load(context: AudioContext): void;
  start(context: AudioContext, buffer: AudioBuffer): void;
};

/** Static description of one ambient source, for the session log. */
export type AmbientSoundDescription = {
  /** The entity's id. */
  id: string;
  src: string;
  /** World position of the source, in metres. */
  positionWorld: [number, number, number];
  gain: number;
  refDistance: number;
};

/** Where one playing source is, relative to the head, in a frame. */
export type AmbientSourceSample = {
  id: string;
  /** Where its entity is: head coordinates (x right, y up, −z forward), in metres. */
  anchoredHead: [number, number, number];
  /** Where it is played from, after `inertial-ambience`'s rotation: head coordinates, in metres. */
  heardHead: [number, number, number];
};

export type AmbientSoundSample = {
  sceneTimeMs: number;
  sources: AmbientSourceSample[];
};

export type AmbientSoundSystem = System & {
  /** The scene's ambient sources; empty in scenes without any. */
  describe(): AmbientSoundDescription[];
  /** Called every frame in which at least one source plays. */
  onSample(listener: (sample: AmbientSoundSample) => void): Unsubscribe;
};

type AmbientSoundInternals = AmbientSoundSystem & {
  sceneEl: Scene;
  components: Set<AmbientSoundComponent>;
  listeners: Set<(sample: AmbientSoundSample) => void>;
  scratch: {
    offset: Vector3;
    anchored: Vector3;
    headPosition: Vector3;
    headQuaternion: Quaternion;
    headInverse: Quaternion;
    rigQuaternion: Quaternion;
    toHeard: Quaternion;
    scale: Vector3;
    discard: Vector3;
  };
  register(component: AmbientSoundComponent): void;
  unregister(component: AmbientSoundComponent): void;
};

async function decode(context: AudioContext, src: string): Promise<AudioBuffer> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`ambient-sound: ${src} returned ${response.status}.`);
  }

  return context.decodeAudioData(await response.arrayBuffer());
}

function toArray(vector: Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z];
}

/**
 * Places every `ambient-sound` source each frame. Same listener convention as
 * the motor sound: the listener keeps Web Audio's default pose and each source
 * is placed in head coordinates. Its direction from the head is turned by
 * `inertial-ambience`'s lag rotation, which acts in rig coordinates:
 *
 *     heard = q_head⁻¹ · q_rig · L · q_rig⁻¹ · (p_source − p_head)
 *
 * With L the identity (every other condition), that is where the source is.
 *
 * Systems `tock` after all components, in registration order. This module
 * imports `inertial-ambience`, which imports `rig-kinematics`, so both
 * register before this system: L is this frame's, stepped from this frame's
 * rig pose, and the head pose is current (see `headMatrixWorld`).
 */
AFRAME.registerSystem('ambient-sound', {
  init(this: AmbientSoundInternals) {
    this.components = new Set();
    this.listeners = new Set();
    this.scratch = {
      offset: new THREE.Vector3(),
      anchored: new THREE.Vector3(),
      headPosition: new THREE.Vector3(),
      headQuaternion: new THREE.Quaternion(),
      headInverse: new THREE.Quaternion(),
      rigQuaternion: new THREE.Quaternion(),
      toHeard: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      discard: new THREE.Vector3(),
    };
  },

  register(this: AmbientSoundInternals, component: AmbientSoundComponent) {
    this.components.add(component);
  },

  unregister(this: AmbientSoundInternals, component: AmbientSoundComponent) {
    this.components.delete(component);
  },

  tock(this: AmbientSoundInternals, time: number) {
    const context = getAudio(this.sceneEl).runningContext();
    const rig = findRig(this.sceneEl);

    if (!context || !rig || this.components.size === 0) {
      return;
    }

    const { offset, anchored, headPosition, headQuaternion, headInverse, rigQuaternion, toHeard, scale, discard } = this.scratch;
    headMatrixWorld(this.sceneEl).decompose(headPosition, headQuaternion, scale);
    rig.matrixWorld.decompose(discard, rigQuaternion, scale);
    headInverse.copy(headQuaternion).invert();
    // q_head⁻¹ · q_rig · L · q_rig⁻¹
    toHeard
      .copy(headInverse)
      .multiply(rigQuaternion)
      .multiply(getInertialAmbience(this.sceneEl).lagRotation)
      .multiply(rigQuaternion.invert());

    const now = context.currentTime;
    const sources: AmbientSourceSample[] = [];

    this.components.forEach((component) => {
      component.load(context);

      if (!component.graph) {
        return;
      }

      component.el.object3D.getWorldPosition(offset).sub(headPosition);
      anchored.copy(offset).applyQuaternion(headInverse);
      offset.applyQuaternion(toHeard);

      const { panner } = component.graph;
      panner.positionX.setTargetAtTime(offset.x, now, POSITION_SMOOTHING_SEC);
      panner.positionY.setTargetAtTime(offset.y, now, POSITION_SMOOTHING_SEC);
      panner.positionZ.setTargetAtTime(offset.z, now, POSITION_SMOOTHING_SEC);

      sources.push({ id: component.el.id, anchoredHead: toArray(anchored), heardHead: toArray(offset) });
    });

    if (sources.length > 0) {
      const sample: AmbientSoundSample = { sceneTimeMs: time, sources };
      this.listeners.forEach((listener) => listener(sample));
    }
  },

  describe(this: AmbientSoundInternals): AmbientSoundDescription[] {
    return [...this.components].map((component) => {
      const position = component.el.object3D.getWorldPosition(new THREE.Vector3());
      const { src, gain, refDistance } = component.data;
      return { id: component.el.id, src, positionWorld: toArray(position), gain, refDistance };
    });
  },

  onSample(this: AmbientSoundInternals, listener: (sample: AmbientSoundSample) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },
});

/**
 * A looped audio file as an HRTF point source at the entity's world position.
 * Loads and starts once the shared `audio` context is running; the
 * `ambient-sound` system places it every frame.
 */
AFRAME.registerComponent('ambient-sound', {
  schema: {
    src: { type: 'string' },
    gain: { type: 'number', default: 0.5 },
    refDistance: { type: 'number', default: 1 },
  },

  init(this: AmbientSoundComponent) {
    this.buffer = null;
    this.graph = null;
    ambientSoundInternals(this.el.sceneEl as Scene).register(this);
  },

  load(this: AmbientSoundComponent, context: AudioContext) {
    if (this.buffer) {
      return;
    }

    this.buffer = decode(context, this.data.src);
    this.buffer.then((buffer) => this.start(context, buffer)).catch((error: unknown) => console.error(error));
  },

  start(this: AmbientSoundComponent, context: AudioContext, buffer: AudioBuffer) {
    const source = new AudioBufferSourceNode(context, { buffer, loop: true });
    const panner = new PannerNode(context, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: this.data.refDistance,
      rolloffFactor: 1,
    });
    const master = new GainNode(context, { gain: 0 });

    source.connect(panner).connect(master).connect(context.destination);
    source.addEventListener('ended', () => [source, panner, master].forEach((node) => node.disconnect()));
    // Random start, so the loop point does not fall at the same moment every session.
    source.start(0, Math.random() * buffer.duration);
    master.gain.setTargetAtTime(this.data.gain, context.currentTime, FADE_IN_SEC);

    this.graph = { source, panner, master };
  },

  remove(this: AmbientSoundComponent) {
    ambientSoundInternals(this.el.sceneEl as Scene).unregister(this);
    this.graph?.source.stop();
    this.graph = null;
  },
});

function ambientSoundInternals(sceneEl: Element): AmbientSoundInternals {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['ambient-sound'] as AmbientSoundInternals;
}

export function getAmbientSound(sceneEl: Element): AmbientSoundSystem {
  return ambientSoundInternals(sceneEl);
}
