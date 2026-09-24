import 'aframe';
import type { Entity, Scene, System } from 'aframe';
import type { Camera, Matrix4, Object3D, PerspectiveCamera, WebGLRenderTarget } from 'three';
import { createFlowMaterial, type FlowMaterial } from './flow-material';
import { combineMeasurements, createViewGeometry, measureFields, viewGeometryMatches, type ViewGeometry } from './flow-stats';
import type { Eye, FlowComponent, FlowFrame, FlowSample, Unsubscribe, ViewFlow, ViewPose } from './types';

const THREE = AFRAME.THREE;

/** Clear value for pixels without geometry, see `FlowField`. */
const BACKGROUND = new Float32Array([0, 0, -1, 0]);

/** Color attachment of each flow component in the flow render target. */
const ATTACHMENTS: Record<FlowComponent, number> = { total: 0, rigInduced: 1 };

type OpticalFlowData = {
  enabled: boolean;
  /** Height of each view's flow field in pixels; width follows the view's aspect. */
  fieldHeight: number;
};

type ActiveView = {
  eye: Eye;
  camera: Camera;
};

type ViewSlot = {
  target: WebGLRenderTarget;
  geometry?: ViewGeometry;
  prevMatrixWorld: Matrix4;
};

export type OpticalFlowSystem = System<OpticalFlowData> & {
  /** Most recent completed measurement, or null before the first one. */
  latest: FlowSample | null;
  /** Called synchronously after every rendered frame with the poses used for measuring. */
  onFrame(listener: (frame: FlowFrame) => void): Unsubscribe;
  /** Called when a frame's flow measurement has been read back (a few ms after `onFrame`). */
  onSample(listener: (sample: FlowSample) => void): Unsubscribe;
  /** Resolves once all measurements in flight have been delivered. */
  flush(): Promise<void>;
};

type OpticalFlowInternals = OpticalFlowSystem & {
  sceneEl: Scene;
  material: FlowMaterial;
  flowCamera: PerspectiveCamera;
  slots: ViewSlot[];
  layoutKey: string;
  prevRigMatrixWorld: Matrix4;
  frame: number;
  frameListeners: Set<(frame: FlowFrame) => void>;
  sampleListeners: Set<(sample: FlowSample) => void>;
  pending: Set<Promise<void>>;
  scratch: {
    rig: Matrix4;
    inverseEye: Matrix4;
    rigPrevEye: Matrix4;
  };
  activeViews(): ActiveView[];
  rigObject(): Object3D | null;
  measureView(slot: ViewSlot, view: ActiveView, invDeltaSec: number): ViewPose;
  readSample(frame: FlowFrame, slots: ViewSlot[]): Promise<void>;
};

