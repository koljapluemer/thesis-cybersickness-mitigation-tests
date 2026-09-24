import 'aframe';
import type { Entity, Scene } from 'aframe';
import './style.css';
import './tour-flight';
import type { TourFlightComponent } from './tour-flight';
import { getOpticalFlow } from './optical-flow/optical-flow-system';
import { getTurnCues } from './turn-cues/turn-cue-system';
import { getCondition } from './conditions/condition-system';
import './conditions/condition-cycle';
import { mountConditionSelect } from './conditions/condition-select';
import { FlowSessionRecorder } from './optical-flow/session-recorder';
import { mountRecordingButton } from './recording-button';

const LANDSCAPE_SRC = '/mountains/scene.gltf';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

app.innerHTML = `
  <a-scene
    embedded
    renderer="antialias: true; colorManagement: true"
    background="color: #dcecf8"
    vr-mode-ui="enabled: true"
    optical-flow="fieldHeight: 64"
    condition="turn-tones"
  >
    <a-assets>
      <a-asset-item id="mountain-landscape" src="${LANDSCAPE_SRC}"></a-asset-item>
    </a-assets>

    <a-entity light="type: ambient; intensity: 0.8; color: #eef6ff"></a-entity>
    <a-entity
      light="type: directional; intensity: 1.2; color: #fff5df"
      position="6 10 3"
    ></a-entity>

    <a-entity
      id="landscape"
      gltf-model="#mountain-landscape"
      position="0 2.7 0"
      scale="220 220 220"
      rotation="0 18 0"
    ></a-entity>

    <a-entity id="rig" tour-flight="src: /tour-path.json; scale: 220; offset: 0 2.7 0; rotationY: 18; pitch: 30">
      <a-camera
        fov="60"
        position="0 0 0"
        wasd-controls-enabled="false"
      ></a-camera>

      <a-entity meta-touch-controls="hand: right; model: false" condition-cycle="event: bbuttondown"></a-entity>
    </a-entity>
  </a-scene>
`;

const sceneEl = app.querySelector<Scene>('a-scene');
const landscapeEl = app.querySelector<Entity>('#landscape');
const rigEl = app.querySelector<Entity>('#rig');

if (!sceneEl || !landscapeEl || !rigEl) {
  throw new Error('Scene markup incomplete.');
}

sceneEl.addEventListener('loaded', () => {
  const tourFlight = rigEl.components['tour-flight'] as unknown as TourFlightComponent;
  const recorder = new FlowSessionRecorder(sceneEl, getOpticalFlow(sceneEl), getTurnCues(sceneEl), getCondition(sceneEl), {
    fieldSnapshotIntervalMs: 500,
    pathTimeSec: () => tourFlight.pathTimeSec,
    describeScene: () => {
      landscapeEl.object3D.updateWorldMatrix(true, false);
      return {
        landscape: { src: LANDSCAPE_SRC, matrixWorld: landscapeEl.object3D.matrixWorld.toArray() },
        tour: { ...tourFlight.data },
      };
    },
  });

  mountRecordingButton(app, recorder);
  mountConditionSelect(app, getCondition(sceneEl));
});
