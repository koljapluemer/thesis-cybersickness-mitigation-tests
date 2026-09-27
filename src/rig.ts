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

/**
 * Emitted on the scene by whatever moves the rig when it jumps instead of
 * moving continuously (placing it on start, a reset). Pose history must not
 * span the jump: rig kinematics restart and the frame's flow is not measured.
 */
export const RIG_TELEPORT_EVENT = 'rig-teleport';

/** Call right after setting the rig's new pose, before this frame's `tock`. */
export function announceRigTeleport(sceneEl: Scene): void {
  sceneEl.emit(RIG_TELEPORT_EVENT);
}

/** Tracks teleports for a system that reads the rig in `tock`. */
export class RigTeleportFlag {
  private teleported = false;
  private readonly listener = () => {
    this.teleported = true;
  };

  constructor(sceneEl: Scene) {
    sceneEl.addEventListener(RIG_TELEPORT_EVENT, this.listener);
  }

  /** Whether the rig teleported since the last call. */
  consume(): boolean {
    const teleported = this.teleported;
    this.teleported = false;
    return teleported;
  }
}
