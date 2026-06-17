import { Player } from "./Player";
import {
  COURSE,
  GameMode,
  PLAYER_COLORS,
  RacePhase,
  RaceState,
  ServerMessage,
  Standing,
  WORLD,
} from "./protocol";

let nextRoomId = 1;

/**
 * A single game instance: a set of players sharing one ocean and (in speed
 * mode) one race. Runs its own fixed-timestep loop that broadcasts snapshots
 * and advances the race state machine.
 */
export class Room {
  readonly id: string;
  readonly mode: GameMode;

  private players = new Map<string, Player>();
  private loop: NodeJS.Timeout | null = null;

  // Race state machine (speed mode only; casual rooms stay in "free").
  private phase: RacePhase;
  private phaseTimer = 0; // seconds remaining in the current timed phase
  private raceStartedAt: number | null = null;

  private lastTick = Date.now();

  constructor(mode: GameMode) {
    this.id = `room${nextRoomId++}`;
    this.mode = mode;
    this.phase = mode === "speed" ? "waiting" : "free";
  }

  get size(): number {
    return this.players.size;
  }

  get isFull(): boolean {
    return this.players.size >= WORLD.maxPlayersPerRoom;
  }

  /** Casual rooms always accept; speed rooms only accept between races. */
  get acceptsNewPlayers(): boolean {
    if (this.isFull) return false;
    if (this.mode === "casual") return true;
    return this.phase === "waiting";
  }

  // -------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------

  add(player: Player): void {
    player.slot = this.firstFreeSlot();
    player.color = PLAYER_COLORS[player.slot % PLAYER_COLORS.length];
    player.resetRaceProgress();
    this.players.set(player.id, player);

    this.broadcast(
      { type: "playerJoined", player: player.toSnapshot() },
      player.id,
    );

    if (this.mode === "speed" && this.phase === "waiting") {
      // (Re)start the lobby clock when the room becomes non-empty.
      this.phaseTimer = WORLD.lobbySeconds;
    }

    if (!this.loop) this.start();
  }

  remove(playerId: string): void {
    if (!this.players.delete(playerId)) return;
    this.broadcast({ type: "playerLeft", id: playerId });

    if (this.players.size === 0) {
      this.stop();
      this.phase = this.mode === "speed" ? "waiting" : "free";
      this.raceStartedAt = null;
    }
  }

  has(playerId: string): boolean {
    return this.players.has(playerId);
  }

  private firstFreeSlot(): number {
    const used = new Set<number>();
    for (const p of this.players.values()) used.add(p.slot);
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  // -------------------------------------------------------------------------
  // Gameplay input
  // -------------------------------------------------------------------------

  passCheckpoint(player: Player, index: number): void {
    if (this.mode !== "speed" || this.phase !== "racing") return;
    if (player.finished) return;
    if (index !== player.nextCheckpoint) return; // gates must be hit in order

    // Checkpoint 0 is the start/finish line. Crossing it advances the lap
    // counter: the first crossing starts lap 1, each later crossing completes
    // a lap. Finishing `totalLaps` laps means crossing it `totalLaps + 1`
    // times in total.
    if (index === 0) {
      player.lap += 1;
      if (player.lap > WORLD.totalLaps) {
        player.finished = true;
        player.finishTimeMs = this.raceStartedAt
          ? Date.now() - this.raceStartedAt
          : null;
        this.broadcastRace();
        this.maybeFinishRace();
        return;
      }
    }

    player.nextCheckpoint = (index + 1) % COURSE.length;
    this.broadcastRace();
  }

  // -------------------------------------------------------------------------
  // Loop
  // -------------------------------------------------------------------------

  private start(): void {
    this.lastTick = Date.now();
    this.loop = setInterval(() => this.tick(), 1000 / WORLD.tickRate);
  }

  private stop(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  private tick(): void {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;

    if (this.mode === "speed") this.advanceRace(dt);

    const players = [...this.players.values()].map((p) => p.toSnapshot());
    this.broadcast({ type: "snapshot", t: now, players });
  }

  private advanceRace(dt: number): void {
    const prevPhase = this.phase;
    const prevCountdown = Math.ceil(this.phaseTimer);

    switch (this.phase) {
      case "waiting":
        if (this.players.size > 0) {
          this.phaseTimer -= dt;
          if (this.phaseTimer <= 0) this.enterCountdown();
        }
        break;
      case "countdown":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.enterRacing();
        break;
      case "racing":
        this.maybeFinishRace();
        break;
      case "finished":
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.resetToWaiting();
        break;
    }

    // Push a race update when the phase changes or the countdown ticks down.
    if (
      this.phase !== prevPhase ||
      Math.ceil(this.phaseTimer) !== prevCountdown
    ) {
      this.broadcastRace();
    }
  }

  private enterCountdown(): void {
    this.phase = "countdown";
    this.phaseTimer = WORLD.countdownSeconds;
    for (const p of this.players.values()) p.resetRaceProgress();
  }

  private enterRacing(): void {
    this.phase = "racing";
    this.raceStartedAt = Date.now();
    this.phaseTimer = 0;
  }

  private maybeFinishRace(): void {
    const active = [...this.players.values()];
    if (active.length === 0) return;
    const allDone = active.every((p) => p.finished);
    if (allDone) {
      this.phase = "finished";
      this.phaseTimer = WORLD.finishSeconds;
      this.broadcastRace();
    }
  }

  private resetToWaiting(): void {
    this.phase = "waiting";
    this.phaseTimer = WORLD.lobbySeconds;
    this.raceStartedAt = null;
    for (const p of this.players.values()) p.resetRaceProgress();
  }

  // -------------------------------------------------------------------------
  // State snapshots
  // -------------------------------------------------------------------------

  raceState(): RaceState {
    return {
      phase: this.phase,
      totalLaps: WORLD.totalLaps,
      countdown: Math.max(0, Math.ceil(this.phaseTimer)),
      startedAt: this.raceStartedAt,
      standings: this.standings(),
    };
  }

  private standings(): Standing[] {
    return [...this.players.values()]
      .map<Standing>((p) => ({
        id: p.id,
        name: p.name,
        lap: p.lap,
        finished: p.finished,
        timeMs: p.finishTimeMs,
      }))
      .sort((a, b) => {
        if (a.finished && b.finished) {
          return (a.timeMs ?? 0) - (b.timeMs ?? 0);
        }
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        return b.lap - a.lap;
      });
  }

  snapshots() {
    return [...this.players.values()].map((p) => p.toSnapshot());
  }

  // -------------------------------------------------------------------------
  // Messaging
  // -------------------------------------------------------------------------

  private broadcastRace(): void {
    this.broadcast({ type: "race", race: this.raceState() });
  }

  broadcast(message: ServerMessage, exceptId?: string): void {
    const data = JSON.stringify(message);
    for (const p of this.players.values()) {
      if (p.id === exceptId) continue;
      if (p.socket.readyState === p.socket.OPEN) p.socket.send(data);
    }
  }
}
