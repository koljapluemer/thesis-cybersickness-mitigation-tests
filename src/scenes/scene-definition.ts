import type { Entity, Scene } from 'aframe';

/** Static description of the scene, needed to reproduce the rendered views offline. */
export type SceneDescription = {
  /** Scene id, see `SCENES`. */
  id: string;
  /** Models fixed in the world: glTF path (under `public/`) and world matrix of the glTF root, column-major. */
  staticModels: { src: string; matrixWorld: number[] }[];
  /** Models moving with the rig (`rig-fixed`): glTF path and matrix of the glTF root relative to the rig, column-major. */
  rigFixedModels: { src: string; matrixRig: number[] }[];
  /** The component moving the rig and its configuration. */
  motion: { component: string; config: Record<string, unknown> };
};

/** What the session recorder needs from a scene. */
export type SceneRecording<FrameState> = {
  /** Called when a recording starts. */
  describe(): SceneDescription;
  /** Called every recorded frame; logged as the frame's `sceneState`. */
  frameState(): FrameState;
};

/**
 * One test scene. It is chosen once per page load (see `url-selection.ts`),
 * so a scene never needs to tear down or reset anything for another.
 */
export type SceneDefinition<Id extends string, FrameState> = {
  id: Id;
  /** Shown in the scene select. */
  label: string;
  /**
   * WebXR reference space. With `local`, the headset's origin is the head pose
   * at session start, so the camera starts at the rig origin (a seated eye).
   */
  referenceSpaceType: 'local' | 'local-floor';
  /** `<a-assets>`, the world and the rig (built with `rigMarkup`), placed inside `<a-scene>`. */
  markup(): string;
  /** Called once the scene has loaded. */
  recording(sceneEl: Scene): SceneRecording<FrameState>;
};

export function queryEntity(sceneEl: Scene, selector: string): Entity {
  const el = sceneEl.querySelector<Entity>(selector);

  if (!el) {
    throw new Error(`Scene markup has no ${selector}.`);
  }

  return el;
}

export function worldModel(el: Entity, src: string): SceneDescription['staticModels'][number] {
  el.object3D.updateWorldMatrix(true, false);
  return { src, matrixWorld: el.object3D.matrixWorld.toArray() };
}

export function rigModel(el: Entity, rigEl: Entity, src: string): SceneDescription['rigFixedModels'][number] {
  el.object3D.updateWorldMatrix(true, false);
  rigEl.object3D.updateWorldMatrix(true, false);
  const matrixRig = rigEl.object3D.matrixWorld.clone().invert().multiply(el.object3D.matrixWorld);
  return { src, matrixRig: matrixRig.toArray() };
}
