import 'aframe';
import type { Scene } from 'aframe';
import './style.css';
import { getAmbientSound } from './audio/ambient-sound';
import { getOpticalFlow } from './optical-flow/optical-flow-system';
import { getTurnCues } from './turn-cues/turn-cue-system';
import { getInertialAmbience } from './inertial-ambience/inertial-ambience-system';
import { getInertialSound } from './inertial-sound/inertial-sound-system';
import { getCondition } from './conditions/condition-system';
import { mountConditionSelect } from './conditions/condition-select';
import { FlowSessionRecorder } from './optical-flow/session-recorder';
import { mountRecordingButton } from './recording-button';
import { findScene } from './scenes/scenes';
import { mountSceneSelect } from './scenes/scene-select';
import { readSelection, writeSelection } from './scenes/url-selection';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('App root not found.');
}

const selection = readSelection();
const testScene = findScene(selection.scene);

app.innerHTML = `
  <a-scene
    embedded
    renderer="antialias: true; colorManagement: true"
    background="color: #dcecf8"
    vr-mode-ui="enabled: true"
    webxr="referenceSpaceType: ${testScene.referenceSpaceType}"
    optical-flow="fieldHeight: 64"
    condition="${selection.condition}"
  >
    <a-entity light="type: ambient; intensity: 0.8; color: #eef6ff"></a-entity>
    <a-entity
      light="type: directional; intensity: 1.2; color: #fff5df"
      position="6 10 3"
    ></a-entity>

    ${testScene.markup()}
  </a-scene>
`;

const sceneEl = app.querySelector<Scene>('a-scene');

if (!sceneEl) {
  throw new Error('Scene markup incomplete.');
}

sceneEl.addEventListener('loaded', () => {
  const conditions = getCondition(sceneEl);
  const recorder = new FlowSessionRecorder(
    sceneEl,
    getOpticalFlow(sceneEl),
    getTurnCues(sceneEl),
    getInertialSound(sceneEl),
    getInertialAmbience(sceneEl),
    getAmbientSound(sceneEl),
    conditions,
    { fieldSnapshotIntervalMs: 500, scene: testScene.recording(sceneEl) },
  );

  mountRecordingButton(app, recorder);

  const selects = document.createElement('div');
  selects.className = 'selects';
  app.append(selects);
  mountSceneSelect(selects, testScene.id, conditions);
  mountConditionSelect(selects, conditions);
  conditions.onChange((state) => writeSelection({ condition: state.id }));
});
