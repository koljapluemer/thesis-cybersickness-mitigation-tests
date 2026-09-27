import type { ConditionSystem } from '../conditions/condition-system';
import type { ConditionId } from '../conditions/conditions';
import type { InertialSoundData, InertialSoundSample, InertialSoundSystem } from '../inertial-sound/inertial-sound-system';
import { REV_WITH_LAG } from '../inertial-sound/motor-sound';
import type { TurnCueData, TurnCueSystem } from '../turn-cues/turn-cue-system';
import type { TurnCue, TurnSignal } from '../turn-cues/types';
import { ECCENTRICITY_BANDS_DEG } from './flow-stats';
import type { OpticalFlowSystem } from './optical-flow-system';
import type { Eye, FlowComponent, FlowField, FlowFrame, FlowMeasurement, FlowSample, Unsubscribe, ViewPose } from './types';

/** Static description of the scene, needed to reproduce the rendered views offline. */
export type SceneDescription = {
  landscape: {
    src: string;
    /** World matrix of the glTF root, column-major. */
    matrixWorld: number[];
  };
  tour: Record<string, unknown>;
};

export type LoggedFields = {
  eye: Eye;
  width: number;
  height: number;
} & Record<FlowComponent, string>; // base64 of little-endian float32 data, layout as in `FlowField`

export type LoggedFrame = {
  frame: number;
  /** Milliseconds since recording start (wall clock). */
  timeMs: number;
  sceneTimeMs: number;
  deltaMs: number;
  /** Position on the tour path in seconds. */
  pathTimeSec: number;
  xrPresenting: boolean;
  rigMatrixWorld: number[];
  views: ViewPose[];
  /** Null for frames that could not be measured (first frame, view layout change). */
  flow: {
    combined: FlowMeasurement;
    views: (FlowMeasurement & { eye: Eye })[];
  } | null;
  fields?: LoggedFields[];
};

export type LoggedEvent =
  | { timeMs: number; type: 'enter-vr' | 'exit-vr' }
  | ({ timeMs: number; type: 'turn-cue' } & TurnCue);

export type SessionLog = {
  format: 'optical-flow-session';
  version: 5;
  startedAt: string;
  endedAt: string;
  userAgent: string;
  flowMeter: {
    fieldHeight: number;
    eccentricityBandsDeg: readonly number[];
    fieldChannels: readonly string[];
    fieldSnapshotIntervalMs: number;
  };
  /** Experimental condition, fixed for the whole recording. */
  condition: ConditionId;
  /** Effective `turn-cues` configuration under that condition. */
  turnCues: TurnCueData;
  /** Effective `inertial-sound` configuration, plus the motor's `REV_WITH_LAG` build constant. */
  inertialSound: InertialSoundData & { revWithLag: boolean };
  scene: SceneDescription;
  events: LoggedEvent[];
  frames: LoggedFrame[];
  /** Every accepted turn-rate sample of the cue detector, raw and smoothed. */
  turnSignals: TurnSignal[];
  /** Every frame of the inertial sound; empty while it is disabled. */
  inertialSoundSamples: InertialSoundSample[];
};

export type RecorderOptions = {
  describeScene: () => SceneDescription;
  pathTimeSec: () => number;
  /** How often full flow fields are embedded in the log. */
  fieldSnapshotIntervalMs: number;
};

const FIELD_CHANNELS = ['ndcFlowX', 'ndcFlowY', 'angularDegPerSec', 'horizontalDegPerSec'] as const;
const XR_EVENTS = ['enter-vr', 'exit-vr'] as const;

function encodeField(field: FlowField): string {
  const bytes = new Uint8Array(field.data.buffer, field.data.byteOffset, field.data.byteLength);
  const chunks: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }

  return btoa(chunks.join(''));
}

/**
 * Records every rendered frame's poses and flow measurements while running.
 * The log is complete enough to re-render and re-measure the session offline.
 * The experimental condition is locked while recording, so a log has exactly one.
 */
export class FlowSessionRecorder {
  private readonly sceneEl: Element;
  private readonly meter: OpticalFlowSystem;
  private readonly turnCues: TurnCueSystem;
  private readonly inertialSound: InertialSoundSystem;
  private readonly conditions: ConditionSystem;
  private readonly options: RecorderOptions;
  private log: SessionLog | null = null;
  private startTime = 0;
  private lastSnapshotSceneTimeMs = -Infinity;
  private readonly framesByNumber = new Map<number, LoggedFrame>();
  private unsubscribers: Unsubscribe[] = [];

