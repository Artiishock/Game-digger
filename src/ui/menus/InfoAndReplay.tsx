import React from "react";
import { useGameStore } from "../../store/gameStore";

// ─── Info Panel ────────────────────────────────────────────────────────────────

export const InfoPanel: React.FC = () => (
  <div className="info-panel">
    {/* HOW TO PLAY */}
    <section className="info-section">
      <h3 className="info-section-title">How to Play</h3>

      <div className="info-section-content">
        <p className="info-text">
          Choose your bet amount using the controls in the “Bet” field and press
          the “Start” button. The character will begin the descent. At the start
          of each round, the multiplier is always x1.0.
        </p>

        <p className="info-text">
          During the descent, the character may encounter bombs, rocks, coins,
          gold nuggets, or diamonds. A bomb halves the current multiplier, rocks
          subtract from it, coins and gold nuggets increase it, and diamonds
          multiply the current multiplier by their value.
        </p>

        <p className="info-text">
          If the character reaches the house without falling into lava, the
          player wins, and all multipliers are applied to the bet. If the
          character hits lava, the bet is lost.
        </p>
      </div>
    </section>

    {/* MULTIPLIERS */}
    <section className="info-section">
      <h3 className="info-section-title">Multiplier Objects</h3>

      <div className="info-list">
        <div className="info-list-row">
          <span className="info-list-label">Coins</span>
          <span className="info-list-value">+1 / +2 / +3 / +5 / +10</span>
        </div>

        <div className="info-list-row">
          <span className="info-list-label">Gold Nuggets</span>
          <span className="info-list-value">+1 / +2 / +3 / +4</span>
        </div>

        <div className="info-list-row">
          <span className="info-list-label">Diamonds</span>
          <span className="info-list-value">x2 / x3 / x4 / x5</span>
        </div>

        <div className="info-list-row">
          <span className="info-list-label">Rocks</span>
          <span className="info-list-value">-1 / -2 / -3 / -4</span>
        </div>

        <div className="info-list-row">
          <span className="info-list-label">Bomb</span>
          <span className="info-list-value">÷2</span>
        </div>
      </div>
    </section>

    {/* WIN / LOSE */}
    <section className="info-section">
      <h3 className="info-section-title">Win & Loss</h3>

      <div className="info-section-content">
        <p className="info-text">
          <span className="info-text-strong">Win:</span> The character
          successfully reaches the house without touching lava — your result is
          counted as a win.
        </p>

        <p className="info-text">
          <span className="info-text-strong">Loss:</span> The round ends in a
          loss if the character falls into lava.
        </p>
      </div>
    </section>

    {/* RULES */}
    <section className="info-section">
      <h3 className="info-section-title">Rules</h3>

      <div className="info-section-content">
        <p className="info-text">
          The maximum win is capped at x250 of your bet.
        </p>

        <p className="info-text">
          If your win exceeds your bet, it is rounded up to the nearest whole
          number. If it is lower than your bet, it is rounded down.
        </p>

        <p className="info-text">
          Opening the rules during a round will pause the game.
        </p>
      </div>
    </section>

    {/* AUTOPLAY */}
    <section className="info-section">
      <h3 className="info-section-title">Autoplay</h3>

      <div className="info-section-content">
        <p className="info-text">
          The game includes an autoplay mode. Press the “Auto” (A) button and
          select the number of rounds. Press it again to stop autoplay.
        </p>

        <p className="info-text">You can also configure stop conditions:</p>

        <ul className="info-bullet-list">
          <li>On any win</li>
          <li>If a single win exceeds a set amount</li>
          <li>If balance increases by a set amount</li>
          <li>If balance decreases by a set amount</li>
        </ul>
      </div>
    </section>

    {/* SETTINGS */}
    <section className="info-section">
      <h3 className="info-section-title">Settings</h3>

      <div className="info-section-content">
        <p className="info-text">
          You can adjust character speed using the four buttons (turtle, human,
          rabbit, horse).
        </p>

        <p className="info-text">The menu provides:</p>

        <ul className="info-bullet-list">
          <li>Music and sound volume control</li>
          <li>Moving the “Start” button anywhere on screen</li>
          <li>Battery saver mode (reduces visual effects)</li>
        </ul>

        <p className="info-text">
          You can also access rules and history from this menu.
        </p>
      </div>
    </section>

    {/* RTP */}
    <section className="info-section">
      <h3 className="info-section-title">Return to Player</h3>
      <p className="info-text">The overall RTP is 96.7%.</p>
    </section>

    {/* GENERATION */}
    <section className="info-section">
      <h3 className="info-section-title">Path Generation</h3>

      <ul className="info-bullet-list">
        <li>The character's path is randomly generated each round.</li>
        <li>
          Objects are generated at the moment the “Start” button is pressed.
        </li>
      </ul>
    </section>

    {/* EXTRA */}
    <section className="info-section">
      <h3 className="info-section-title">Additional Information</h3>

      <p className="info-text">
        In case of technical issues, all rounds and winnings may be voided.
        Every 24 hours, unfinished rounds are automatically resolved.
      </p>

      <p className="info-text">
        If a “Collect” option is available, winnings are credited automatically.
        Otherwise, results are calculated as if the player chose the safest
        option.
      </p>

      <p className="info-version">
        Rules version 1.0 (April 26, 2026). Game version 1.0.0.
      </p>
    </section>
  </div>
);

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({
  title,
  children,
}) => (
  <section className="info-section">
    <h3 className="info-section-title">{title}</h3>
    <div className="info-section-content">{children}</div>
  </section>
);

