import type { AudioSystem } from '../audio/audio-system';
import type { CueOutput, TurnDirection } from './types';

export type StereoToneOptions = {
  frequencyHz: number;
  durationMs: number;
  /** Length of the fade-in and fade-out ramps that avoid clicks, in milliseconds. */
  fadeMs: number;
  /** Peak gain, 0..1. */
  gain: number;
};

/**
 * A sine tone on the left or right channel only. Plain head-locked stereo,
 * deliberately not A-Frame's `sound` / three's `PositionalAudio`, which would
 * anchor the sound in the world. Plays through the shared `audio` system's
 * context; while that is still locked, cues are not presented.
 */
export class StereoToneOutput implements CueOutput {
  private readonly audio: AudioSystem;
  private readonly options: StereoToneOptions;
  private readonly playing = new Set<OscillatorNode>();

  constructor(audio: AudioSystem, options: StereoToneOptions) {
    this.audio = audio;
    this.options = options;
  }

  present(direction: TurnDirection): boolean {
    const context = this.audio.runningContext();

    if (!context) {
      return false;
    }

    const { frequencyHz, durationMs, fadeMs, gain } = this.options;
    const start = context.currentTime;
    const end = start + durationMs / 1000;
    const fade = Math.min(fadeMs, durationMs / 2) / 1000;

    const oscillator = new OscillatorNode(context, { type: 'sine', frequency: frequencyHz });
    const envelope = new GainNode(context, { gain: 0 });
    const panner = new StereoPannerNode(context, { pan: direction === 'left' ? -1 : 1 });

    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(gain, start + fade);
    envelope.gain.setValueAtTime(gain, end - fade);
    envelope.gain.linearRampToValueAtTime(0, end);

    oscillator.connect(envelope).connect(panner).connect(context.destination);
    oscillator.addEventListener('ended', () => {
      this.playing.delete(oscillator);
      oscillator.disconnect();
      envelope.disconnect();
      panner.disconnect();
    });
    oscillator.start(start);
    oscillator.stop(end);
    this.playing.add(oscillator);

    return true;
  }

  /** Cuts off tones still playing; the shared context outlives this output. */
  dispose(): void {
    this.playing.forEach((oscillator) => oscillator.stop());
  }
}
