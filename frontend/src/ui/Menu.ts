import { GameMode } from "../protocol";
import { MenuBackground } from "./MenuBackground";

export interface MenuChoice {
  name: string;
  mode: GameMode;
}

/**
 * The start screen: name entry + mode selection. Resolves once the player
 * presses "Set sail".
 */
export class Menu {
  private root: HTMLElement;
  private nameInput: HTMLInputElement;
  private playBtn: HTMLButtonElement;
  private statusEl: HTMLElement;
  private mode: GameMode = "casual";
  private busy = false;
  private background: MenuBackground;

  constructor() {
    this.root = required("menu");
    this.nameInput = required<HTMLInputElement>("name");
    this.playBtn = required<HTMLButtonElement>("play");
    this.statusEl = required("status");

    // Set the menu's revolving ocean going behind the panel.
    this.background = new MenuBackground(required<HTMLCanvasElement>("menu-bg"));
    this.background.start();

    const saved = localStorage.getItem("sail.name");
    if (saved) this.nameInput.value = saved;

    for (const btn of document.querySelectorAll<HTMLButtonElement>(".mode")) {
      btn.addEventListener("click", () => this.selectMode(btn));
    }
    this.selectMode(document.querySelector<HTMLButtonElement>(".mode")!);
  }

  private selectMode(btn: HTMLButtonElement): void {
    this.mode = (btn.dataset.mode as GameMode) ?? "casual";
    for (const b of document.querySelectorAll(".mode")) {
      b.classList.toggle("selected", b === btn);
    }
  }

  /**
   * Register a handler invoked whenever the player presses "Set sail" (button
   * or Enter). Re-callable so the menu can be retried after a failed connect.
   */
  onPlay(handler: (choice: MenuChoice) => void): void {
    const submit = () => {
      if (this.busy) return;
      const name = this.nameInput.value.trim() || "Sailor";
      localStorage.setItem("sail.name", name);
      handler({ name, mode: this.mode });
    };
    this.playBtn.addEventListener("click", submit);
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  setStatus(text: string, isError = false): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle("error", isError);
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.playBtn.disabled = busy;
    this.playBtn.textContent = busy ? "Setting sail…" : "Set sail";
  }

  hide(): void {
    this.root.classList.add("hidden");
    // Stop revolving the ocean — the game's own scene takes over from here.
    this.background.stop();
  }
}

function required<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}
