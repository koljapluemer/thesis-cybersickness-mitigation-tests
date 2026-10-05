export type Vec3 = [number, number, number];

/**
 * Closed minimum-snap trajectory through waypoints: segment i runs from point
 * i to point i + 1 (the last back to the first) in `durations[i]` seconds. Each
 * segment is a septic polynomial per axis in normalized time u = t / T ∈ [0, 1];
 * the snap-optimal curve through fixed points with fixed durations is C6 at
 * every knot.
 */
export type MinSnapLoop = {
  points: Vec3[];
  /** Segment durations, s. */
  durations: number[];
  /** Start time of each segment, s. */
  starts: number[];
  /** Loop period: sum of the durations, s. */
  period: number;
  /** `coefficients[segment][axis][power]`, in normalized time. */
  coefficients: number[][][];
};

export type LoopSample = { position: Vec3; velocity: Vec3; acceleration: Vec3 };

export type FlightLimits = {
  /** Speed for the initial time allocation, m/s. */
  cruiseSpeed: number;
  maxSpeed: number;
  /** Peak acceleration (horizontal and vertical, gravity excluded), m/s². */
  maxAcceleration: number;
};

const DEGREE = 7;
const COEFFICIENTS = DEGREE + 1;
/** Highest derivative continuous at the knots. */
const CONTINUITY = 6;
const MIN_SEGMENT_M = 0.01;
const SAMPLES_PER_SEGMENT = 64;

function factorialRatio(power: number, order: number): number {
  let value = 1;

  for (let k = 0; k < order; k += 1) {
    value *= power - k;
  }

  return value;
}

/** Solves `matrix · x = rhs` for each column of `rhs` in place; Gaussian elimination with partial pivoting. */
function solveLinear(matrix: Float64Array, rhs: Float64Array[], size: number): void {
  for (let col = 0; col < size; col += 1) {
    let pivot = col;

    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(matrix[row * size + col]) > Math.abs(matrix[pivot * size + col])) {
        pivot = row;
      }
    }

    if (Math.abs(matrix[pivot * size + col]) < 1e-12) {
      throw new Error('Minimum-snap system is singular.');
    }

    if (pivot !== col) {
      for (let k = 0; k < size; k += 1) {
        const tmp = matrix[col * size + k];
        matrix[col * size + k] = matrix[pivot * size + k];
        matrix[pivot * size + k] = tmp;
      }

      for (const b of rhs) {
        const tmp = b[col];
        b[col] = b[pivot];
        b[pivot] = tmp;
      }
    }

    for (let row = col + 1; row < size; row += 1) {
      const factor = matrix[row * size + col] / matrix[col * size + col];

      if (factor === 0) {
        continue;
      }

      for (let k = col; k < size; k += 1) {
        matrix[row * size + k] -= factor * matrix[col * size + k];
      }

      for (const b of rhs) {
        b[row] -= factor * b[col];
      }
    }
  }

  for (let row = size - 1; row >= 0; row -= 1) {
    for (const b of rhs) {
      let sum = b[row];

      for (let k = row + 1; k < size; k += 1) {
        sum -= matrix[row * size + k] * b[k];
      }

      b[row] = sum / matrix[row * size + row];
    }
  }
}

export function solveMinSnapLoop(points: Vec3[], durations: number[]): MinSnapLoop {
  const count = points.length;

  if (count < 3 || durations.length !== count) {
    throw new Error('A minimum-snap loop needs at least 3 points and one duration per segment.');
  }

  const size = count * COEFFICIENTS;
  const matrix = new Float64Array(size * size);
  const rhs = [0, 1, 2].map(() => new Float64Array(size));
  let row = 0;

  for (let i = 0; i < count; i += 1) {
    const next = (i + 1) % count;
    const base = i * COEFFICIENTS;
    const nextBase = next * COEFFICIENTS;

    // Starts at its point, ends at the next.
    matrix[row * size + base] = 1;
    rhs.forEach((b, axis) => (b[row] = points[i][axis]));
    row += 1;

    for (let power = 0; power < COEFFICIENTS; power += 1) {
      matrix[row * size + base + power] = 1;
    }

    rhs.forEach((b, axis) => (b[row] = points[next][axis]));
    row += 1;

    // d^k/dt^k continuous into the next segment, multiplied by T_i^k: x_i^(k)(1) = (T_i / T_next)^k x_next^(k)(0).
    const ratio = durations[i] / durations[next];

    for (let order = 1; order <= CONTINUITY; order += 1) {
      for (let power = order; power < COEFFICIENTS; power += 1) {
        matrix[row * size + base + power] = factorialRatio(power, order);
      }

      matrix[row * size + nextBase + order] = -factorialRatio(order, order) * ratio ** order;
      row += 1;
    }
  }

  solveLinear(matrix, rhs, size);

  const starts: number[] = [];
  let period = 0;

  for (const duration of durations) {
    starts.push(period);
    period += duration;
  }

  return {
    points,
    durations,
    starts,
    period,
    coefficients: points.map((_, i) => rhs.map((b) => Array.from(b.subarray(i * COEFFICIENTS, (i + 1) * COEFFICIENTS)))),
  };
}

