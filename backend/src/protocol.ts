/**
 * Shared network protocol + world constants.
 *
 * NOTE: This file is mirrored byte-for-byte in `frontend/src/protocol.ts`.
 * Keep the two copies identical so the client and server always agree on the
 * wire format and the race course. (TODO: extract into a shared workspace
 * package once the project grows.)
 */

export type GameMode = "casual" | "speed";

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "join"; name: string; mode: GameMode }
  // Local boat state, sent ~20x/sec. Client-authoritative for now.
  | { type: "state"; x: number; z: number; heading: number; speed: number }
  // Speed mode: client reports passing a checkpoint gate.
  | { type: "checkpoint"; index: number }
  | { type: "ping"; t: number };

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

export interface PlayerSnapshot {
  id: string;
  name: string;
  slot: number; // start-grid slot, assigned on join
  color: number; // hull color (hex int)
  x: number;
  z: number;
  heading: number;
  speed: number;
  lap: number;
  nextCheckpoint: number;
  finished: boolean;
}

export type RacePhase =
  | "free" // casual rooms: no race, sail freely
  | "waiting" // speed rooms: lobby, waiting to start
  | "countdown" // 3..2..1
  | "racing"
  | "finished";

export interface Standing {
  id: string;
  name: string;
  lap: number;
  finished: boolean;
  timeMs: number | null; // finish time relative to race start, null if unfinished
}

export interface RaceState {
  phase: RacePhase;
  totalLaps: number;
  countdown: number; // whole seconds remaining in waiting/countdown phases
  startedAt: number | null; // server epoch ms when racing began
  standings: Standing[];
}

export type ServerMessage =
  | {
      type: "welcome";
      id: string;
      mode: GameMode;
      color: number;
      slot: number;
      players: PlayerSnapshot[];
      course: Checkpoint[];
      race: RaceState;
    }
  | { type: "playerJoined"; player: PlayerSnapshot }
  | { type: "playerLeft"; id: string }
  | { type: "snapshot"; t: number; players: PlayerSnapshot[] }
  | { type: "race"; race: RaceState }
  | { type: "pong"; t: number };

// ---------------------------------------------------------------------------
// World constants (shared so client and server agree on the physics arena)
// ---------------------------------------------------------------------------

export const WORLD = {
  /** Half-extent of the playable ocean in world units. */
  bounds: 900,
  /** Server snapshots broadcast per second. */
  tickRate: 20,
  maxPlayersPerRoom: 8,
  /** Distance at which a boat is considered to have passed a checkpoint gate. */
  checkpointRadius: 28,
  totalLaps: 2,
  /** Seconds of "get ready" lobby once a speed room has a player. */
  lobbySeconds: 6,
  /** Seconds of 3-2-1 countdown before GO. */
  countdownSeconds: 3,
  /** Seconds the standings screen stays up before the room resets. */
  finishSeconds: 8,
} as const;

// ---------------------------------------------------------------------------
// Race course
// ---------------------------------------------------------------------------

export interface Checkpoint {
  x: number;
  z: number;
  /** Direction (radians) boats should travel through the gate. */
  angle: number;
}

/**
 * Deterministic oval course. Generated the same way on both client and server
 * so checkpoint indices line up. Checkpoint 0 is the start/finish line.
 */
function makeOvalCourse(count: number, rx: number, rz: number): Checkpoint[] {
  const gates: Checkpoint[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const z = Math.sin(a) * rz;
    // Tangent of the ellipse = direction of travel through the gate.
    const angle = Math.atan2(Math.cos(a) * rz, -Math.sin(a) * rx);
    gates.push({ x, z, angle });
  }
  return gates;
}

export const COURSE: Checkpoint[] = makeOvalCourse(8, 420, 300);

/** Hull colors handed out to players in join order. */
export const PLAYER_COLORS = [
  0xff5252, 0x40c4ff, 0x69f0ae, 0xffd740, 0xff6ec7, 0xb388ff, 0xffab40,
  0x18ffff,
];
