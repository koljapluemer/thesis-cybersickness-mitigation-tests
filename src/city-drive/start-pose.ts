/**
 * Where every run starts, in **Blender** coordinates of the city
 * (`thesis-cybersickness-staircase/blender/city_scene.blend`, metres, Z up):
 * the car's ground point and a second ground point it drives towards. Read
 * both off the 3D cursor in Blender (N panel → View → 3D Cursor). The road
 * ahead must be clear for ½·a·t² (see `CITY_DRIVE` in `scenes/city-drive.ts`).
 *
 * PLACEHOLDER: the origin facing +Y until the real start is chosen.
 */
export const START_POSE_BLENDER = {
  position: [-70, 0, 0],
  toward: [0, 1],
} as const satisfies { position: readonly [number, number, number]; toward: readonly [number, number] };

/** `straight-drive`'s `start` and `headingDeg`; glTF export maps Blender (x, y, z) to A-Frame (x, z, −y). */
export function startPose(): { start: string; headingDeg: number } {
  const [x, y, z] = START_POSE_BLENDER.position;
  const [towardX, towardY] = START_POSE_BLENDER.toward;
  const dx = towardX - x;
  const dz = -(towardY - y);

  if (dx === 0 && dz === 0) {
    throw new Error('START_POSE_BLENDER.toward must differ from its position.');
  }

  return {
    start: `${x} ${z} ${-y}`,
    headingDeg: AFRAME.THREE.MathUtils.radToDeg(Math.atan2(-dx, -dz)),
  };
}
