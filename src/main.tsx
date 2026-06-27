import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { AppErrorBoundary } from './app/AppErrorBoundary'
import { installTickerFpsLogFromUrl } from './dev/tickerFpsLog'
import { installScratchDebugFromUrl } from './dev/scratchDebug'
import { installStartRoundDebugFromUrl } from './dev/startRoundDebug'
import { installRoundDebugFromUrl } from './dev/roundDebug'
import './dev/demoMathConsole'

installTickerFpsLogFromUrl()
installScratchDebugFromUrl()
installStartRoundDebugFromUrl()
installRoundDebugFromUrl()

if (import.meta.env.DEV) {
  const originalWarn = console.warn.bind(console)
  console.warn = (...args: unknown[]) => {
    const joined = args
      .map((arg) => (typeof arg === 'string' ? arg : ''))
      .join(' ')
    const isPixiRgb2HexDeprecation =
      joined.includes('PixiJS Deprecation Warning') &&
      joined.includes('utils.rgb2hex is deprecated')
    if (isPixiRgb2HexDeprecation) {
      return
    }
    originalWarn(...args)
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')

// NOTE: React.StrictMode is intentionally omitted.
// StrictMode performs a deliberate double-mount (mount→unmount→mount) in
// development to detect side-effects. This breaks WebGL because:
//   1. PixiJS creates a WebGL context on the first mount
//   2. StrictMode destroys it (unmount)
//   3. The second mount tries to create a new context on the same canvas —
//      the browser may return MAX_FRAGMENT_UNIFORM_VECTORS = 0 from the
//      stale context, crashing checkMaxIfStatementsInShader.
// All other React best-practices checks still apply without StrictMode.
createRoot(root).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
)
