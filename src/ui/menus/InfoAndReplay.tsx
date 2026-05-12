import React from "react";
import { t } from "../../i18n/t";
import { useGameStore } from "../../store/gameStore";
import type { RoundEvent } from "../../rgs/client";
import { gameEngine } from "../../game/GameEngine";
import { resolvePublicUrl } from "../../utils/publicUrl";

// ─── Info Panel ────────────────────────────────────────────────────────────────

export const InfoPanel: React.FC = () => (
  <div className="info-panel">
    <section className="info-section">
      <h3 className="info-section-title">{t('how to play')}</h3>
      <div className="info-section-content">
        <p className="info-text">{t('how to play p1')}</p>
        <p className="info-text">{t('how to play p2')}</p>
        <p className="info-text">{t('how to play p3')}</p>
      </div>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('multiplier objects')}</h3>
      <div className="info-list">
        <div className="info-list-row">
          <span className="info-list-label">{t('coins')}</span>
          <span className="info-list-value">+1 / +2 / +3 / +5 / +10</span>
        </div>
        <div className="info-list-row">
          <span className="info-list-label">{t('gold nuggets')}</span>
          <span className="info-list-value">+1 / +2 / +3 / +4</span>
        </div>
        <div className="info-list-row">
          <span className="info-list-label">{t('diamonds')}</span>
          <span className="info-list-value">х2 / x3 / x4 / x5</span>
        </div>
        <div className="info-list-row">
          <span className="info-list-label">{t('rocks')}</span>
          <span className="info-list-value">-1 / -2 / -3 / -4</span>
        </div>
        <div className="info-list-row">
          <span className="info-list-label">{t('bomb')}</span>
          <span className="info-list-value">/2</span>
        </div>
      </div>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('win and loss')}</h3>
      <div className="info-section-content">
        <p className="info-text">
          <span className="info-text-strong">{t('win')}:</span> {t('win desc')}
        </p>
        <p className="info-text">
          <span className="info-text-strong">{t('loss')}:</span> {t('loss desc')}
        </p>
      </div>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('rules')}</h3>
      <div className="info-section-content">
        <p className="info-text">{t('rules p1')}</p>
        <p className="info-text">{t('rules p2')}</p>
        <p className="info-text">{t('rules p3')}</p>
      </div>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('autoplay')}</h3>
      <div className="info-section-content">
        <p className="info-text">{t('autoplay p1')}</p>
        <p className="info-text">{t('autoplay p2')}</p>
        <ul className="info-bullet-list">
          <li>{t('autoplay li1')}</li>
          <li>{t('autoplay li2')}</li>
          <li>{t('autoplay li3')}</li>
          <li>{t('autoplay li4')}</li>
        </ul>
      </div>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('settings section')}</h3>
      <div className="info-section-content">
        <p className="info-text">{t('settings p1')}</p>
        {t('settings p2') && <p className="info-text">{t('settings p2')}</p>}
        <ul className="info-bullet-list">
          {[t('settings li1'), t('settings li2'), t('settings li3')]
            .filter(Boolean)
            .map((item) => <li key={item}>{item}</li>)}
        </ul>
        <p className="info-text">{t('settings p3')}</p>
      </div>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('return to player')}</h3>
      <p className="info-text">{t('rtp value')}</p>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('path generation')}</h3>
      <ul className="info-bullet-list">
        <li>{t('path generation li1')}</li>
        <li>{t('path generation li2')}</li>
      </ul>
    </section>

    <section className="info-section">
      <h3 className="info-section-title">{t('additional information')}</h3>
      <p className="info-text">{t('additional info p1')}</p>
      {t('additional info p2') && <p className="info-text">{t('additional info p2')}</p>}
      <p className="info-version">{t('rules version')}</p>
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
  roundID: string;
  worldSeed: number;
  events: RoundEvent[];
}

// In-memory round history (populated by App.tsx after each round)
export const roundHistory: ReplayRound[] = [

];

export function addReplayRound(r: ReplayRound) {
  roundHistory.unshift(r);
  if (roundHistory.length > 50) roundHistory.pop();
}

const splitReplayTime = (time: string) => {
  const normalized = time.trim().replace(/\s+/g, " ");
  const [date = "", timeValue = ""] = normalized.split(" ");
  return { date, timeValue };
};

export const ReplayPanel: React.FC = () => {
  if (roundHistory.length === 0) {
    return (
      <div className="replay-panel replay-panel--empty">
        <p className="replay-empty-title">{t('plays history empty')}</p>
        <p className="replay-empty-text">{t('come and play / join in the game')}</p>
      </div>
    );
  }

  return (
    <div className="replay-panel replay-panel--filled">
      <div className="replay-table-wrap">
        <div className="replay-table-shell">
          <table className="replay-table">
            <thead>
              <tr>
                {["Time", "Currency", "Bet", "Win", "Replay"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {roundHistory.map((r, i) => {
                const { date, timeValue } = splitReplayTime(r.time);

                return (
                  <tr key={i}>
                    <td className="replay-time-cell">
                      <span>{date}</span>
                      <span>{timeValue}</span>
                    </td>
                    <td>{r.currency}</td>
                    <td>{r.bet.toFixed(2)}</td>
                    <td className={r.win > 0 ? "replay-win" : "replay-muted"}>
                      {r.win.toFixed(2)}
                    </td>
                    <td>
                      <button
                        className="replay-button"
                        onClick={() => gameEngine.startReplay(r.events, r.worldSeed)}
                      >
                        <span
                          className="replay-icon"
                          aria-hidden="true"
                          style={{
                            mask: `url("${resolvePublicUrl("ui/replay_icon.svg")}") center / contain no-repeat`,
                            WebkitMask: `url("${resolvePublicUrl("ui/replay_icon.svg")}") center / contain no-repeat`,
                          }}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
