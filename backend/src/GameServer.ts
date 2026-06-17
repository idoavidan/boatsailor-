import { WebSocket, WebSocketServer } from "ws";
import { Player } from "./Player";
import { Room } from "./Room";
import { ClientMessage, COURSE, GameMode } from "./protocol";

/**
 * Owns every connection and room. Routes client messages, matchmakes joiners
 * into a room for their chosen mode, and cleans up on disconnect.
 */
export class GameServer {
  private rooms: Room[] = [];
  private playerRoom = new Map<string, Room>();

  attach(wss: WebSocketServer): void {
    wss.on("connection", (socket) => this.onConnection(socket));
  }

  private onConnection(socket: WebSocket): void {
    const player = new Player(socket);

    socket.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // ignore malformed frames
      }
      this.onMessage(player, msg);
    });

    socket.on("close", () => this.onClose(player));
    socket.on("error", () => this.onClose(player));
  }

  private onMessage(player: Player, msg: ClientMessage): void {
    switch (msg.type) {
      case "join":
        this.onJoin(player, msg.name, msg.mode);
        break;

      case "state": {
        // Trust the client position for now (client-authoritative movement).
        // TODO: validate/clamp against WORLD.bounds and plausible speed.
        if (!this.playerRoom.has(player.id)) return;
        player.x = msg.x;
        player.z = msg.z;
        player.heading = msg.heading;
        player.speed = msg.speed;
        break;
      }

      case "checkpoint": {
        const room = this.playerRoom.get(player.id);
        if (room) room.passCheckpoint(player, msg.index);
        break;
      }

      case "ping":
        this.send(player, { type: "pong", t: msg.t });
        break;
    }
  }

  private onJoin(player: Player, name: string, mode: GameMode): void {
    if (this.playerRoom.has(player.id)) return; // already joined

    player.name = (name || "Sailor").slice(0, 16);
    const room = this.findOrCreateRoom(mode);
    room.add(player);
    this.playerRoom.set(player.id, room);

    this.send(player, {
      type: "welcome",
      id: player.id,
      mode: room.mode,
      color: player.color,
      slot: player.slot,
      players: room.snapshots().filter((p) => p.id !== player.id),
      course: COURSE,
      race: room.raceState(),
    });
  }

  private onClose(player: Player): void {
    const room = this.playerRoom.get(player.id);
    if (room) {
      room.remove(player.id);
      this.playerRoom.delete(player.id);
      if (room.size === 0) this.rooms = this.rooms.filter((r) => r !== room);
    }
  }

  private findOrCreateRoom(mode: GameMode): Room {
    const open = this.rooms.find(
      (r) => r.mode === mode && r.acceptsNewPlayers,
    );
    if (open) return open;
    const room = new Room(mode);
    this.rooms.push(room);
    return room;
  }

  private send(player: Player, message: Parameters<Room["broadcast"]>[0]): void {
    if (player.socket.readyState === player.socket.OPEN) {
      player.socket.send(JSON.stringify(message));
    }
  }

  get stats() {
    return {
      rooms: this.rooms.length,
      players: this.playerRoom.size,
    };
  }
}
