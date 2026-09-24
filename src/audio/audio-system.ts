import 'aframe';
import type { Scene, System } from 'aframe';

const UNLOCK_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

export type AudioSystem = System & {
  /** The shared context once it is running, null while audio is still locked. */
  runningContext(): AudioContext | null;
};

type AudioInternals = AudioSystem & {
  sceneEl: Scene;
  audioContext: AudioContext | null;
  xrSession: XRSession | null;
  unlock: () => void;
  onEnterVr: () => void;
  onExitVr: () => void;
  onStateChange: () => void;
  resume(): void;
  addUnlockListeners(): void;
  removeUnlockListeners(): void;
};

/**
 * One `AudioContext` for the whole scene, shared by every sound-producing
 * mitigation and never closed, so switching conditions does not lose the unlock.
 *
 * Browsers only let audio start from a user gesture, so the context is created
 * and resumed from the first pointer/key event on the page, from entering VR,
 * or from a controller `select` in VR, and re-armed whenever it gets suspended
 * or interrupted.
 */
AFRAME.registerSystem('audio', {
  init(this: AudioInternals) {
    this.audioContext = null;
    this.xrSession = null;
    this.unlock = () => this.resume();
    this.onEnterVr = () => {
      this.xrSession = this.sceneEl.renderer.xr.getSession();
      this.xrSession?.addEventListener('select', this.unlock);
      this.resume();
    };
    this.onExitVr = () => {
      this.xrSession?.removeEventListener('select', this.unlock);
      this.xrSession = null;
    };
    this.onStateChange = () => {
      if (this.audioContext?.state === 'running') {
        this.removeUnlockListeners();
      } else {
        this.addUnlockListeners();
      }
    };

    this.addUnlockListeners();
    this.sceneEl.addEventListener('enter-vr', this.onEnterVr);
    this.sceneEl.addEventListener('exit-vr', this.onExitVr);
  },

  runningContext(this: AudioInternals): AudioContext | null {
    return this.audioContext?.state === 'running' ? this.audioContext : null;
  },

  resume(this: AudioInternals) {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.audioContext.addEventListener('statechange', this.onStateChange);
      // A context created inside a gesture may start running without a state change.
      this.onStateChange();
    }

    if (this.audioContext.state !== 'running') {
      void this.audioContext.resume();
    }
  },

  addUnlockListeners(this: AudioInternals) {
    UNLOCK_EVENTS.forEach((type) => document.addEventListener(type, this.unlock, { capture: true }));
  },

  removeUnlockListeners(this: AudioInternals) {
    UNLOCK_EVENTS.forEach((type) => document.removeEventListener(type, this.unlock, { capture: true }));
  },
});

export function getAudio(sceneEl: Element): AudioSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems.audio as AudioSystem;
}
