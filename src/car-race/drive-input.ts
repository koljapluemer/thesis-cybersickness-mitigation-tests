import type { Scene } from 'aframe';
import type { DriveCommand } from './car-physics';

export type DriveInputState = DriveCommand & {
  /** True in the frame the reset key or button was pressed. */
  reset: boolean;
};

const KEYS = {
  throttle: ['KeyW', 'ArrowUp'],
  brake: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  reset: ['KeyR'],
} as const;

/** Keyboard ramps, in full scale per second: keys are digital, the car wants analog input. */
const STEER_RATE = 3;
const STEER_RETURN_RATE = 6;
const PEDAL_RATE = 4;
const PEDAL_RELEASE_RATE = 8;

const STICK_DEADZONE = 0.15;
/** xr-standard gamepad mapping. */
const THUMBSTICK_AXES = [2, 3] as const;
const A_BUTTON = 4;

/**
 * Driving input from WASD / arrow keys (R resets) on desktop and from the XR
 * controllers' thumbsticks in VR: x steers, pushing forward accelerates,
 * pulling back brakes and reverses; A on the right controller resets. Both
 * sources add up.
 */
export class DriveInput {
  private readonly sceneEl: Scene;
  private readonly pressed = new Set<string>();
  private readonly keyboard = { steer: 0, throttle: 0, brake: 0 };
  private resetKeyPending = false;
  private aButtonWasPressed = false;

  constructor(sceneEl: Scene) {
    this.sceneEl = sceneEl;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  read(dtSec: number): DriveInputState {
    const held = (codes: readonly string[]) => (codes.some((code) => this.pressed.has(code)) ? 1 : 0);
    const k = this.keyboard;
    k.steer = ramp(k.steer, held(KEYS.left) - held(KEYS.right), STEER_RATE, STEER_RETURN_RATE, dtSec);
    k.throttle = ramp(k.throttle, held(KEYS.throttle), PEDAL_RATE, PEDAL_RELEASE_RATE, dtSec);
    k.brake = ramp(k.brake, held(KEYS.brake), PEDAL_RATE, PEDAL_RELEASE_RATE, dtSec);

    const stick = this.readSticks();
    const reset = this.resetKeyPending || stick.aPressed;
    this.resetKeyPending = false;

    return {
      steer: clamp(k.steer + stick.steer, -1, 1),
      throttle: clamp(k.throttle + Math.max(0, stick.forward), 0, 1),
      brake: clamp(k.brake + Math.max(0, -stick.forward), 0, 1),
      reset,
    };
  }

  private readSticks(): { steer: number; forward: number; aPressed: boolean } {
    const session = this.sceneEl.renderer.xr.getSession();
    let steer = 0;
    let forward = 0;
    let aDown = false;

    for (const source of session?.inputSources ?? []) {
      const gamepad = source.gamepad;

      if (!gamepad || gamepad.mapping !== 'xr-standard') {
        continue;
      }

      const [x, y] = deadzone(gamepad.axes[THUMBSTICK_AXES[0]] ?? 0, gamepad.axes[THUMBSTICK_AXES[1]] ?? 0);
      steer -= x;
      forward -= y;

      if (source.handedness === 'right' && gamepad.buttons[A_BUTTON]?.pressed) {
        aDown = true;
      }
    }

    const aPressed = aDown && !this.aButtonWasPressed;
    this.aButtonWasPressed = aDown;
    return { steer, forward, aPressed };
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) {
      return;
    }

    this.pressed.add(event.code);

    if ((KEYS.reset as readonly string[]).includes(event.code)) {
      this.resetKeyPending = true;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code);
  };

  /** Keys released while the window is unfocused never send keyup. */
  private readonly onBlur = () => {
    this.pressed.clear();
  };
}

function ramp(current: number, target: number, rate: number, returnRate: number, dtSec: number): number {
  // Moving back towards zero (or through it) uses the faster return rate.
  const returning = Math.abs(target) < Math.abs(current) || target * current < 0;
  const step = (returning ? returnRate : rate) * dtSec;
  return current + clamp(target - current, -step, step);
}

/** Radial deadzone, rescaled so the output still starts at 0 and reaches 1. */
function deadzone(x: number, y: number): [number, number] {
  const magnitude = Math.hypot(x, y);

  if (magnitude <= STICK_DEADZONE) {
    return [0, 0];
  }

  const scale = Math.min(1, (magnitude - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / magnitude;
  return [x * scale, y * scale];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
