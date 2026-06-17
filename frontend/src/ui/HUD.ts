import { GameMode, RaceState } from "../protocol";

/**
 * The in-game heads-up display. Pure DOM, driven each frame by the Game.
 * Shows speed, player count, a wind compass, and (in speed mode) the race
 * banner, lap/timer line, and end-of-race standings.
 */
export class HUD {
  private root = el("hud");
  private modeBadge = el("mode-badge");
  private players = el("players");
  private windArrow = el("wind-arrow");
  private banner = el("race-banner");
  private raceInfo = el("race-info");
  private standings = el("standings");
  private speedo = el("speedo");

  show(mode: GameMode): void {
    this.root.classList.remove("hidden");
    this.modeBadge.textContent = mode === "speed" ? "🏁 Speed" : "🌊 Casual";
    this.modeBadge.className = `badge ${mode}`;
  }

  setPlayers(count: number): void {
    this.players.textContent = `⛵ ${count} sailing`;
  }

  setSpeed(speed: number, maxSpeed: number): void {
    const knots = Math.round(speed);
    const pct = Math.min(100, (speed / maxSpeed) * 100);
    this.speedo.innerHTML = `
      <div class="speed-num">${knots}<span>kn</span></div>
      <div class="speed-bar"><div style="width:${pct}%"></div></div>`;
  }

  /** angle = wind direction relative to the boat heading, radians. */
  setWind(angle: number): void {
    this.windArrow.style.transform = `rotate(${angle}rad)`;
  }

  /** Update the race banner / lap / timer / standings for speed mode. */
  setRace(race: RaceState, localId: string, now: number): void {
    if (race.phase === "free") {
      this.banner.className = "hidden";
      this.raceInfo.className = "hidden";
      this.standings.className = "hidden";
      return;
    }

    // Banner
    if (race.phase === "waiting") {
      this.banner.className = "banner-soft";
      this.banner.textContent = `Race starting in ${race.countdown}…`;
    } else if (race.phase === "countdown") {
      this.banner.className = "banner-count";
      this.banner.textContent = race.countdown > 0 ? `${race.countdown}` : "GO!";
    } else if (race.phase === "racing") {
      this.banner.className = "banner-go";
      this.banner.textContent = "GO!";
      // The "GO!" flashes briefly then clears.
      if (race.startedAt && now - race.startedAt > 1200) {
        this.banner.className = "hidden";
      }
    } else if (race.phase === "finished") {
      this.banner.className = "hidden";
    }

    // Lap + timer line
    const me = race.standings.find((s) => s.id === localId);
    if (race.phase === "racing" && me) {
      this.raceInfo.className = "";
      const lap = Math.min(Math.max(me.lap, 1), race.totalLaps);
      const elapsed = race.startedAt ? now - race.startedAt : 0;
      this.raceInfo.innerHTML = `
        <span class="lap">Lap ${lap}/${race.totalLaps}</span>
        <span class="time">${formatTime(elapsed)}</span>`;
    } else {
      this.raceInfo.className = "hidden";
    }

    // Standings (end of race)
    if (race.phase === "finished") {
      this.standings.className = "standings";
      const rows = race.standings
        .map((s, i) => {
          const pos = i + 1;
          const time = s.finished ? formatTime(s.timeMs ?? 0) : "DNF";
          const you = s.id === localId ? " you" : "";
          return `<tr class="${you.trim()}"><td>${medal(pos)}</td>
            <td>${escapeHtml(s.name)}</td><td>${time}</td></tr>`;
        })
        .join("");
      this.standings.innerHTML = `<h2>Results</h2><table>${rows}</table>`;
    } else {
      this.standings.className = "hidden";
    }
  }
}

function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function medal(pos: number): string {
  return ["🥇", "🥈", "🥉"][pos - 1] ?? `${pos}`;
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}
