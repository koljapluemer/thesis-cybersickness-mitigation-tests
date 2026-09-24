/**
 * Public types of the optical flow meter.
 *
 * Flow is measured geometrically: every surface point that is visible in a view
 * is reprojected into the previous frame's view, and the angle between the two
 * viewing directions is its angular velocity in the eye's frame of reference
 * (i.e. assuming the eye is fixed in the head). Pixels that show no geometry
 * (plain, textureless background) carry no visible motion and count as 0 °/s.
 */

export type Eye = 'mono' | 'left' | 'right';

export type FlowMagnitude = {
  /** Solid-angle weighted mean over the whole view, in degrees per second. */
  meanDegPerSec: number;
  /** Maximum over all covered pixels, in degrees per second. */
  maxDegPerSec: number;
};

export type EccentricityBand = {
  /** Band limits in degrees from the view's forward axis. */
  minEccentricityDeg: number;
  maxEccentricityDeg: number;
  /** Solid-angle weighted mean within the band, in degrees per second. */
  totalMeanDegPerSec: number;
  rigInducedMeanDegPerSec: number;
};

export type FlowMeasurement = {
  /** Solid-angle weighted fraction of the view that shows geometry. */
  coverage: number;
  /** All flow on the display: scripted rig motion plus the user's own head motion. */
  total: FlowMagnitude;
  /**
   * Flow caused by the scripted rig motion alone, with the head pose relative to
   * the rig held fixed. This is the part not matched by vestibular input.
   */
  rigInduced: FlowMagnitude;
  bands: EccentricityBand[];
};

/**
 * Raw per-pixel flow field of one view, row-major, bottom row first (WebGL order).
 * Four floats per pixel:
 *   0, 1: total flow in normalized device coordinates per second (x right, y up)
 *   2:    total angular speed in degrees per second
 *   3:    rig-induced angular speed in degrees per second
 * Pixels without geometry are (0, 0, -1, -1).
 */
export type FlowField = {
  width: number;
  height: number;
  data: Float32Array;
};

export type ViewFlow = FlowMeasurement & {
  eye: Eye;
  field: FlowField;
};

export type FlowSample = {
  /** Frame number, matches `FlowFrame.frame`. */
  frame: number;
  /** Scene time of the measured frame, in milliseconds. */
  sceneTimeMs: number;
  /** Frame interval the flow was measured over, in milliseconds. */
  deltaMs: number;
  /** Mean over all views (both eyes in VR). */
  combined: FlowMeasurement;
  views: ViewFlow[];
};

export type ViewPose = {
  eye: Eye;
  /** Eye camera world matrix, column-major. */
  matrixWorld: number[];
  /** Eye projection matrix, column-major. */
  projectionMatrix: number[];
  /** Size of the flow field rendered for this view. */
  fieldWidth: number;
  fieldHeight: number;
};

/** Poses of one measured frame, reported synchronously right after rendering. */
export type FlowFrame = {
  frame: number;
  sceneTimeMs: number;
  deltaMs: number;
  xrPresenting: boolean;
  /** World matrix of the rig (vehicle) the camera is mounted on, column-major. */
  rigMatrixWorld: number[];
  views: ViewPose[];
};

export type Unsubscribe = () => void;