/** The same curve flown `factor` times slower: the normalized-time solution is unchanged by uniform time scaling. */
function scaleTime(loop: MinSnapLoop, factor: number): MinSnapLoop {
  return {
    ...loop,
    durations: loop.durations.map((duration) => duration * factor),
    starts: loop.starts.map((start) => start * factor),
    period: loop.period * factor,
  };
}

/** Position, velocity and acceleration at time t (any value; wraps around the loop). */
export function sampleLoop(loop: MinSnapLoop, t: number): LoopSample {
  const time = ((t % loop.period) + loop.period) % loop.period;
  let segment = loop.starts.length - 1;

  while (segment > 0 && loop.starts[segment] > time) {
    segment -= 1;
  }

  const duration = loop.durations[segment];
  const u = Math.min(1, (time - loop.starts[segment]) / duration);
  const sample: LoopSample = { position: [0, 0, 0], velocity: [0, 0, 0], acceleration: [0, 0, 0] };

  for (let axis = 0; axis < 3; axis += 1) {
    const c = loop.coefficients[segment][axis];
    let position = 0;
    let velocity = 0;
    let acceleration = 0;

    for (let power = DEGREE; power >= 0; power -= 1) {
      position = position * u + c[power];

      if (power >= 1) {
        velocity = velocity * u + power * c[power];
      }

      if (power >= 2) {
        acceleration = acceleration * u + power * (power - 1) * c[power];
      }
    }

    sample.position[axis] = position;
    sample.velocity[axis] = velocity / duration;
    sample.acceleration[axis] = acceleration / (duration * duration);
  }

  return sample;
}

/** Calls `visit` on `SAMPLES_PER_SEGMENT` evenly spaced samples of every segment. */
export function forEachSample(loop: MinSnapLoop, visit: (sample: LoopSample, segment: number, t: number) => void): void {
  loop.durations.forEach((duration, segment) => {
    for (let k = 0; k < SAMPLES_PER_SEGMENT; k += 1) {
      const t = loop.starts[segment] + (duration * k) / SAMPLES_PER_SEGMENT;
      visit(sampleLoop(loop, t), segment, t);
    }
  });
}

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

/**
 * Plans the loop: segment durations proportional to length at `cruiseSpeed`,
 * then all slowed uniformly until peak speed and acceleration are within limits.
 */
export function planLoop(points: Vec3[], limits: FlightLimits): MinSnapLoop {
  const durations = points.map((point, i) => {
    const next = points[(i + 1) % points.length];
    const length = norm([next[0] - point[0], next[1] - point[1], next[2] - point[2]]);

    if (length < MIN_SEGMENT_M) {
      throw new Error(`Waypoints ${i} and ${(i + 1) % points.length} coincide.`);
    }

    return length / limits.cruiseSpeed;
  });

  const loop = solveMinSnapLoop(points, durations);
  let peakSpeed = 0;
  let peakAcceleration = 0;

  forEachSample(loop, ({ velocity, acceleration }) => {
    peakSpeed = Math.max(peakSpeed, norm(velocity));
    peakAcceleration = Math.max(peakAcceleration, norm(acceleration));
  });

  return scaleTime(loop, Math.max(1, peakSpeed / limits.maxSpeed, Math.sqrt(peakAcceleration / limits.maxAcceleration)));
}
