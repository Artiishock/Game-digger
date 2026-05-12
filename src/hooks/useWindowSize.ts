import { useState, useEffect } from 'react'

function readVisualSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 }
  const vv = window.visualViewport
  if (vv && vv.width >= 32 && vv.height >= 32) {
    return { width: Math.round(vv.width), height: Math.round(vv.height) }
  }
  return { width: window.innerWidth, height: window.innerHeight }
}

export function useWindowSize() {
  const [size, setSize] = useState(readVisualSize)

  useEffect(() => {
    const handler = () => setSize(readVisualSize())
    window.addEventListener('resize', handler)
    window.addEventListener('orientationchange', handler)
    const vv = window.visualViewport
    vv?.addEventListener('resize', handler)
    vv?.addEventListener('scroll', handler)
    return () => {
      window.removeEventListener('resize', handler)
      window.removeEventListener('orientationchange', handler)
      vv?.removeEventListener('resize', handler)
      vv?.removeEventListener('scroll', handler)
    }
  }, [])

  return size
}
