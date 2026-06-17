import { WebSocket } from "ws";
import { PlayerSnapshot } from "./protocol";

let nextId = 1;

/**
 * A connected player. Holds the latest state reported by the client plus
 * server-tracked race progress (lap / checkpoint / finish time).
 */
export class Player {
  readonly id: string;
  readonly socket: WebSocket;
  name = "Sailor";
  slot = 0;
  color = 0xffffff;

  // Latest client-reported boat state.
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;

  // Race progress (speed mode).
  lap = 0;
  nextCheckpoint = 0;
  finished = false;
  finishTimeMs: number | null = null;

  constructor(socket: WebSocket) {
    this.id = `p${nextId++}`;
    this.socket = socket;
  }

  resetRaceProgress(): void {
    this.lap = 0;
    this.nextCheckpoint = 0;
    this.finished = false;
    this.finishTimeMs = null;
  }

  toSnapshot(): PlayerSnapshot {
    return {
      id: this.id,
      name: this.name,
      slot: this.slot,
      color: this.color,
      x: this.x,
      z: this.z,
      heading: this.heading,
      speed: this.speed,
      lap: this.lap,
      nextCheckpoint: this.nextCheckpoint,
      finished: this.finished,
    };
  }
}
