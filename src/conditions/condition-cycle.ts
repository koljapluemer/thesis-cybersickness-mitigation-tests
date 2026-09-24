import 'aframe';
import type { Entity, Scene } from 'aframe';
import { getCondition } from './condition-system';

type ConditionCycleInternals = {
  el: Entity;
  data: { event: string };
  cycle: () => void;
};

/**
 * Switches to the next condition whenever the entity emits `event`, e.g. a
 * controller button in VR, where the DOM select is out of reach.
 */
AFRAME.registerComponent('condition-cycle', {
  schema: {
    event: { type: 'string' },
  },

  init(this: ConditionCycleInternals) {
    this.cycle = () => getCondition(this.el.sceneEl as Scene).cycle();
  },

  update(this: ConditionCycleInternals, oldData: { event?: string }) {
    if (oldData.event) {
      this.el.removeEventListener(oldData.event, this.cycle);
    }

    this.el.addEventListener(this.data.event, this.cycle);
  },

  remove(this: ConditionCycleInternals) {
    this.el.removeEventListener(this.data.event, this.cycle);
  },
});
