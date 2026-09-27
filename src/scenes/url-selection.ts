import { CONDITION_IDS, type ConditionId } from '../conditions/conditions';
import { SCENE_IDS, type SceneId } from './scenes';

/** Scene and condition to start with, from `?scene=…&condition=…`. */
export type Selection = {
  scene: SceneId;
  condition: ConditionId;
};

const DEFAULTS: Selection = {
  scene: 'mountain-flight',
  condition: 'turn-tone-optical-flow',
};

function readParam<T extends string>(params: URLSearchParams, name: keyof Selection, allowed: readonly T[], fallback: T): T {
  const value = params.get(name);

  if (value === null) {
    return fallback;
  }

  if (!allowed.includes(value as T)) {
    console.warn(`Unknown ${name} "${value}" in the URL, using "${fallback}". Known: ${allowed.join(', ')}.`);
    return fallback;
  }

  return value as T;
}

/**
 * Reads the selection from the URL and writes it back complete, so the
 * address bar always holds a link that reproduces the current setup.
 */
export function readSelection(): Selection {
  const params = new URLSearchParams(window.location.search);
  const selection: Selection = {
    scene: readParam(params, 'scene', SCENE_IDS, DEFAULTS.scene),
    condition: readParam(params, 'condition', CONDITION_IDS, DEFAULTS.condition),
  };

  writeSelection(selection);
  return selection;
}

/** Updates the URL without reloading. */
export function writeSelection(changes: Partial<Selection>): void {
  window.history.replaceState(window.history.state, '', selectionUrl(changes));
}

/** Loads the page again with another scene; scenes are only ever built on page load. */
export function reloadWithScene(scene: SceneId): void {
  window.location.assign(selectionUrl({ scene }));
}

function selectionUrl(changes: Partial<Selection>): string {
  const url = new URL(window.location.href);
  Object.entries(changes).forEach(([name, value]) => url.searchParams.set(name, value));
  return url.toString();
}
