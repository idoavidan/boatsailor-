import { RaceState } from "../protocol";

/** How the wind dial is oriented (cycled by clicking the widget). */
type WindMode = "bow" | "wind" | "compass";

/**
 * The in-game heads-up display. Pure DOM, driven each frame by the Game.
 * Shows speed, player count, a wind compass, and (in speed mode) the race
 * banner, lap/timer line, and end-of-race standings.
 */
export class HUD {
  private root = el("hud");
  private players = el("players");
  private windEl = el("wind");
  private windDial = el("wind-dial");
  private windNeedle = el("wind-needle");
  private windLabel = el("wind-label");
  private dialBoom = el("dial-boom");
  private banner = el("race-banner");
  private raceInfo = el("race-info");
  private standings = el("standings");
  private speedo = el("speedo");
  private flow = el("flow-badge");
  private raceOver = el("race-over");
  private raceOverTitle = el("race-over-title");
  private raceOverTable = el("race-over-table");

  /** Dial reference frame, cycled by clicking the widget:
   *  - "bow": boat fixed pointing up, the wind needle orbits (default).
   *  - "wind": wind pinned to the top, boat + polar spectrum rotate under it.
   *  - "compass": world-up — the wind sits at its true bearing and the boat
   *    turns against it, like a compass. */
  private windMode: WindMode = loadWindMode();
  /** Last needle + heading bearings (deg), kept so we can re-orient the dial. */
  private lastNeedleDeg = 0;
  private lastHeadingDeg = 0;

  constructor() {
    this.windEl.title = "Click: cycle bow-up / wind-up / compass";
    this.windEl.addEventListener("click", () => this.cycleWindMode());
    this.applyWindLabel();
  }

  show(): void {
    this.root.classList.remove("hidden");
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
   * Point the wind arrow at the bearing the wind comes FROM (relative to the
   * bow), where it blows in toward the boat — so it reads as wind hitting you,
   * and the colour under it is your speed. `inIrons` rings the dial red when
   * you're pointing inside the no-go zone.
   *
   * The needle always carries its own rotation; each mode then spins the whole
   * dial under it (see {@link applyDialRotation}), so the parts a mode wants
   * pinned fall into place while the rest turn. Needs the boat heading for the
   * compass (world-up) frame.
   */
  setWind(fromAngle: number, heading: number, inIrons: boolean): void {
    // Negate so the dial's left/right matches the chase view (starboard right).
    const deg = (-fromAngle * 180) / Math.PI;
    this.lastNeedleDeg = deg;
    this.lastHeadingDeg = (heading * 180) / Math.PI;
    this.windNeedle.setAttribute("transform", `rotate(${deg} 50 50)`);
    this.applyDialRotation();
    this.windEl.classList.toggle("in-irons", inIrons);
  }

  /** Cycle bow-up → wind-up → compass; remembered across sessions. */
  private cycleWindMode(): void {
    this.windMode =
      this.windMode === "bow"
        ? "wind"
        : this.windMode === "wind"
          ? "compass"
          : "bow";
    try {
      localStorage.setItem("sail.windMode", this.windMode);
    } catch {
      // Private browsing / disabled storage — fine, just don't persist.
    }
    this.applyWindLabel();
    this.applyDialRotation();
  }

  /**
   * Rotate the whole dial (spectrum + boat + boom + needle) into the active
   * frame. The needle's own rotation is already the wind's bearing off the bow,
   * so: bow-up leaves the dial upright (needle orbits); wind-up spins it back by
   * that bearing (needle ends at the top); compass spins it by −heading, so the
   * boat turns to its world heading and the needle lands on the wind's true
   * world bearing.
   */
  private applyDialRotation(): void {
    let s = 0;
    if (this.windMode === "wind") s = -this.lastNeedleDeg;
    else if (this.windMode === "compass") s = -this.lastHeadingDeg;
    this.windDial.style.transform = s ? `rotate(${s}deg)` : "";
  }

  private applyWindLabel(): void {
    this.windLabel.textContent =
      this.windMode === "wind"
        ? "wind ↑"
        : this.windMode === "compass"
          ? "compass"
          : "bow ↑";
  }

  /** Swing the dial's boom out to the trimmed side. `boomAngle` is the rig's
   *  signed ease in radians (the same value that trims the 3D sail). */
  setBoom(boomAngle: number): void {
    // Same handedness flip as the needle, so the dial boom matches the boat's.
    const deg = (-boomAngle * 180) / Math.PI;
    this.dialBoom.setAttribute("transform", `rotate(${deg} 50 45)`);
  }

  /**
   * Flow cue. `surf` (0..1) is how hard you're riding a wave downwind; `groove`
   * (0..1) is how good your upwind VMG is. Surf wins when both are up; the pill
   * brightens/scales with the value and is hidden when neither is happening.
   */
  setFlow(surf: number, groove: number): void {
    let label = "";
    let color = "";
    let intensity = 0;
    if (surf > 0.15) {
      label = "🏄 Surfing";
      color = "#7fe9ff";
      intensity = Math.min(1, surf);
    } else if (groove > 0.35) {
      label = "⛵ In the groove";
      color = "#9be870";
      intensity = Math.min(1, groove);
    }

    if (!label) {
      this.flow.classList.add("hidden");
      return;
    }
    this.flow.textContent = label;
    this.flow.style.color = color;
    this.flow.style.setProperty("--flow", intensity.toFixed(2));
    this.flow.classList.remove("hidden");
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

  /**
   * Full-screen results once everyone has finished: who won up top, then the
   * final order. Shown over the game and left up until the player heads back to
   * the menu (so the server's room reset can't pull it out from under them).
   */
  showRaceOver(race: RaceState, localId: string): void {
    const winner = race.standings[0];
    if (!winner) return;
    this.raceOverTitle.textContent =
      winner.id === localId ? "🎉 You win!" : `🥇 ${escapeHtml(winner.name)} wins!`;
    this.raceOverTable.innerHTML = race.standings
      .map((s, i) => {
        const time = s.finished ? formatTime(s.timeMs ?? 0) : "DNF";
        const you = s.id === localId ? "you" : "";
        return `<tr class="${you}"><td>${medal(i + 1)}</td>
          <td>${escapeHtml(s.name)}</td><td>${time}</td></tr>`;
      })
      .join("");
    this.raceOver.classList.remove("hidden");
  }
}

/** Restore the saved dial orientation (defaults to bow-up). */
function loadWindMode(): WindMode {
  try {
    const v = localStorage.getItem("sail.windMode");
    if (v === "wind" || v === "compass") return v;
  } catch {
    // ignore
  }
  return "bow";
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
