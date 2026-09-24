import type { TurnDirection, TurnSample, TurnSignal } from './types';

export type TurnDetectorOptions = {
  /** Cue when the smoothed turn rate rises above this, in degrees per second. */
  onThresholdDegPerSec: number;
  /** Re-arm once the smoothed turn rate falls below this, in degrees per second. */
  offThresholdDegPerSec: number;
  /** Time constant of the exponential smoothing, in milliseconds. */
  smoothingMs: number;
  /** Minimum time between two cues, in milliseconds. */
  refractoryMs: number;
};

export type TurnDetection = {
  signal: TurnSignal;
  /** Set when this sample triggers a cue. */
  cue: TurnDirection | null;
};

/** Samples measured over longer intervals (stalls, tab switches) are not trusted. */
const MAX_SAMPLE_DELTA_MS = 100;
/** Window of the median filter that removes one- and two-frame spikes. */
const MEDIAN_WINDOW = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Turns a noisy turn-rate stream into discrete turn cues: median filter,
 * exponential smoothing, then a threshold with hysteresis and a refractory
 * period. A cue fires when the smoothed rate exceeds the on-threshold; the
 * detector re-arms when it drops below the off-threshold (which a change of
 * direction always passes through, the smoothed rate being continuous).
 */
export class TurnDetector {
  private readonly options: TurnDetectorOptions;
  private readonly window: number[] = [];
  private smoothed = 0;
  private armed = true;
  private lastCueTimeMs = -Infinity;

  constructor(options: TurnDetectorOptions) {
    this.options = options;
  }

  /** Returns null for samples that are dropped as untrustworthy. */
  push(sample: TurnSample): TurnDetection | null {
    if (sample.deltaMs <= 0 || sample.deltaMs > MAX_SAMPLE_DELTA_MS) {
      return null;
    }

    this.window.push(sample.turnDegPerSec);

    if (this.window.length > MEDIAN_WINDOW) {
      this.window.shift();
    }

    const alpha = 1 - Math.exp(-sample.deltaMs / this.options.smoothingMs);
    this.smoothed += alpha * (median(this.window) - this.smoothed);

    return { signal: { ...sample, smoothedDegPerSec: this.smoothed }, cue: this.detect(sample.sceneTimeMs) };
  }

  private detect(sceneTimeMs: number): TurnDirection | null {
    const { onThresholdDegPerSec, offThresholdDegPerSec, refractoryMs } = this.options;
    const magnitude = Math.abs(this.smoothed);

    if (magnitude < offThresholdDegPerSec) {
      this.armed = true;
    }

    if (!this.armed || magnitude < onThresholdDegPerSec || sceneTimeMs - this.lastCueTimeMs < refractoryMs) {
      return null;
    }

    this.armed = false;
    this.lastCueTimeMs = sceneTimeMs;

    return this.smoothed > 0 ? 'left' : 'right';
  }
}
