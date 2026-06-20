/**
 * Shared network protocol + world constants.
 *
 * NOTE: This file is mirrored byte-for-byte in `backend/src/protocol.ts`.
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
  maxPlayersPerRoom: 16,
  /** Rounding radius for a turning buoy: get this close to its centre and it
   *  counts as rounded. Generous so a natural wide arc around the mark scores —
   *  you don't have to shave it. (Only used for buoys; the start/finish line
   *  uses startLineHalf + a crossing test.) */
  checkpointRadius: 60,
  /** Lateral half-width of the start/finish gate — the span you can cross
   *  between the posts. Wider than the buoy radius so the line is long. */
  startLineHalf: 60,
  totalLaps: 2,
  /** Seconds of "finding racers" lobby once a speed room has a player. */
  lobbySeconds: 8,
  /** Seconds of pre-start manoeuvring before GO (final 5 are a 5-4-3-2-1). */
  countdownSeconds: 12,
  /** Seconds the standings screen stays up before the room resets. */
  finishSeconds: 8,
} as const;

// ---------------------------------------------------------------------------
// Race course
// ---------------------------------------------------------------------------

export interface Checkpoint {
  x: number;
  z: number;
  /** Direction (radians) boats should be travelling as they reach this mark. */
  angle: number;
  /** "line" = a start/finish you cross; "buoy" = a turning mark you round. */
  kind: "line" | "buoy";
}

/**
 * A simple out-and-back course: start behind the line, sail out to the turning
 * buoy, round it, and come back across the line to finish. Mark 0 is always the
 * start/finish line; the rest are turning buoys. Defined identically on client
 * and server so checkpoint indices line up.
 */
export const COURSE: Checkpoint[] = [
  { x: 0, z: -320, angle: 0, kind: "line" },
  { x: 0, z: 380, angle: Math.PI, kind: "buoy" },
];

/** Hull colors handed out to players in join order (16 distinct, one per slot). */
export const PLAYER_COLORS = [
  0xff5252, 0x40c4ff, 0x69f0ae, 0xffd740, 0xff6ec7, 0xb388ff, 0xffab40,
  0x18ffff, 0xff1744, 0x00e676, 0x2979ff, 0xf50057, 0xaeea00, 0xff9100,
  0x00b8d4, 0xd500f9,
];
