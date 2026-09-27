import type { ConditionSystem } from '../conditions/condition-system';
import { SCENES, type SceneId } from './scenes';
import { reloadWithScene } from './url-selection';

/**
 * Desktop select for the test scene. Choosing one reloads the page with it
 * (keeping the condition). Disabled while the condition is locked, i.e. while
 * recording.
 */
export function mountSceneSelect(container: HTMLElement, current: SceneId, conditions: ConditionSystem): void {
  const select = document.createElement('select');
  select.className = 'scene-select';
  select.title = 'Test scene (reloads the page)';
  select.append(...SCENES.map(({ id, label }) => new Option(label, id)));
  select.value = current;
  container.append(select);

  select.addEventListener('change', () => {
    select.disabled = true;
    reloadWithScene(select.value as SceneId);
  });

  conditions.onChange((state) => {
    select.disabled = state.locked;
  });
  select.disabled = conditions.state.locked;
}
