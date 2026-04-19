import React from 'react'
import { useGameStore } from '../../store/gameStore'
import '../ui.css'

export const ErrorScreen: React.FC = () => {
  const errorMsg = useGameStore(s => s.errorMsg)
  return (
    <div className="ui-error-screen">
      <div className="ui-error-icon">⚠️</div>
      <div className="ui-error-title">ОШИБКА СОЕДИНЕНИЯ</div>
      <div className="ui-error-msg">
        {errorMsg || 'Произошла ошибка. Попробуйте обновить страницу.'}
      </div>
      <button className="ui-error-reload" onClick={() => window.location.reload()}>
        Обновить
      </button>
    </div>
  )
}