AFRAME.registerSystem('optical-flow', {
  schema: {
    enabled: { type: 'boolean', default: true },
    fieldHeight: { type: 'int', default: 64 },
  },

  init(this: OpticalFlowInternals) {
    this.latest = null;
    this.material = createFlowMaterial();
    this.flowCamera = new THREE.PerspectiveCamera();
    this.flowCamera.matrixAutoUpdate = false;
    this.flowCamera.matrixWorldAutoUpdate = false;
    this.slots = [];
    this.layoutKey = '';
    this.prevRigMatrixWorld = new THREE.Matrix4();
    this.frame = 0;
    this.frameListeners = new Set();
    this.sampleListeners = new Set();
    this.pending = new Set();
    this.scratch = {
      rig: new THREE.Matrix4(),
      inverseEye: new THREE.Matrix4(),
      rigPrevEye: new THREE.Matrix4(),
    };
  },

  onFrame(this: OpticalFlowInternals, listener: (frame: FlowFrame) => void): Unsubscribe {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  },

  onSample(this: OpticalFlowInternals, listener: (sample: FlowSample) => void): Unsubscribe {
    this.sampleListeners.add(listener);
    return () => this.sampleListeners.delete(listener);
  },

  async flush(this: OpticalFlowInternals): Promise<void> {
    await Promise.all([...this.pending]);
  },

  /**
   * The views actually shown this frame: both XR eye cameras while presenting,
   * otherwise the scene camera.
   */
  activeViews(this: OpticalFlowInternals): ActiveView[] {
    const renderer = this.sceneEl.renderer;

    if (renderer.xr.isPresenting) {
      const cameras = renderer.xr.getCamera().cameras;
      return cameras.map((camera, index) => ({
        eye: cameras.length === 2 ? (index === 0 ? 'left' : 'right') : 'mono',
        camera,
      }));
    }

    return [{ eye: 'mono', camera: this.sceneEl.camera }];
  },

  /**
   * The rig is whatever the camera entity is mounted on. Head motion is the
   * camera's pose relative to it; everything else is rig motion.
   */
  rigObject(this: OpticalFlowInternals): Object3D | null {
    const camera = this.sceneEl.camera as Camera & { el?: Entity };
    return camera?.el?.object3D.parent ?? null;
  },

  tock(this: OpticalFlowInternals, time: number, timeDelta: number) {
    const rig = this.rigObject();

    if (!this.data.enabled || !rig) {
      return;
    }

    const views = this.activeViews();
    const layoutKey = `${this.sceneEl.renderer.xr.isPresenting}:${views.map((view) => view.eye).join(',')}`;
    const layoutChanged = layoutKey !== this.layoutKey;
    const rigMatrixWorld = this.scratch.rig.copy(rig.matrixWorld);

    if (layoutChanged) {
      this.layoutKey = layoutKey;
      this.slots.forEach((slot) => slot.target.dispose());
      this.slots = views.map(() => ({
        target: new THREE.WebGLRenderTarget(1, 1, {
          type: THREE.FloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: true,
          generateMipmaps: false,
          count: Object.keys(ATTACHMENTS).length,
        }),
        prevMatrixWorld: new THREE.Matrix4(),
      }));
    }

    const measurable = !layoutChanged && timeDelta > 0;
    const frame: FlowFrame = {
      frame: this.frame,
      sceneTimeMs: time,
      deltaMs: timeDelta,
      xrPresenting: this.sceneEl.renderer.xr.isPresenting,
      rigMatrixWorld: rigMatrixWorld.toArray(),
      views: [],
    };

    if (measurable) {
      const renderer = this.sceneEl.renderer;
      const scene = this.sceneEl.object3D;
      const previous = {
        target: renderer.getRenderTarget(),
        xrEnabled: renderer.xr.enabled,
        autoClear: renderer.autoClear,
        background: scene.background,
        overrideMaterial: scene.overrideMaterial,
      };

      renderer.xr.enabled = false;
      renderer.autoClear = false;
      scene.background = null;
      scene.overrideMaterial = this.material;

      frame.views = views.map((view, index) => this.measureView(this.slots[index], view, 1000 / timeDelta));

      scene.overrideMaterial = previous.overrideMaterial;
      scene.background = previous.background;
      renderer.autoClear = previous.autoClear;
      renderer.xr.enabled = previous.xrEnabled;
      renderer.setRenderTarget(previous.target);

      const readback = this.readSample(frame, [...this.slots]);
      this.pending.add(readback);
      void readback.finally(() => this.pending.delete(readback));
    } else {
      frame.views = views.map((view) => ({
        eye: view.eye,
        matrixWorld: view.camera.matrixWorld.toArray(),
        projectionMatrix: view.camera.projectionMatrix.toArray(),
        fieldWidth: 0,
        fieldHeight: 0,
      }));
    }

    views.forEach((view, index) => this.slots[index].prevMatrixWorld.copy(view.camera.matrixWorld));
    this.prevRigMatrixWorld.copy(rigMatrixWorld);
    this.frameListeners.forEach((listener) => listener(frame));
    this.frame += 1;
  },

  measureView(this: OpticalFlowInternals, slot: ViewSlot, view: ActiveView, invDeltaSec: number): ViewPose {
    const { camera } = view;
    const renderer = this.sceneEl.renderer;
    const projection = camera.projectionMatrix;
    const height = this.data.fieldHeight;
    const width = Math.max(1, Math.round(height * (projection.elements[5] / projection.elements[0])));
    const eyeMatrixWorld = camera.matrixWorld;
    const { inverseEye, rigPrevEye } = this.scratch;

    if (slot.target.width !== width || slot.target.height !== height) {
      slot.target.setSize(width, height);
    }

    if (!viewGeometryMatches(slot.geometry, width, height, projection)) {
      slot.geometry = createViewGeometry(width, height, projection);
    }

    // current eye space -> previous eye space: prevView * currentEyeWorld
    inverseEye.copy(slot.prevMatrixWorld).invert();
    this.material.uniforms.uToPrevEye.value.multiplyMatrices(inverseEye, eyeMatrixWorld);

    // Previous eye pose had only the rig moved: prevRig * inverse(rig) * currentEyeWorld
    rigPrevEye.copy(this.scratch.rig).invert().premultiply(this.prevRigMatrixWorld).multiply(eyeMatrixWorld);
    inverseEye.copy(rigPrevEye).invert();
    this.material.uniforms.uToRigPrevEye.value.multiplyMatrices(inverseEye, eyeMatrixWorld);
    this.material.uniforms.uInvDeltaSec.value = invDeltaSec;

    const { flowCamera } = this;
    flowCamera.matrixWorld.copy(eyeMatrixWorld);
    flowCamera.matrixWorldInverse.copy(eyeMatrixWorld).invert();
    flowCamera.projectionMatrix.copy(projection);
    flowCamera.projectionMatrixInverse.copy(projection).invert();
    flowCamera.layers.mask = camera.layers.mask;

    renderer.setRenderTarget(slot.target);
    renderer.state.buffers.color.setMask(true);
    const gl = renderer.getContext() as WebGL2RenderingContext;
    Object.values(ATTACHMENTS).forEach((attachment) => gl.clearBufferfv(gl.COLOR, attachment, BACKGROUND));
    renderer.clear(false, true, false);
    renderer.render(this.sceneEl.object3D, flowCamera);

    return {
      eye: view.eye,
      matrixWorld: eyeMatrixWorld.toArray(),
      projectionMatrix: projection.toArray(),
      fieldWidth: width,
      fieldHeight: height,
    };
  },

  async readSample(this: OpticalFlowInternals, frame: FlowFrame, slots: ViewSlot[]): Promise<void> {
    const renderer = this.sceneEl.renderer;
    const readField = async (view: ViewPose, slot: ViewSlot, component: FlowComponent) => {
      const data = new Float32Array(view.fieldWidth * view.fieldHeight * 4);
      await renderer.readRenderTargetPixelsAsync(slot.target, 0, 0, view.fieldWidth, view.fieldHeight, data, undefined, ATTACHMENTS[component]);
      return { width: view.fieldWidth, height: view.fieldHeight, data };
    };
    const geometries = slots.map((slot) => slot.geometry as ViewGeometry);
    const fields = await Promise.all(frame.views.map(async (view, index) => {
      const [total, rigInduced] = await Promise.all([
        readField(view, slots[index], 'total'),
        readField(view, slots[index], 'rigInduced'),
      ]);
      return { total, rigInduced };
    }));

    const views: ViewFlow[] = frame.views.map((view, index) => ({
      eye: view.eye,
      fields: fields[index],
      ...measureFields(fields[index], geometries[index]),
    }));
    const sample: FlowSample = {
      frame: frame.frame,
      sceneTimeMs: frame.sceneTimeMs,
      deltaMs: frame.deltaMs,
      combined: combineMeasurements(views),
      views,
    };

    if (this.latest === null || sample.frame > this.latest.frame) {
      this.latest = sample;
    }

    this.sampleListeners.forEach((listener) => listener(sample));
  },
});

export function getOpticalFlow(sceneEl: Element): OpticalFlowSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems['optical-flow'] as OpticalFlowSystem;
}
