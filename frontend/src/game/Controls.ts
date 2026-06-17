import { BoatInput } from "./physics";

/**
 * Keyboard input → boat controls. WASD or arrow keys.
 *   W / ↑  throttle (raise sail)
 *   S / ↓  brake / slow
 *   A / ←  steer left
 *   D / →  steer right
 */
export class Controls {
  private keys = new Set<string>();
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
    // Drop all keys if the window loses focus so the boat doesn't run away.
    window.addEventListener("blur", () => this.keys.clear());
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.keys.clear();
  }

  sample(): BoatInput {
    if (!this.enabled) return { throttle: 0, brake: 0, rudder: 0 };
    const down = (k: string) => (this.keys.has(k) ? 1 : 0);
    const throttle = Math.max(down("w"), down("arrowup"));
    const brake = Math.max(down("s"), down("arrowdown"));
    const rudder =
      Math.max(down("d"), down("arrowright")) -
      Math.max(down("a"), down("arrowleft"));
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
