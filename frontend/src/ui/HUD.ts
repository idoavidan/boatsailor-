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
  private windEl = el("wind");
  private windDial = el("wind-dial");
  private windNeedle = el("wind-needle");
  private dialBoom = el("dial-boom");
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

  /**
   * Paint the dial as a polar speed gauge from the boat's sailing polar: red in
   * the no-go zone (±noGoAngle around the bow), warming through orange/yellow to
   * green on a reach. The red wedge is exactly the real no-go, so the gauge is
   * 1:1 with how the boat actually sails. Call once per game.
   */
  setPolar(noGoAngle: number): void {
    const n = (noGoAngle * 180) / Math.PI;
    this.windDial.style.background = `conic-gradient(from 0deg,
      #e25555 0deg, #e25555 ${n}deg,
      #ef9a4a ${n + 12}deg,
      #f2cf63 ${n + 34}deg,
      #5ec98a 88deg,
      #43b877 150deg,
      #57bdbf 180deg,
      #43b877 210deg,
      #5ec98a 272deg,
      #f2cf63 ${360 - n - 34}deg,
      #ef9a4a ${360 - n - 12}deg,
      #e25555 ${360 - n}deg, #e25555 360deg)`;
  }

  /**
   * Orbit the wind arrow around the boat to the bearing the wind comes FROM
   * (relative to the bow, up), where it points in toward the boat — so it reads
   * as wind blowing onto you, and the colour under it is your speed. `inIrons`
   * rings the dial red when you're pointing inside the no-go zone.
   */
  setWind(fromAngle: number, inIrons: boolean): void {
    // Negate so the dial's left/right matches the chase view (starboard right).
    const deg = (-fromAngle * 180) / Math.PI;
    this.windNeedle.setAttribute("transform", `rotate(${deg} 50 50)`);
    this.windEl.classList.toggle("in-irons", inIrons);
  }

  /** Swing the dial's boom out to the trimmed side. `boomAngle` is the rig's
   *  signed ease in radians (the same value that trims the 3D sail). */
  setBoom(boomAngle: number): void {
    // Same handedness flip as the needle, so the dial boom matches the boat's.
    const deg = (-boomAngle * 180) / Math.PI;
    this.dialBoom.setAttribute("transform", `rotate(${deg} 50 45)`);
  }

  /** Update the race banner / lap / timer / standings for speed mode. */
  setRace(race: RaceState, localId: string, now: number): void {
    if (race.phase === "free") {
      this.banner.className = "hidden";
      this.raceInfo.className = "hidden";
      this.standings.className = "hidden";
      return;
    }

    // Banner. Two distinct countdowns: the lobby (waiting for a room to fill)
    // and the actual race-start gun.
    if (race.phase === "waiting") {
      this.banner.className = "banner-soft";
      this.banner.innerHTML = `🔎 Finding racers…
        <span class="banner-sub">race opens in ${race.countdown}s</span>`;
    } else if (race.phase === "countdown") {
      if (race.countdown > 5) {
        // Early pre-start: keep the screen clear so players can manoeuvre.
        this.banner.className = "banner-soft";
        this.banner.innerHTML = `🚩 Pre-start
          <span class="banner-sub">to the line — gun in ${race.countdown}s</span>`;
      } else {
        this.banner.className = "banner-count";
        this.banner.innerHTML =
          race.countdown > 0
            ? `<span class="banner-sub">Race starts in</span>${race.countdown}`
            : "GO!";
      }
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
