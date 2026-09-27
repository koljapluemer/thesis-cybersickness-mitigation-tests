import 'aframe';
import type { Entity, Scene } from 'aframe';
import type { Camera } from 'three';

/**
 * Render layer of geometry that moves with the rig (e.g. a car body around the
 * seat). The optical flow meter renders it in its own pass, since it is not
 * static in the world. three.js reserves layers 1 and 2 for the XR eyes.
 */
export const RIG_FIXED_LAYER = 5;

type RigFixedInternals = {
  el: Entity;
  apply: () => void;
  enableOnCamera: (event: Event) => void;
};

/**
 * Marks the entity's geometry as rigidly attached to the rig. The entity must
 * not move relative to the rig. Puts its whole subtree (also models loaded
 * later) on `RIG_FIXED_LAYER` and makes the active camera render that layer;
 * XR eye cameras copy the camera's layers.
 */
AFRAME.registerComponent('rig-fixed', {
  init(this: RigFixedInternals) {
    const sceneEl = this.el.sceneEl as Scene;
    this.apply = () => this.el.object3D.traverse((object) => object.layers.set(RIG_FIXED_LAYER));
    this.enableOnCamera = (event: Event) => {
      const cameraEl = (event as CustomEvent<{ cameraEl: Entity }>).detail.cameraEl;
      (cameraEl.getObject3D('camera') as Camera).layers.enable(RIG_FIXED_LAYER);
    };

    this.apply();
    this.el.addEventListener('object3dset', this.apply);
    this.el.addEventListener('model-loaded', this.apply);
    sceneEl.camera?.layers.enable(RIG_FIXED_LAYER);
    sceneEl.addEventListener('camera-set-active', this.enableOnCamera);
  },

  remove(this: RigFixedInternals) {
    this.el.removeEventListener('object3dset', this.apply);
    this.el.removeEventListener('model-loaded', this.apply);
    this.el.sceneEl?.removeEventListener('camera-set-active', this.enableOnCamera);
  },
});
