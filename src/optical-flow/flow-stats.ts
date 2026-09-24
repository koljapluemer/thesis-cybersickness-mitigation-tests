import 'aframe';
import type { Matrix4 } from 'three';
import type { FlowComponent, FlowComponentStats, FlowField, FlowMeasurement } from './types';

const THREE = AFRAME.THREE;

/** Eccentricity band limits in degrees; the last band is open-ended. */
export const ECCENTRICITY_BANDS_DEG = [0, 10, 30, 180] as const;

/**
 * Per-pixel geometry of one view's flow field: which eccentricity band a pixel
 * belongs to, which half of the view it is in (eye-space x < 0 or not, correct
 * for asymmetric frusta) and which solid angle it subtends (relative; cos³ of
 * its angle to the optical axis, exact for a planar perspective projection).
 */
export type ViewGeometry = {
  width: number;
  height: number;
  projection: number[];
  band: Uint8Array;
  /** 1 for pixels in the right half of the view, 0 for the left half. */
  right: Uint8Array;
  weight: Float32Array;
  totalWeight: number;
  bandWeight: Float64Array;
};

export function viewGeometryMatches(geometry: ViewGeometry | undefined, width: number, height: number, projection: Matrix4): geometry is ViewGeometry {
  return geometry !== undefined
    && geometry.width === width
    && geometry.height === height
    && geometry.projection.every((value, index) => value === projection.elements[index]);
}

export function createViewGeometry(width: number, height: number, projection: Matrix4): ViewGeometry {
  const inverse = projection.clone().invert();
  const point = new THREE.Vector3();
  const pixelCount = width * height;
  const band = new Uint8Array(pixelCount);
  const right = new Uint8Array(pixelCount);
  const weight = new Float32Array(pixelCount);
  const bandWeight = new Float64Array(ECCENTRICITY_BANDS_DEG.length - 1);
  let totalWeight = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixel = y * width + x;
      point.set(((x + 0.5) / width) * 2 - 1, ((y + 0.5) / height) * 2 - 1, -1).applyMatrix4(inverse).normalize();
      const cosine = -point.z;
      const eccentricityDeg = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(cosine, -1, 1)));
      let bandIndex = 0;

      while (bandIndex < bandWeight.length - 1 && eccentricityDeg >= ECCENTRICITY_BANDS_DEG[bandIndex + 1]) {
        bandIndex += 1;
      }

      band[pixel] = bandIndex;
      right[pixel] = point.x >= 0 ? 1 : 0;
      weight[pixel] = cosine ** 3;
      bandWeight[bandIndex] += weight[pixel];
      totalWeight += weight[pixel];
    }
  }

  return {
    width,
    height,
    projection: [...projection.elements],
    band,
    right,
    weight,
    totalWeight,
    bandWeight,
  };
}

/** Running sums of one flow component over a view. */
class ComponentAccumulator {
  sum = 0;
  max = 0;
  readonly bandSums: Float64Array;
  readonly sideSums = new Float64Array(2);

  constructor(bandCount: number) {
    this.bandSums = new Float64Array(bandCount);
  }

  add(data: Float32Array, pixel: number, weight: number, band: number, side: number): void {
    const speed = data[pixel * 4 + 2];
    this.sum += weight * speed;
    this.max = Math.max(this.max, speed);
    this.bandSums[band] += weight * speed;
    this.sideSums[side] += weight * data[pixel * 4 + 3];
  }

  stats(geometry: ViewGeometry, sideCoveredWeight: Float64Array): FlowComponentStats {
    const sideMean = (side: number) => sideCoveredWeight[side] > 0 ? this.sideSums[side] / sideCoveredWeight[side] : 0;

    return {
      meanDegPerSec: this.sum / geometry.totalWeight,
      maxDegPerSec: this.max,
      bands: Array.from(geometry.bandWeight, (bandWeight, band) => ({
        minEccentricityDeg: ECCENTRICITY_BANDS_DEG[band],
        maxEccentricityDeg: ECCENTRICITY_BANDS_DEG[band + 1],
        meanDegPerSec: bandWeight > 0 ? this.bandSums[band] / bandWeight : 0,
      })),
      horizontal: { leftMeanDegPerSec: sideMean(0), rightMeanDegPerSec: sideMean(1) },
    };
  }
}

export function measureFields(fields: Record<FlowComponent, FlowField>, geometry: ViewGeometry): FlowMeasurement {
  const bandCount = geometry.bandWeight.length;
  const total = new ComponentAccumulator(bandCount);
  const rigInduced = new ComponentAccumulator(bandCount);
  const sideCoveredWeight = new Float64Array(2);
  let coveredWeight = 0;

  for (let pixel = 0; pixel < geometry.weight.length; pixel += 1) {
    // Both components cover the same pixels.
    if (fields.total.data[pixel * 4 + 2] < 0) {
      continue;
    }

    const weight = geometry.weight[pixel];
    const band = geometry.band[pixel];
    const side = geometry.right[pixel];

    coveredWeight += weight;
    sideCoveredWeight[side] += weight;
    total.add(fields.total.data, pixel, weight, band, side);
    rigInduced.add(fields.rigInduced.data, pixel, weight, band, side);
  }

  return {
    coverage: coveredWeight / geometry.totalWeight,
    total: total.stats(geometry, sideCoveredWeight),
    rigInduced: rigInduced.stats(geometry, sideCoveredWeight),
  };
}

function combineComponents(components: FlowComponentStats[]): FlowComponentStats {
  const mean = (pick: (component: FlowComponentStats) => number) =>
    components.reduce((sum, component) => sum + pick(component), 0) / components.length;

  return {
    meanDegPerSec: mean((component) => component.meanDegPerSec),
    maxDegPerSec: Math.max(...components.map((component) => component.maxDegPerSec)),
    bands: components[0].bands.map((band, index) => ({
      minEccentricityDeg: band.minEccentricityDeg,
      maxEccentricityDeg: band.maxEccentricityDeg,
      meanDegPerSec: mean((component) => component.bands[index].meanDegPerSec),
    })),
    horizontal: {
      leftMeanDegPerSec: mean((component) => component.horizontal.leftMeanDegPerSec),
      rightMeanDegPerSec: mean((component) => component.horizontal.rightMeanDegPerSec),
    },
  };
}

/** Mean over views (both eyes in VR); maxima are the maximum over views. */
export function combineMeasurements(measurements: FlowMeasurement[]): FlowMeasurement {
  return {
    coverage: measurements.reduce((sum, measurement) => sum + measurement.coverage, 0) / measurements.length,
    total: combineComponents(measurements.map((measurement) => measurement.total)),
    rigInduced: combineComponents(measurements.map((measurement) => measurement.rigInduced)),
  };
}
