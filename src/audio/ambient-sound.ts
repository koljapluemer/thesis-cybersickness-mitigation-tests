import 'aframe';
import type { Component, Scene } from 'aframe';
import { headMatrixWorld } from '../rig';
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

export type AmbientSoundComponent = Component<AmbientSoundData> & {
  /** The decoded file, or its pending decode, once the shared context runs. */
  buffer: Promise<AudioBuffer> | null;
  graph: AmbientGraph | null;
  position: InstanceType<typeof THREE.Vector3>;
  headInverse: InstanceType<typeof THREE.Matrix4>;
  start(context: AudioContext, buffer: AudioBuffer): void;
};

async function decode(context: AudioContext, src: string): Promise<AudioBuffer> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`ambient-sound: ${src} returned ${response.status}.`);
  }

  return context.decodeAudioData(await response.arrayBuffer());
}

/**
 * A looped audio file as an HRTF point source at the entity's world position.
 * Same listener convention as the motor sound: the listener keeps Web Audio's
 * default pose and the source is placed in head coordinates every frame. Loads
 * and starts once the shared `audio` context is running.
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
    this.position = new THREE.Vector3();
    this.headInverse = new THREE.Matrix4();
  },

  /** In `tock`, the head matrix is current for this frame (see `headMatrixWorld`). */
  tock(this: AmbientSoundComponent) {
    const sceneEl = this.el.sceneEl as Scene;
    const context = getAudio(sceneEl).runningContext();

    if (!context) {
      return;
    }

    if (!this.buffer) {
      this.buffer = decode(context, this.data.src);
      this.buffer.then((buffer) => this.start(context, buffer)).catch((error: unknown) => console.error(error));
    }

    if (!this.graph) {
      return;
    }

    this.headInverse.copy(headMatrixWorld(sceneEl)).invert();
    this.el.object3D.getWorldPosition(this.position).applyMatrix4(this.headInverse);

    const { panner } = this.graph;
    const now = context.currentTime;
    panner.positionX.setTargetAtTime(this.position.x, now, POSITION_SMOOTHING_SEC);
    panner.positionY.setTargetAtTime(this.position.y, now, POSITION_SMOOTHING_SEC);
    panner.positionZ.setTargetAtTime(this.position.z, now, POSITION_SMOOTHING_SEC);
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
    this.graph?.source.stop();
    this.graph = null;
  },
});
