import React, { useEffect } from 'react'
import { useGameStore } from '../../store/gameStore'
import '../ui.css'

const TOAST_DURATION_MS = 4000

export const ToastNotification: React.FC = () => {
  const msg   = useGameStore((s) => s.notification)
  const clear = useGameStore((s) => s.clearNotification)

  useEffect(() => {
    if (!msg) return
    const id = setTimeout(clear, TOAST_DURATION_MS)
    return () => clearTimeout(id)
  }, [msg, clear])

  if (!msg) return null

  return (
    <div className="ui-toast" onClick={clear} role="alert" aria-live="assertive">
      <span className="ui-toast-msg">{msg}</span>
    </div>
  )
}
