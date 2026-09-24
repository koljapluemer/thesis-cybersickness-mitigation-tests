import 'aframe';
import type { Scene, System } from 'aframe';
import { getAudio } from '../audio/audio-system';
import { getOpticalFlow } from '../optical-flow/optical-flow-system';
import type { Unsubscribe } from '../optical-flow/types';
import { createOpticalFlowTurnSource } from './optical-flow-turn-source';
import { StereoToneOutput } from './stereo-tone-output';
import { TurnDetector } from './turn-detector';
import type { CueOutput, TurnCue, TurnSignal, TurnSignalSource } from './types';

export type TurnCueData = {
  /** Where the turn rate comes from; `none` disables detection. */
  source: 'optical-flow' | 'none';
  /** How cues are presented; with `none` they are still detected and logged. */
  output: 'stereo-tone' | 'none';
  onThresholdDegPerSec: number;
  offThresholdDegPerSec: number;
  smoothingMs: number;
  toneFrequencyHz: number;
  toneDurationMs: number;
  fadeMs: number;
  gain: number;
};

const SOURCES: Record<Exclude<TurnCueData['source'], 'none'>, (sceneEl: Scene) => TurnSignalSource> = {
  'optical-flow': (sceneEl) => createOpticalFlowTurnSource(getOpticalFlow(sceneEl)),
};

const OUTPUTS: Record<Exclude<TurnCueData['output'], 'none'>, (sceneEl: Scene, data: TurnCueData) => CueOutput> = {
  'stereo-tone': (sceneEl, data) => new StereoToneOutput(getAudio(sceneEl), {
    frequencyHz: data.toneFrequencyHz,
    durationMs: data.toneDurationMs,
    fadeMs: data.fadeMs,
    gain: data.gain,
  }),
};

export type TurnCueSystem = System<TurnCueData> & {
  /** Called for every accepted turn-rate sample, with its smoothed value. */
  onSignal(listener: (signal: TurnSignal) => void): Unsubscribe;
  /** Called for every detected cue, whether or not the output presented it. */
  onCue(listener: (cue: TurnCue) => void): Unsubscribe;
};

type TurnCueInternals = TurnCueSystem & {
  sceneEl: Scene;
  signalListeners: Set<(signal: TurnSignal) => void>;
  cueListeners: Set<(cue: TurnCue) => void>;
  output: CueOutput | null;
  unsubscribeSource: Unsubscribe | null;
  teardown(): void;
};

/**
 * Turn cues: a turn-rate source feeds a `TurnDetector`, whose cues go to an
 * output. Source and output are chosen by the schema; the `condition` system
 * sets that schema per experimental condition.
 */
AFRAME.registerSystem('turn-cues', {
  schema: {
    source: { type: 'string', default: 'optical-flow', oneOf: ['optical-flow', 'none'] },
    output: { type: 'string', default: 'stereo-tone', oneOf: ['stereo-tone', 'none'] },
    onThresholdDegPerSec: { type: 'number', default: 5 },
    offThresholdDegPerSec: { type: 'number', default: 2 },
    smoothingMs: { type: 'number', default: 250 },
    toneFrequencyHz: { type: 'number', default: 800 },
    toneDurationMs: { type: 'number', default: 1000 },
    fadeMs: { type: 'number', default: 15 },
    gain: { type: 'number', default: 0.3 },
  },

  init(this: TurnCueInternals) {
    this.signalListeners = new Set();
    this.cueListeners = new Set();
    this.output = null;
    this.unsubscribeSource = null;
  },

  update(this: TurnCueInternals) {
    this.teardown();

    const data = this.data;

    if (data.source === 'none') {
      return;
    }

    const detector = new TurnDetector({
      onThresholdDegPerSec: data.onThresholdDegPerSec,
      offThresholdDegPerSec: data.offThresholdDegPerSec,
      smoothingMs: data.smoothingMs,
      refractoryMs: data.toneDurationMs,
    });
    const output = data.output === 'none' ? null : OUTPUTS[data.output](this.sceneEl, data);

    this.output = output;
    this.unsubscribeSource = SOURCES[data.source](this.sceneEl).subscribe((sample) => {
      const detection = detector.push(sample);

      if (!detection) {
        return;
      }

      this.signalListeners.forEach((listener) => listener(detection.signal));

      if (detection.cue) {
        const cue: TurnCue = {
          sceneTimeMs: sample.sceneTimeMs,
          direction: detection.cue,
          turnDegPerSec: detection.signal.smoothedDegPerSec,
          presented: output?.present(detection.cue) ?? false,
        };
        this.cueListeners.forEach((listener) => listener(cue));
      }
    });
  },

  teardown(this: TurnCueInternals) {
    this.unsubscribeSource?.();
    this.unsubscribeSource = null;
    this.output?.dispose();
    this.output = null;
  },

  onSignal(this: TurnCueInternals, listener: (signal: TurnSignal) => void): Unsubscribe {
    this.signalListeners.add(listener);
    return () => this.signalListeners.delete(listener);
  },

  onCue(this: TurnCueInternals, listener: (cue: TurnCue) => void): Unsubscribe {
    this.cueListeners.add(listener);
    return () => this.cueListeners.delete(listener);
  },
});

export function getTurnCues(sceneEl: Element): TurnCueSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['turn-cues'] as TurnCueSystem;
}
