import { BIG_ROOM } from './big-room';
import { CAR_RACE } from './car-race';
import { CITY_DRIVE } from './city-drive';
import { MOUNTAIN_FLIGHT } from './mountain-flight';

/** The test scenes, in select order. */
export const SCENES = [MOUNTAIN_FLIGHT, CAR_RACE, CITY_DRIVE, BIG_ROOM] as const;

export type TestScene = (typeof SCENES)[number];

export type SceneId = TestScene['id'];

/** Per-frame state logged by the scene's recording, see each scene's `frameState`. */
export type SceneFrameState = ReturnType<ReturnType<TestScene['recording']>['frameState']>;

export const SCENE_IDS: SceneId[] = SCENES.map((scene) => scene.id);

export function findScene(id: SceneId): TestScene {
  return SCENES.find((scene) => scene.id === id) as TestScene;
}