const Gold: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span className="info-accent">{children}</span>
);
const Red: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span className="info-danger">{children}</span>
);

const ObjRow: React.FC<{ emoji: string; name: string; desc: string }> = ({
  emoji,
  name,
  desc,
}) => (
  <div className="info-object-row">
    <span className="info-object-emoji">{emoji}</span>
    <div className="info-object-text">
      <span className="info-object-name">{name}</span>
      <span className="info-object-desc"> — {desc}</span>
    </div>
  </div>
);

// ─── Replay Panel ──────────────────────────────────────────────────────────────

interface ReplayRound {
  time: string;
  bet: number;
  win: number;
  profit: number;
  balBefore: number;
  balAfter: number;
  currency: string;
}

// In-memory round history (populated by App.tsx after each round)
export const roundHistory: ReplayRound[] = [];

export function addReplayRound(r: ReplayRound) {
  roundHistory.unshift(r);
  if (roundHistory.length > 50) roundHistory.pop();
}

export const ReplayPanel: React.FC = () => {
  if (roundHistory.length === 0) {
    return (
      <div className="replay-panel replay-panel--empty">
        <p className="replay-empty-title">Round history is empty</p>
        <p className="replay-empty-text">Play your first round</p>
      </div>
    );
  }

  return (
    <div className="replay-panel replay-panel--filled">
      <div className="replay-table-wrap">
        <table className="replay-table">
          <thead>
            <tr>
              {[
                "Time",
                "Bet",
                "Win",
                "Profit",
                "Before",
                "After",
                "Currency",
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {roundHistory.map((r, i) => (
              <tr key={i}>
                <td>{r.time}</td>
                <td>{r.bet.toFixed(2)}</td>
                <td className={r.win > 0 ? "replay-win" : "replay-muted"}>
                  {r.win.toFixed(2)}
                </td>
                <td
                  className={
                    r.profit >= 0 ? "replay-profit-plus" : "replay-profit-minus"
                  }
                >
                  {r.profit >= 0 ? "+" : ""}
                  {r.profit.toFixed(2)}
                </td>
                <td>{r.balBefore.toFixed(2)}</td>
                <td>{r.balAfter.toFixed(2)}</td>
                <td>{r.currency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
