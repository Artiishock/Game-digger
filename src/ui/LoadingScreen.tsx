import React from 'react'
import { resolvePublicUrl } from '../utils/publicUrl'

interface Props {
  progress: number // 0–1
}

const bgUrl     = resolvePublicUrl('rules/background.png')
const bannerUrl = resolvePublicUrl('rules/banner_logo.png')

export const LoadingScreen: React.FC<Props> = ({ progress }) => {
  const clipTop = Math.max(0, Math.min(100, (1 - progress) * 100))

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>

      {/* ── Background ── */}
      <img
        src={bgUrl}
        alt=""
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: 'center',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      />

      {/* ── Banner centered ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ position: 'relative', width: 'clamp(200px, 60vw, 380px)' }}>

          {/* Silhouette layer — темная форма баннера */}
          <img
            src={bannerUrl}
            alt=""
            style={{
              display: 'block',
              width: '100%',
              filter: 'brightness(0.15) saturate(0)',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />

          {/* Fill layer — цветной баннер, открывается снизу вверх */}
          <img
            src={bannerUrl}
            alt=""
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              clipPath: `inset(${clipTop}% 0 0 0)`,
              transition: 'clip-path 0.35s ease',
              userSelect: 'none',
              pointerEvents: 'none',
            }}
          />

        </div>
      </div>

    </div>
  )
}
