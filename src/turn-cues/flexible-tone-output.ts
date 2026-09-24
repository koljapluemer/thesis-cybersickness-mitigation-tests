import type { AudioSystem } from '../audio/audio-system';
import type { TurnOutput, TurnSignal } from './types';

export type FlexibleToneOptions = {
  frequencyHz: number;
  /** Smoothed turn rate at which a channel reaches `gain`, in degrees per second. */
  fullScaleDegPerSec: number;
  /** Time constant of the gain changes that avoid clicks, in milliseconds. */
  fadeMs: number;
  /** Peak gain per channel, 0..1. */
  gain: number;
};

type ToneGraph = {
  oscillator: OscillatorNode;
  left: GainNode;
  right: GainNode;
  merger: ChannelMergerNode;
};

/**
 * A continuous sine tone whose loudness on each ear follows the smoothed turn
 * rate: a left turn raises the left channel, a right turn the right channel,
 * linearly up to `gain` at `fullScaleDegPerSec`; straight flight is silent.
 * Head-locked stereo like `StereoToneOutput`. The tone starts with the first
 * signal once the shared `audio` context is running; discrete cues are not
 * presented.
 */
export class FlexibleToneOutput implements TurnOutput {
  private readonly audio: AudioSystem;
  private readonly options: FlexibleToneOptions;
  private graph: ToneGraph | null = null;

  constructor(audio: AudioSystem, options: FlexibleToneOptions) {
    this.audio = audio;
    this.options = options;
  }

  signal(signal: TurnSignal): void {
    const context = this.audio.runningContext();

    if (!context) {
      return;
    }

    const graph = this.graph ?? this.start(context);
    const { fullScaleDegPerSec, fadeMs, gain } = this.options;
    const level = (degPerSec: number) => gain * Math.min(1, Math.max(0, degPerSec) / fullScaleDegPerSec);

    graph.left.gain.setTargetAtTime(level(signal.smoothedDegPerSec), context.currentTime, fadeMs / 1000);
    graph.right.gain.setTargetAtTime(level(-signal.smoothedDegPerSec), context.currentTime, fadeMs / 1000);
  }

  present(): boolean {
    return false;
  }

  /** Fades the tone out and releases its nodes; the shared context outlives this output. */
  dispose(): void {
    if (!this.graph) {
      return;
    }

    const { oscillator, left, right } = this.graph;
    const context = oscillator.context;
    const fade = this.options.fadeMs / 1000;

    left.gain.setTargetAtTime(0, context.currentTime, fade);
    right.gain.setTargetAtTime(0, context.currentTime, fade);
    oscillator.stop(context.currentTime + 5 * fade);
    this.graph = null;
  }

  private start(context: AudioContext): ToneGraph {
    const oscillator = new OscillatorNode(context, { type: 'sine', frequency: this.options.frequencyHz });
    const left = new GainNode(context, { gain: 0 });
    const right = new GainNode(context, { gain: 0 });
    const merger = new ChannelMergerNode(context, { numberOfInputs: 2 });

    oscillator.connect(left).connect(merger, 0, 0);
    oscillator.connect(right).connect(merger, 0, 1);
    merger.connect(context.destination);
    oscillator.addEventListener('ended', () => {
      oscillator.disconnect();
      left.disconnect();
      right.disconnect();
      merger.disconnect();
    });
    oscillator.start();

    this.graph = { oscillator, left, right, merger };
    return this.graph;
  }
}
