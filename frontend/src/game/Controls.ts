import { BoatInput } from "./physics";

/** The four control axes an on-screen touch button can hold down. */
type TouchAxis = "throttle" | "brake" | "left" | "right";

/**
 * Keyboard + on-screen touch input → boat controls.
 *   W / ↑  throttle (raise sail)
 *   S / ↓  brake / slow
 *   A / ←  steer left
 *   D / →  steer right
 * On touch devices the same axes are driven by the #touch-controls buttons.
 */
export class Controls {
  private keys = new Set<string>();
  private touch: Record<TouchAxis, boolean> = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
  };
  private enabled = true;

  constructor(target: HTMLElement | Window = window) {
    target.addEventListener("keydown", (e) => {
      const k = (e as KeyboardEvent).key.toLowerCase();
      if (TRACKED.has(k)) {
        this.keys.add(k);
        e.preventDefault();
      }
    });
    target.addEventListener("keyup", (e) => {
      this.keys.delete((e as KeyboardEvent).key.toLowerCase());
    });
    // Drop all input if the window loses focus so the boat doesn't run away.
    window.addEventListener("blur", () => this.releaseAll());

    this.bindTouchButton("touch-throttle", "throttle");
    this.bindTouchButton("touch-brake", "brake");
    this.bindTouchButton("touch-left", "left");
    this.bindTouchButton("touch-right", "right");
  }

  /** Hold an axis while a touch button is pressed; release on lift/cancel. */
  private bindTouchButton(id: string, axis: TouchAxis): void {
    const btn = document.getElementById(id);
    if (!btn) return;
    const press = (e: Event) => {
      e.preventDefault();
      this.touch[axis] = true;
      btn.classList.add("active");
    };
    const release = (e: Event) => {
      e.preventDefault();
      this.touch[axis] = false;
      btn.classList.remove("active");
    };
    btn.addEventListener("pointerdown", press);
    btn.addEventListener("pointerup", release);
    btn.addEventListener("pointercancel", release);
    btn.addEventListener("pointerleave", release);
  }

  private releaseAll(): void {
    this.keys.clear();
    this.touch.throttle = this.touch.brake = false;
    this.touch.left = this.touch.right = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  sample(): BoatInput {
    if (!this.enabled) return { throttle: 0, brake: 0, rudder: 0 };
    const down = (k: string) => (this.keys.has(k) ? 1 : 0);
    const t = (axis: TouchAxis) => (this.touch[axis] ? 1 : 0);
    const throttle = Math.max(down("w"), down("arrowup"), t("throttle"));
    const brake = Math.max(down("s"), down("arrowdown"), t("brake"));
    const rudder =
      Math.max(down("d"), down("arrowright"), t("right")) -
      Math.max(down("a"), down("arrowleft"), t("left"));
    return { throttle, brake, rudder };
  }
}

const TRACKED = new Set([
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);
