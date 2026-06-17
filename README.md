# ⛵ Sail

A small browser-based **multiplayer sailing game** built with **three.js** — think
KartRider, but you're crewing sailboats. Two modes:

- **🌊 Casual** — free-roam the open ocean with everyone else, no pressure.
- **🏁 Speed** — a lap race around a buoy course: countdown start, checkpoints,
  lap timer, and a results board.

> Status: early prototype / playable skeleton. Movement is client-authoritative
> for now (the server trusts reported positions). See [Roadmap](#roadmap).

## Structure

```
sail/
├── backend/     TypeScript WebSocket game server (matchmaking, rooms, race logic)
├── frontend/    TypeScript + three.js + Vite client (rendering, physics, UI)
└── package.json npm workspaces: run both with one command
```

The wire protocol and race course live in `protocol.ts`, mirrored byte-for-byte
in `backend/src` and `frontend/src` so client and server can't drift.

## Quick start

Requires Node 18+ (developed on Node 22).

```bash
npm install          # installs both workspaces
npm run dev          # runs backend (:8080) + frontend (:5173) together
```

Then open <http://localhost:5173>, enter a name, pick a mode, and set sail.
To test multiplayer, open a second browser tab (or another device on your LAN —
the Vite dev server is exposed on the network).

Run them separately if you prefer:

```bash
npm run dev:backend
npm run dev:frontend
```

## Controls

| Key             | Action          |
| --------------- | --------------- |
| `W` / `↑`       | Raise sail (go) |
| `S` / `↓`       | Slow / brake    |
| `A` / `←`       | Steer left      |
| `D` / `→`       | Steer right     |

Sailing is wind-aware: running with the wind is fast, beating straight into it
is slow (watch the wind dial, top-right).

## How it works

- **Backend** (`backend/src`) — a `ws` WebSocket server. Players are matchmade by
  mode into `Room`s (max 8). Each room runs a 20 Hz loop that broadcasts player
  snapshots; speed rooms also drive a race state machine
  (`waiting → countdown → racing → finished`) and validate checkpoint order.
- **Frontend** (`frontend/src`) — a Vite + three.js app. `Game.ts` owns the
  scene, a custom GLSL ocean (`Ocean.ts`), boat physics (`Boat.ts`), the chase
  camera, and remote-player interpolation. The DOM HUD/menu live in `ui/`.

## Configuration

| Where                  | Variable          | Default                      |
| ---------------------- | ----------------- | ---------------------------- |
| backend                | `PORT`            | `8080`                       |
| frontend `.env.local`  | `VITE_SERVER_URL` | `ws://<host>:8080`           |

## Build

```bash
npm run build         # backend -> backend/dist, frontend -> frontend/dist
npm run typecheck     # type-check both workspaces
```

## Roadmap

- [ ] Server-authoritative movement + reconciliation (anti-cheat).
- [ ] Server-broadcast wind that shifts over time.
- [ ] Extract `protocol.ts` into a shared workspace package.
- [ ] Collisions between boats and with buoys.
- [ ] Boat selection / customization, sound, mobile controls.

---

🤖 Scaffolded with [Claude Code](https://claude.com/claude-code)
