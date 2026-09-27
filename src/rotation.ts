import type { Quaternion, Vector3 } from 'three';

/**
 * Rotation vector (axis × angle in radians) of `q`, in the frame `q` is
 * expressed in, taking the shorter of the two equivalent rotations.
 */
export function rotationVector(q: Quaternion, target: Vector3): Vector3 {
  const sign = q.w < 0 ? -1 : 1;
  const sinHalf = Math.hypot(q.x, q.y, q.z);
  const angleOverSinHalf = sinHalf < 1e-9 ? 2 : (2 * Math.atan2(sinHalf, sign * q.w)) / sinHalf;
  const scale = sign * angleOverSinHalf;
  return target.set(q.x * scale, q.y * scale, q.z * scale);
}

/** Quaternion of the rotation vector `v` (axis × angle in radians); inverse of `rotationVector`. */
export function fromRotationVector(v: Vector3, target: Quaternion): Quaternion {
  const angle = v.length();
  const sinHalfOverAngle = angle < 1e-9 ? 0.5 : Math.sin(angle / 2) / angle;
  return target.set(v.x * sinHalfOverAngle, v.y * sinHalfOverAngle, v.z * sinHalfOverAngle, Math.cos(angle / 2));
}
