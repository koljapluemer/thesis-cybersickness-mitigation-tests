import type { ConditionSystem } from './condition-system';
import { CONDITIONS, type ConditionId } from './conditions';

/**
 * Desktop select for the experimental condition. Mirrors every change (also
 * from `condition-cycle` in VR) and is disabled while the condition is locked.
 */
export function mountConditionSelect(container: HTMLElement, conditions: ConditionSystem): void {
  const select = document.createElement('select');
  select.className = 'condition-select';
  select.title = 'Experimental condition (B on the right controller cycles in VR)';
  select.append(...CONDITIONS.map(({ id, label }) => new Option(label, id)));
  container.append(select);

  select.addEventListener('change', () => {
    conditions.select(select.value as ConditionId);
    // Keys belong to the scene (driving), not to the focused select.
    select.blur();
  });

  const render = () => {
    select.value = conditions.state.id;
    select.disabled = conditions.state.locked;
  };

  conditions.onChange(render);
  render();
}
