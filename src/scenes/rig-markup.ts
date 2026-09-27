import '../conditions/condition-cycle';

/**
 * The rig every scene moves: the camera (the head; its parent is the rig, see
 * `src/rig.ts`) and the right controller, whose B button cycles the condition.
 * `attributes` go on the rig entity, e.g. the component that moves it.
 */
export function rigMarkup(attributes: string): string {
  return `
    <a-entity id="rig" ${attributes}>
      <a-camera
        fov="60"
        position="0 0 0"
        wasd-controls-enabled="false"
      ></a-camera>

      <a-entity meta-touch-controls="hand: right; model: false" condition-cycle="event: bbuttondown"></a-entity>
    </a-entity>
  `;
}
