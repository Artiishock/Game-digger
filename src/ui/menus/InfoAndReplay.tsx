import React from 'react'
import { useGameStore } from '../../store/gameStore'

// ─── Info Panel ────────────────────────────────────────────────────────────────

export const InfoPanel: React.FC = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: 'rgba(240,230,211,0.75)', fontSize: 16, lineHeight: 1.65 }}>
    <Section title="КАК ИГРАТЬ">
      Выберите размер ставки и нажмите кнопку <Gold>⛏ DIG</Gold>. Персонаж начинает бурить
      землю вниз. На пути он встречает бонусы и дебафы, которые меняют ваш выигрыш.
      <br /><br />
      Игра заканчивается когда персонаж попадает в <Gold>🛏 Безопасное место</Gold> (победа —
      весь накопленный выигрыш ваш) или в <Red>🌋 Лаву</Red> (поражение — ставка сгорает).
    </Section>

    <Section title="ОБЪЕКТЫ">
      <ObjRow emoji="🪙" name="Монета (Coin)"     desc="+N к ставке. Размер зависит от базовой ставки." color="#FFD700" />
      <ObjRow emoji="⛏"  name="Самородок (Gold)"  desc="Пока разрушается — ставка растёт ×3/сек. Случайное время." color="#FFB830" />
      <ObjRow emoji="💎" name="Бриллиант (Diamond)" desc="Мгновенно умножает накопленный выигрыш на X." color="#4ECDC4" />
      <ObjRow emoji="💣" name="Бомба (Bomb)"       desc="Делит накопленный выигрыш пополам ÷2." color="#FF6B6B" />
      <ObjRow emoji="🪨" name="Камень (Stone)"     desc="Пока разрушается — сгорает 5%/сек. Случайное время." color="#AAAAAA" />
      <ObjRow emoji="🌋" name="Лава"               desc="Мгновенное поражение. Весь выигрыш сгорает." color="#FF4500" />
      <ObjRow emoji="🛏" name="Безопасное место"   desc="Победа! Весь накопленный выигрыш сохраняется." color="#7CFC00" />
    </Section>

    <Section title="АВТОСПИН">
      Нажмите кнопку <Gold>A</Gold> чтобы открыть меню автоспина. Установите количество
      раундов и условия автоматической остановки. Нажмите кнопку ещё раз для остановки.
    </Section>

    <Section title="СКОРОСТЬ">
      Четыре режима скорости: 🐢 ×0.75 / 🚶 ×1 / 🐇 ×2 / ⚡ ×5. Доступны в любой момент игры.
    </Section>

    <Section title="RTP И МАКСИМАЛЬНЫЙ ВЫИГРЫШ">
      <div style={{ color: '#FFB830' }}>RTP: 96.0%</div>
      <div>Максимальный выигрыш: 50 000× ставки</div>
    </Section>

    <Section title="ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ">
      <div style={{ fontSize: 13, color: 'rgba(240,230,211,0.5)', lineHeight: 1.5 }}>
        Malfunction voids all wins and plays. A consistent internet connection is required.
        In the event of a disconnection, reload the game to finish any uncompleted rounds.
        The expected return is calculated over many plays. The game display is not
        representative of any physical device and is for illustrative purposes only.
        Winnings are settled according to the amount received from the Remote Game Server
        and not from events within the web browser. TM and © 2026 Stake Engine.
      </div>
    </Section>
  </div>
)

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div>
    <div style={{ fontSize: 16, letterSpacing: '.16em', textTransform: 'uppercase', color: '#FFB830', fontWeight: 700, marginBottom: 8 }}>{title}</div>
    <div>{children}</div>
  </div>
)

const Gold: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span style={{ color: '#FFB830', fontWeight: 700 }}>{children}</span>
)
const Red: React.FC<React.PropsWithChildren> = ({ children }) => (
  <span style={{ color: '#FF4500', fontWeight: 700 }}>{children}</span>
)

const ObjRow: React.FC<{ emoji: string; name: string; desc: string; color: string }> = ({ emoji, name, desc, color }) => (
  <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
    <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.4 }}>{emoji}</span>
    <div>
      <span style={{ color, fontWeight: 700 }}>{name}</span>
      <span style={{ color: 'rgba(240,230,211,0.6)' }}> — {desc}</span>
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