  constructor(
    sceneEl: Element,
    meter: OpticalFlowSystem,
    turnCues: TurnCueSystem,
    inertialSound: InertialSoundSystem,
    conditions: ConditionSystem,
    options: RecorderOptions,
  ) {
    this.sceneEl = sceneEl;
    this.meter = meter;
    this.turnCues = turnCues;
    this.inertialSound = inertialSound;
    this.conditions = conditions;
    this.options = options;
  }

  get recording(): boolean {
    return this.log !== null;
  }

  get frameCount(): number {
    return this.log?.frames.length ?? 0;
  }

  start(): void {
    if (this.log) {
      throw new Error('Recording already running.');
    }

    this.startTime = performance.now();
    this.lastSnapshotSceneTimeMs = -Infinity;
    this.framesByNumber.clear();
    this.log = {
      format: 'optical-flow-session',
      version: 5,
      startedAt: new Date().toISOString(),
      endedAt: '',
      userAgent: navigator.userAgent,
      flowMeter: {
        fieldHeight: this.meter.data.fieldHeight,
        eccentricityBandsDeg: ECCENTRICITY_BANDS_DEG,
        fieldChannels: FIELD_CHANNELS,
        fieldSnapshotIntervalMs: this.options.fieldSnapshotIntervalMs,
      },
      condition: this.conditions.state.id,
      turnCues: { ...this.turnCues.data },
      inertialSound: { ...this.inertialSound.data, revWithLag: REV_WITH_LAG },
      scene: this.options.describeScene(),
      events: [],
      frames: [],
      turnSignals: [],
      inertialSoundSamples: [],
    };

    const onXrEvent = (event: Event) => this.log?.events.push({ timeMs: this.elapsedMs(), type: event.type as 'enter-vr' | 'exit-vr' });
    XR_EVENTS.forEach((type) => this.sceneEl.addEventListener(type, onXrEvent));

    this.unsubscribers = [
      this.meter.onFrame((frame) => this.recordFrame(frame)),
      this.conditions.lock(),
      this.meter.onSample((sample) => this.recordSample(sample)),
      this.turnCues.onSignal((signal) => this.log?.turnSignals.push(signal)),
      this.inertialSound.onSample((sample) => this.log?.inertialSoundSamples.push(sample)),
      this.turnCues.onCue((cue) => this.log?.events.push({ timeMs: this.elapsedMs(), type: 'turn-cue', ...cue })),
      () => XR_EVENTS.forEach((type) => this.sceneEl.removeEventListener(type, onXrEvent)),
    ];
  }

  /** Stops recording once all in-flight measurements have arrived and returns the log. */
  async stop(): Promise<SessionLog> {
    const log = this.log;

    if (!log) {
      throw new Error('No recording running.');
    }

    this.unsubscribers[0]();
    await this.meter.flush();
    this.unsubscribers.slice(1).forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.framesByNumber.clear();
    this.log = null;
    log.endedAt = new Date().toISOString();

    return log;
  }

  private elapsedMs(): number {
    return performance.now() - this.startTime;
  }

  private recordFrame(frame: FlowFrame): void {
    const logged: LoggedFrame = {
      frame: frame.frame,
      timeMs: this.elapsedMs(),
      sceneTimeMs: frame.sceneTimeMs,
      deltaMs: frame.deltaMs,
      pathTimeSec: this.options.pathTimeSec(),
      xrPresenting: frame.xrPresenting,
      rigMatrixWorld: frame.rigMatrixWorld,
      views: frame.views,
      flow: null,
    };

    this.log?.frames.push(logged);

    if (frame.views.some((view) => view.fieldWidth > 0)) {
      this.framesByNumber.set(frame.frame, logged);
    }
  }

  private recordSample(sample: FlowSample): void {
    const logged = this.framesByNumber.get(sample.frame);

    if (!logged) {
      return;
    }

    this.framesByNumber.delete(sample.frame);
    logged.flow = {
      combined: sample.combined,
      views: sample.views.map((view) => ({
        eye: view.eye,
        coverage: view.coverage,
        total: view.total,
        rigInduced: view.rigInduced,
      })),
    };

    if (sample.sceneTimeMs - this.lastSnapshotSceneTimeMs >= this.options.fieldSnapshotIntervalMs) {
      this.lastSnapshotSceneTimeMs = sample.sceneTimeMs;
      logged.fields = sample.views.map((view) => ({
        eye: view.eye,
        width: view.fields.total.width,
        height: view.fields.total.height,
        total: encodeField(view.fields.total),
        rigInduced: encodeField(view.fields.rigInduced),
      }));
    }
  }
}

export function downloadJson(value: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
