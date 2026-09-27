import type { Entity, Scene } from 'aframe';
import type { Camera, Matrix4, Object3D } from 'three';

/**
 * The rig is whatever the camera entity is mounted on. Head motion is the
 * camera's pose relative to it; everything else is rig motion.
 */
export function findRig(sceneEl: Scene): Object3D | null {
  const camera = sceneEl.camera as Camera & { el?: Entity };
  return camera?.el?.object3D.parent ?? null;
}

/**
 * World matrix of the head (the centre view): the XR camera while presenting,
 * otherwise the scene camera. Current for this frame from `tock` on, since
 * A-Frame runs `tock` after rendering.
 */
export function headMatrixWorld(sceneEl: Scene): Matrix4 {
  const renderer = sceneEl.renderer;
  return renderer.xr.isPresenting ? renderer.xr.getCamera().matrixWorld : sceneEl.camera.matrixWorld;
}
