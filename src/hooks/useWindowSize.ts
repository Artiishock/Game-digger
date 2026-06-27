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
    let raf = 0
    const handler = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const next = readVisualSize()
        setSize(prev => (
          prev.width === next.width && prev.height === next.height
            ? prev
            : next
        ))
      })
    }
    window.addEventListener('resize', handler)
    window.addEventListener('orientationchange', handler)
    const vv = window.visualViewport
    vv?.addEventListener('resize', handler)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', handler)
      window.removeEventListener('orientationchange', handler)
      vv?.removeEventListener('resize', handler)
    }
  }, [])

  return size
}
