import type { Scene } from 'aframe';
import type { CueOutput, TurnDirection } from './types';

export type StereoToneOptions = {
  frequencyHz: number;
  durationMs: number;
  /** Length of the fade-in and fade-out ramps that avoid clicks, in milliseconds. */
  fadeMs: number;
  /** Peak gain, 0..1. */
  gain: number;
};

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

/**
 * A sine tone on the left or right channel only. Plain head-locked stereo,
 * deliberately not A-Frame's `sound` / three's `PositionalAudio`, which would
 * anchor the sound in the world.
 *
 * Browsers only let audio start from a user gesture, so the `AudioContext` is
 * created and resumed from the first pointer/key event on the page, from
 * entering VR, or from a controller `select` in VR, and re-armed whenever it
 * gets suspended or interrupted. Until then cues are not presented.
 */
export class StereoToneOutput implements CueOutput {
  private readonly sceneEl: Scene;
  private readonly options: StereoToneOptions;
  private context: AudioContext | null = null;
  private xrSession: XRSession | null = null;
  private readonly unlock = () => this.resume();
  private readonly onEnterVr = () => {
    this.xrSession = this.sceneEl.renderer.xr.getSession();
    this.xrSession?.addEventListener('select', this.unlock);
    this.resume();
  };
  private readonly onExitVr = () => {
    this.xrSession?.removeEventListener('select', this.unlock);
    this.xrSession = null;
  };
  private readonly onStateChange = () => {
    if (this.context?.state === 'running') {
      this.removeUnlockListeners();
    } else {
      this.addUnlockListeners();
    }
  };

  constructor(sceneEl: Scene, options: StereoToneOptions) {
    this.sceneEl = sceneEl;
    this.options = options;
    this.addUnlockListeners();
    sceneEl.addEventListener('enter-vr', this.onEnterVr);
    sceneEl.addEventListener('exit-vr', this.onExitVr);
  }

  present(direction: TurnDirection): boolean {
    const context = this.context;

    if (context?.state !== 'running') {
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
      oscillator.disconnect();
      envelope.disconnect();
      panner.disconnect();
    });
    oscillator.start(start);
    oscillator.stop(end);

    return true;
  }

  dispose(): void {
    this.removeUnlockListeners();
    this.onExitVr();
    this.sceneEl.removeEventListener('enter-vr', this.onEnterVr);
    this.sceneEl.removeEventListener('exit-vr', this.onExitVr);
    void this.context?.close();
    this.context = null;
  }

  private resume(): void {
    if (!this.context) {
      this.context = new AudioContext();
      this.context.addEventListener('statechange', this.onStateChange);
      // A context created inside a gesture may start running without a state change.
      this.onStateChange();
    }

    if (this.context.state !== 'running') {
      void this.context.resume();
    }
  }

  private addUnlockListeners(): void {
    UNLOCK_EVENTS.forEach((type) => document.addEventListener(type, this.unlock, { capture: true }));
  }

  private removeUnlockListeners(): void {
    UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, this.unlock, { capture: true }));
  }
}
