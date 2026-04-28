import React from 'react'
import { useGameStore } from '../../store/gameStore'

// ─── Info Panel ────────────────────────────────────────────────────────────────

export const InfoPanel: React.FC = () => (
  <div className="info-panel">
    <Section title="КАК ИГРАТЬ">
      <p className="info-text">
        Выберите размер ставки и нажмите кнопку <Gold>⛏ DIG</Gold>. Персонаж начинает бурить
        землю вниз. На пути он встречает бонусы и дебафы, которые меняют ваш выигрыш.
      </p>
      <p className="info-text">
        Игра заканчивается когда персонаж попадает в <Gold>🛏 Безопасное место</Gold> (победа —
        весь накопленный выигрыш ваш) или в <Red>🌋 Лаву</Red> (поражение — ставка сгорает).
      </p>
    </Section>

    <Section title="ОБЪЕКТЫ">
      <div className="info-section-content">
        <ObjRow emoji="🪙" name="Монета (Coin)" desc="+N к ставке. Размер зависит от базовой ставки." />
        <ObjRow emoji="⛏" name="Самородок (Gold)" desc="Пока разрушается — ставка растёт ×3/сек. Случайное время." />
        <ObjRow emoji="💎" name="Бриллиант (Diamond)" desc="Мгновенно умножает накопленный выигрыш на X." />
        <ObjRow emoji="💣" name="Бомба (Bomb)" desc="Делит накопленный выигрыш пополам ÷2." />
        <ObjRow emoji="🪨" name="Камень (Stone)" desc="Пока разрушается — сгорает 5%/сек. Случайное время." />
        <ObjRow emoji="🌋" name="Лава" desc="Мгновенное поражение. Весь выигрыш сгорает." />
        <ObjRow emoji="🛏" name="Безопасное место" desc="Победа! Весь накопленный выигрыш сохраняется." />
      </div>
    </Section>

    <Section title="АВТОСПИН">
      <p className="info-text">
        Нажмите кнопку <Gold>A</Gold> чтобы открыть меню автоспина. Установите количество
        раундов и условия автоматической остановки. Нажмите кнопку ещё раз для остановки.
      </p>
    </Section>

    <Section title="СКОРОСТЬ">
      <p className="info-text">
        Четыре режима скорости: 🐢 ×0.75 / 🚶 ×1 / 🐇 ×2 / ⚡ ×5. Доступны в любой момент игры.
      </p>
    </Section>

    <Section title="RTP И МАКСИМАЛЬНЫЙ ВЫИГРЫШ">
      <div className="info-section-content">
        <p className="info-text"><Gold>RTP: 96.0%</Gold></p>
        <p className="info-text">Максимальный выигрыш: 10 000× ставки</p>
      </div>
    </Section>
  </div>
)

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <section className="info-section">
    <h3 className="info-section-title">{title}</h3>
    <div className="info-section-content">{children}</div>
  </section>
)

const Gold: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span className="info-accent">{children}</span>
)
const Red: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span className="info-danger">{children}</span>
)

const ObjRow: React.FC<{ emoji: string; name: string; desc: string }> = ({ emoji, name, desc }) => (
  <div className="info-object-row">
    <span className="info-object-emoji">{emoji}</span>
    <div className="info-object-text">
      <span className="info-object-name">{name}</span>
      <span className="info-object-desc"> — {desc}</span>
    </div>
  </div>
)

// ─── Replay Panel ──────────────────────────────────────────────────────────────

interface ReplayRound {
  time:    string
  bet:     number
  win:     number
  profit:  number
  balBefore: number
  balAfter:  number
  currency:  string
}

// In-memory round history (populated by App.tsx after each round)
export const roundHistory: ReplayRound[] = []

export function addReplayRound(r: ReplayRound) {
  roundHistory.unshift(r)
  if (roundHistory.length > 50) roundHistory.pop()
}

export const ReplayPanel: React.FC = () => {
  if (roundHistory.length === 0) {
    return (
      <div style={{ color: 'rgba(240,230,211,0.4)', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
        История раундов пуста.<br />Сыграйте первый раунд.
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['Время', 'Ставка', 'Выигрыш', 'Профит', 'До', 'После', 'Валюта'].map(h => (
              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#FFB830', fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,184,48,0.15)', fontWeight: 700 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roundHistory.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <td style={tdStyle}>{r.time}</td>
              <td style={tdStyle}>{r.bet.toFixed(2)}</td>
              <td style={{ ...tdStyle, color: r.win > 0 ? '#7CFC00' : 'rgba(240,230,211,0.5)' }}>{r.win.toFixed(2)}</td>
              <td style={{ ...tdStyle, color: r.profit >= 0 ? '#7CFC00' : '#FF6B6B' }}>
                {r.profit >= 0 ? '+' : ''}{r.profit.toFixed(2)}
              </td>
              <td style={tdStyle}>{r.balBefore.toFixed(2)}</td>
              <td style={tdStyle}>{r.balAfter.toFixed(2)}</td>
              <td style={tdStyle}>{r.currency}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const tdStyle: React.CSSProperties = {
  padding: '9px 10px',
  color: 'rgba(240,230,211,0.65)',
  fontVariantNumeric: 'tabular-nums',
}
