import 'aframe';
import type { Scene, System } from 'aframe';
import type { Unsubscribe } from '../optical-flow/types';
import { CONDITION_IDS, CONDITIONS, type ConditionId } from './conditions';

export type ConditionState = {
  id: ConditionId;
  label: string;
  /** While locked (during a recording), the condition cannot be changed. */
  locked: boolean;
};

export type ConditionSystem = System & {
  readonly state: ConditionState;
  /** Switches to the condition; returns false (and changes nothing) while locked. */
  select(id: ConditionId): boolean;
  /** Switches to the next condition in `CONDITIONS` order, wrapping around; false while locked. */
  cycle(): boolean;
  /** Prevents switching until the returned function is called. */
  lock(): Unsubscribe;
  /** Called with the new state whenever the condition or the lock changes. */
  onChange(listener: (state: ConditionState) => void): Unsubscribe;
};

type ConditionInternals = ConditionSystem & {
  sceneEl: Scene;
  data: ConditionId;
  state: ConditionState;
  locks: number;
  listeners: Set<(state: ConditionState) => void>;
  notify(changes: Partial<ConditionState>): void;
};

/**
 * The experimental condition (see `conditions.ts`). Applying one writes its
 * configuration to every mitigation system on the scene; the mitigations know
 * nothing about conditions.
 */
AFRAME.registerSystem('condition', {
  schema: { type: 'string', default: 'turn-tones', oneOf: CONDITION_IDS },

  init(this: ConditionInternals) {
    this.locks = 0;
    this.listeners = new Set();
    this.state = { id: this.data, label: '', locked: false };
  },

  update(this: ConditionInternals) {
    const condition = CONDITIONS.find(({ id }) => id === this.data);

    if (!condition) {
      throw new Error(`Unknown condition "${this.data}".`);
    }

    Object.entries(condition.mitigations).forEach(([system, config]) => {
      this.sceneEl.setAttribute(system, AFRAME.utils.styleParser.stringify(config));
    });

    this.notify({ id: condition.id, label: condition.label });
  },

  select(this: ConditionInternals, id: ConditionId): boolean {
    if (this.locks > 0) {
      return false;
    }

    if (id !== this.data) {
      this.sceneEl.setAttribute('condition', id);
    }

    return true;
  },

  cycle(this: ConditionInternals): boolean {
    const index = CONDITION_IDS.indexOf(this.data);
    return this.select(CONDITION_IDS[(index + 1) % CONDITION_IDS.length]);
  },

  lock(this: ConditionInternals): Unsubscribe {
    let released = false;
    this.locks += 1;
    this.notify({ locked: true });

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.locks -= 1;
      this.notify({ locked: this.locks > 0 });
    };
  },

  onChange(this: ConditionInternals, listener: (state: ConditionState) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  notify(this: ConditionInternals, changes: Partial<ConditionState>) {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener(this.state));
  },
});

export function getCondition(sceneEl: Element): ConditionSystem {
  return (sceneEl as unknown as { systems: Record<string, unknown> }).systems.condition as ConditionSystem;
}
