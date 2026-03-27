import React from 'react'
import { useGameStore } from '../../store/gameStore'

export const ErrorScreen: React.FC = () => {
  const errorMsg = useGameStore(s => s.errorMsg)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 500,
      background: '#1A0E08',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 16, color: '#F0E6D3', padding: 24,
    }}>
      <div style={{ fontSize: 52 }}>⚠️</div>
      <div style={{
        fontFamily: 'Bebas Neue, sans-serif',
        fontSize: 28, color: '#FF4500', letterSpacing: '.05em',
      }}>
        ОШИБКА СОЕДИНЕНИЯ
      </div>
      <div style={{
        fontSize: 14, color: 'rgba(240,230,211,0.6)',
        textAlign: 'center', maxWidth: 300, lineHeight: 1.6,
      }}>
        {errorMsg || 'Произошла ошибка. Попробуйте обновить страницу.'}
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8, padding: '12px 32px',
          background: 'rgba(255,184,48,0.15)',
          border: '1.5px solid #FFB830',
          borderRadius: 12, color: '#FFB830',
          fontSize: 13, fontWeight: 700,
          letterSpacing: '.1em', cursor: 'pointer',
          textTransform: 'uppercase',
        }}
      >
        Обновить
      </button>
    </div>
  )
}
