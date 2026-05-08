import React from 'react'
import { useGameStore } from '../../store/gameStore'
import { t, T } from '../../i18n/t'
import '../ui.css'

export const ErrorScreen: React.FC = () => {
  const errorMsg = useGameStore(s => s.errorMsg)
  return (
    <div className="ui-error-screen">
      <div className="ui-error-icon">⚠️</div>
      <div className="ui-error-title">{T('connection error')}</div>
      <div className="ui-error-msg">
        {errorMsg || t('error message')}
      </div>
      <button className="ui-error-reload" onClick={() => window.location.reload()}>
        {t('refresh')}
      </button>
    </div>
  )
}
