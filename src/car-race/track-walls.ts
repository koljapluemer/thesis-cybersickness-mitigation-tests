/** A point on the ground plane: A-Frame `[x, z]` in metres. */
export type GroundPoint = [number, number];

export type WallContact = {
  /** Unit vector from the wall towards the circle's centre, `[x, z]`. */
  normal: GroundPoint;
  /** How far the circle reaches into the wall, in metres. */
  depth: number;
};

type Segment = { ax: number; az: number; dx: number; dz: number; lengthSq: number };

/** The track's walls as line segments on the ground plane (from closed polylines in `track.json`). */
export class TrackWalls {
  private readonly segments: Segment[];

  constructor(loops: GroundPoint[][]) {
    this.segments = loops.flatMap((loop) => loop.map((a, index) => {
      const b = loop[(index + 1) % loop.length];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      return { ax: a[0], az: a[1], dx, dz, lengthSq: dx * dx + dz * dz };
    })).filter((segment) => segment.lengthSq > 0);
  }

  /** Deepest contact of a circle with the walls, or null if it touches none. */
  deepestContact(x: number, z: number, radius: number): WallContact | null {
    let deepest: WallContact | null = null;

    for (const { ax, az, dx, dz, lengthSq } of this.segments) {
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq));
      const offsetX = x - (ax + t * dx);
      const offsetZ = z - (az + t * dz);
      const distance = Math.hypot(offsetX, offsetZ);
      const depth = radius - distance;

      if (depth > 0 && distance > 0 && (!deepest || depth > deepest.depth)) {
        deepest = { normal: [offsetX / distance, offsetZ / distance], depth };
      }
    }

    return deepest;
  }
}
