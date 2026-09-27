import type { Vector3 } from 'three';
import type { AudioSystem } from '../audio/audio-system';

const IDLE = { firingHz: 25, noiseBandHz: 1000 } as const;
const REV = { firingHz: 60, noiseBandHz: 2500 } as const;
/** The sawtooth body sounds at this multiple of the firing rate. */
const BODY_HARMONIC = 2;
/** Time constant of the timbre changes, in seconds. */
const REV_SMOOTHING_SEC = 0.1;
/** Time constant of the source position changes, in seconds. */
const POSITION_SMOOTHING_SEC = 0.02;
const PINK_NOISE_SEC = 4;
/** Distance at which the motor plays at `gain`, in metres: the source's rest distance. */
export const REFERENCE_DISTANCE_M = 1;
/** Closer than this, the level stops rising, in metres. */
const MIN_DISTANCE_M = 0.1;

export type MotorSoundOptions = {
  /** Output gain, 0..1. */
  gain: number;
  /** Time constant of the fade in and out, in milliseconds. */
  fadeMs: number;
  /**
   * Whether the motor "revs" with the lag. `true`: firing rate, body pitch and
   * noise band rise with `lagFraction` (deflection over its clamp), from the idle values
   * below at rest to the rev values at the maximum lag, so the size of the
   * deviation is audible even where HRTF localization is weak (front/back,
   * elevation). `false`: constant idle timbre; only the source position carries
   * information.
   */
  revWithLag: boolean;
};

type MotorGraph = {
  sources: AudioScheduledSourceNode[];
  firing: OscillatorNode;
  body: OscillatorNode;
  noiseBand: BiquadFilterNode;
  panner: PannerNode;
  distance: GainNode;
  master: GainNode;
};

/** Paul Kellet's refined pink noise filter over white noise, peak around ±1. */
function pinkNoiseBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = new AudioBuffer({ length: PINK_NOISE_SEC * context.sampleRate, sampleRate: context.sampleRate });
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }

  return buffer;
}

/**
 * An abstract motor as a world-anchored point source: looped pink noise in a
 * band around 1 kHz, amplitude-modulated at the firing rate (the "chug", and
 * the broadband part HRTF localization relies on), plus a low-passed sawtooth
 * at twice the firing rate (the body). Both go through one HRTF `PannerNode`.
 *
 * The listener keeps Web Audio's default pose (origin, looking along −z, up
 * +y, as a three.js camera); `update` places the source at the given
 * head-frame position. The level falls with 1/distance, normalized to `gain`
 * at `REFERENCE_DISTANCE_M` (the panner's own distance models cannot get
 * louder closer than their reference distance). Starts with the first update
 * once the shared `audio` context is running.
 */
export class MotorSound {
  private readonly audio: AudioSystem;
  private readonly options: MotorSoundOptions;
  private graph: MotorGraph | null = null;

  constructor(audio: AudioSystem, options: MotorSoundOptions) {
    this.audio = audio;
    this.options = options;
  }

  /** `position`: of the source in head coordinates, in metres; `lagFraction`: 0..1. */
  update(position: Vector3, lagFraction: number): void {
    const context = this.audio.runningContext();

    if (!context) {
      return;
    }

    const graph = this.graph ?? this.start(context);
    const now = context.currentTime;

    graph.panner.positionX.setTargetAtTime(position.x, now, POSITION_SMOOTHING_SEC);
    graph.panner.positionY.setTargetAtTime(position.y, now, POSITION_SMOOTHING_SEC);
    graph.panner.positionZ.setTargetAtTime(position.z, now, POSITION_SMOOTHING_SEC);
    graph.distance.gain.setTargetAtTime(
      REFERENCE_DISTANCE_M / Math.max(MIN_DISTANCE_M, position.length()),
      now,
      POSITION_SMOOTHING_SEC,
    );

    if (this.options.revWithLag) {
      const rev = Math.min(1, Math.max(0, lagFraction));
      const firingHz = IDLE.firingHz + rev * (REV.firingHz - IDLE.firingHz);
      graph.firing.frequency.setTargetAtTime(firingHz, now, REV_SMOOTHING_SEC);
      graph.body.frequency.setTargetAtTime(BODY_HARMONIC * firingHz, now, REV_SMOOTHING_SEC);
      graph.noiseBand.frequency.setTargetAtTime(
        IDLE.noiseBandHz + rev * (REV.noiseBandHz - IDLE.noiseBandHz),
        now,
        REV_SMOOTHING_SEC,
      );
    }
  }

  /** Fades the motor out and releases its nodes; the shared context outlives this sound. */
  dispose(): void {
    if (!this.graph) {
      return;
    }

    const { sources, master } = this.graph;
    const context = master.context;
    const fade = this.options.fadeMs / 1000;

    master.gain.setTargetAtTime(0, context.currentTime, fade);
    sources.forEach((source) => source.stop(context.currentTime + 5 * fade));
    this.graph = null;
  }

  private start(context: AudioContext): MotorGraph {
    const noise = new AudioBufferSourceNode(context, { buffer: pinkNoiseBuffer(context), loop: true });
    const noiseBand = new BiquadFilterNode(context, { type: 'bandpass', frequency: IDLE.noiseBandHz, Q: 0.8 });
    // Chug gain swings 0..1 with the firing oscillator.
    const chug = new GainNode(context, { gain: 0.5 });
    const firing = new OscillatorNode(context, { type: 'sine', frequency: IDLE.firingHz });
    const firingDepth = new GainNode(context, { gain: 0.5 });
    const body = new OscillatorNode(context, { type: 'sawtooth', frequency: BODY_HARMONIC * IDLE.firingHz });
    const bodyLowpass = new BiquadFilterNode(context, { type: 'lowpass', frequency: 500 });
    const bodyGain = new GainNode(context, { gain: 0.25 });
    const panner = new PannerNode(context, {
      panningModel: 'HRTF',
      rolloffFactor: 0,
      positionX: 0,
      positionY: 0,
      positionZ: -REFERENCE_DISTANCE_M,
    });
    const distance = new GainNode(context, { gain: 1 });
    const master = new GainNode(context, { gain: 0 });

    noise.connect(noiseBand).connect(chug).connect(panner);
    firing.connect(firingDepth).connect(chug.gain);
    body.connect(bodyLowpass).connect(bodyGain).connect(panner);
    panner.connect(distance).connect(master).connect(context.destination);

    const sources = [noise, firing, body];
    const nodes: AudioNode[] = [...sources, noiseBand, chug, firingDepth, bodyLowpass, bodyGain, panner, distance, master];
    noise.addEventListener('ended', () => nodes.forEach((node) => node.disconnect()));
    sources.forEach((source) => source.start());
    master.gain.setTargetAtTime(this.options.gain, context.currentTime, this.options.fadeMs / 1000);

    this.graph = { sources, firing, body, noiseBand, panner, distance, master };
    return this.graph;
  }
}
