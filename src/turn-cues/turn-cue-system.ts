import 'aframe';
import type { Scene, System } from 'aframe';
import { getAudio } from '../audio/audio-system';
import { getOpticalFlow } from '../optical-flow/optical-flow-system';
import type { Unsubscribe } from '../optical-flow/types';
import { FlexibleToneOutput } from './flexible-tone-output';
import { getRigKinematics } from '../rig-kinematics/rig-kinematics-system';
import { createOpticalFlowTurnSource } from './optical-flow-turn-source';
import { createRigAngularAccelerationTurnSource } from './rig-angular-acceleration-turn-source';
import { StereoToneOutput } from './stereo-tone-output';
import { TurnDetector } from './turn-detector';
import type { TurnCue, TurnOutput, TurnSignal, TurnSignalSource } from './types';

export type TurnCueData = {
  /** Where the turn strength comes from; `none` disables detection. */
  source: TurnSourceId | 'none';
  /**
   * How turns are presented: `stereo-tone` plays a tone per detected cue,
   * `flexible-tone` a continuous tone following the smoothed turn strength.
   * With `none` cues are still detected and logged.
   */
  output: 'stereo-tone' | 'flexible-tone' | 'none';
  /** Thresholds and `fullScale` are in the source's unit (`TURN_SOURCE_UNITS`). */
  onThreshold: number;
  offThreshold: number;
  smoothingMs: number;
  toneFrequencyHz: number;
  toneDurationMs: number;
  fadeMs: number;
  gain: number;
  /** `flexible-tone`: smoothed turn strength at which a channel reaches `gain`. */
  fullScale: number;
};

type TurnSourceId = 'optical-flow' | 'rig-angular-acceleration';

/** Unit of each source's turn strength, and so of the thresholds and `fullScale`. */
export const TURN_SOURCE_UNITS: Record<TurnSourceId, string> = {
  'optical-flow': '°/s',
  'rig-angular-acceleration': '°/s²',
};

const SOURCES: Record<TurnSourceId, (sceneEl: Scene) => TurnSignalSource> = {
  'optical-flow': (sceneEl) => createOpticalFlowTurnSource(getOpticalFlow(sceneEl)),
  'rig-angular-acceleration': (sceneEl) => createRigAngularAccelerationTurnSource(getRigKinematics(sceneEl)),
};

const OUTPUTS: Record<Exclude<TurnCueData['output'], 'none'>, (sceneEl: Scene, data: TurnCueData) => TurnOutput> = {
  'stereo-tone': (sceneEl, data) => new StereoToneOutput(getAudio(sceneEl), {
    frequencyHz: data.toneFrequencyHz,
    durationMs: data.toneDurationMs,
    fadeMs: data.fadeMs,
    gain: data.gain,
  }),
  'flexible-tone': (sceneEl, data) => new FlexibleToneOutput(getAudio(sceneEl), {
    frequencyHz: data.toneFrequencyHz,
    fullScale: data.fullScale,
    fadeMs: data.fadeMs,
    gain: data.gain,
  }),
};

export type TurnCueSystem = System<TurnCueData> & {
  /** Called for every accepted turn sample, with its smoothed value. */
  onSignal(listener: (signal: TurnSignal) => void): Unsubscribe;
  /** Called for every detected cue, whether or not the output presented it. */
  onCue(listener: (cue: TurnCue) => void): Unsubscribe;
};

type TurnCueInternals = TurnCueSystem & {
  sceneEl: Scene;
  signalListeners: Set<(signal: TurnSignal) => void>;
  cueListeners: Set<(cue: TurnCue) => void>;
  output: TurnOutput | null;
  unsubscribeSource: Unsubscribe | null;
  teardown(): void;
};

/**
 * Turn cues: a turn-strength source feeds a `TurnDetector`, whose smoothed signal
 * and cues go to an output. Source and output are chosen by the schema; the
 * `condition` system sets that schema per experimental condition.
 */
AFRAME.registerSystem('turn-cues', {
  schema: {
    source: { type: 'string', default: 'optical-flow', oneOf: ['optical-flow', 'rig-angular-acceleration', 'none'] },
    output: { type: 'string', default: 'stereo-tone', oneOf: ['stereo-tone', 'flexible-tone', 'none'] },
    onThreshold: { type: 'number', default: 5 },
    offThreshold: { type: 'number', default: 2 },
    smoothingMs: { type: 'number', default: 250 },
    toneFrequencyHz: { type: 'number', default: 800 },
    toneDurationMs: { type: 'number', default: 1000 },
    fadeMs: { type: 'number', default: 15 },
    gain: { type: 'number', default: 0.3 },
    fullScale: { type: 'number', default: 20 },
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
      onThreshold: data.onThreshold,
      offThreshold: data.offThreshold,
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

      output?.signal(detection.signal);
      this.signalListeners.forEach((listener) => listener(detection.signal));

      if (detection.cue) {
        const cue: TurnCue = {
          sceneTimeMs: sample.sceneTimeMs,
          direction: detection.cue,
          strength: detection.signal.smoothed,
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
