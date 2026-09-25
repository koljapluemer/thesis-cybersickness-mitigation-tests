import type { Entity, Scene } from 'aframe';
import type { Camera, Object3D } from 'three';

/**
 * The rig is whatever the camera entity is mounted on. Head motion is the
 * camera's pose relative to it; everything else is rig motion.
 */
export function findRig(sceneEl: Scene): Object3D | null {
  const camera = sceneEl.camera as Camera & { el?: Entity };
  return camera?.el?.object3D.parent ?? null;
}
