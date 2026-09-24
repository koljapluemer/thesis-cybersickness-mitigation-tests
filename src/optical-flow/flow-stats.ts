import 'aframe';
import type { Matrix4 } from 'three';
import type { EccentricityBand, FlowField, FlowMeasurement } from './types';

const THREE = AFRAME.THREE;

/** Eccentricity band limits in degrees; the last band is open-ended. */
export const ECCENTRICITY_BANDS_DEG = [0, 10, 30, 180] as const;

/**
 * Per-pixel geometry of one view's flow field: which eccentricity band a pixel
 * belongs to and which solid angle it subtends (relative; cos³ of its angle to
 * the optical axis, exact for a planar perspective projection).
 */
export type ViewGeometry = {
  width: number;
  height: number;
  projection: number[];
  band: Uint8Array;
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
    weight,
    totalWeight,
    bandWeight,
  };
}

export function measureField(field: FlowField, geometry: ViewGeometry): FlowMeasurement {
  const { data } = field;
  const bandTotal = new Float64Array(geometry.bandWeight.length);
  const bandRig = new Float64Array(geometry.bandWeight.length);
  let coveredWeight = 0;
  let sumTotal = 0;
  let sumRig = 0;
  let maxTotal = 0;
  let maxRig = 0;

  for (let pixel = 0; pixel < geometry.weight.length; pixel += 1) {
    const total = data[pixel * 4 + 2];

    if (total < 0) {
      continue;
    }

    const rig = data[pixel * 4 + 3];
    const weight = geometry.weight[pixel];
    const band = geometry.band[pixel];

    coveredWeight += weight;
    sumTotal += weight * total;
    sumRig += weight * rig;
    bandTotal[band] += weight * total;
    bandRig[band] += weight * rig;
    maxTotal = Math.max(maxTotal, total);
    maxRig = Math.max(maxRig, rig);
  }

  const bands: EccentricityBand[] = [];

  for (let band = 0; band < geometry.bandWeight.length; band += 1) {
    const bandWeight = geometry.bandWeight[band];
    bands.push({
      minEccentricityDeg: ECCENTRICITY_BANDS_DEG[band],
      maxEccentricityDeg: ECCENTRICITY_BANDS_DEG[band + 1],
      totalMeanDegPerSec: bandWeight > 0 ? bandTotal[band] / bandWeight : 0,
      rigInducedMeanDegPerSec: bandWeight > 0 ? bandRig[band] / bandWeight : 0,
    });
  }

  return {
    coverage: coveredWeight / geometry.totalWeight,
    total: { meanDegPerSec: sumTotal / geometry.totalWeight, maxDegPerSec: maxTotal },
    rigInduced: { meanDegPerSec: sumRig / geometry.totalWeight, maxDegPerSec: maxRig },
    bands,
  };
}

export function combineMeasurements(measurements: FlowMeasurement[]): FlowMeasurement {
  const count = measurements.length;
  const mean = (pick: (measurement: FlowMeasurement) => number) =>
    measurements.reduce((sum, measurement) => sum + pick(measurement), 0) / count;
  const max = (pick: (measurement: FlowMeasurement) => number) =>
    Math.max(...measurements.map(pick));

  return {
    coverage: mean((measurement) => measurement.coverage),
    total: {
      meanDegPerSec: mean((measurement) => measurement.total.meanDegPerSec),
      maxDegPerSec: max((measurement) => measurement.total.maxDegPerSec),
    },
    rigInduced: {
      meanDegPerSec: mean((measurement) => measurement.rigInduced.meanDegPerSec),
      maxDegPerSec: max((measurement) => measurement.rigInduced.maxDegPerSec),
    },
    bands: measurements[0].bands.map((band, index) => ({
      minEccentricityDeg: band.minEccentricityDeg,
      maxEccentricityDeg: band.maxEccentricityDeg,
      totalMeanDegPerSec: mean((measurement) => measurement.bands[index].totalMeanDegPerSec),
      rigInducedMeanDegPerSec: mean((measurement) => measurement.bands[index].rigInducedMeanDegPerSec),
    })),
  };
}
