import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './dev/demoMathConsole'

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
createRoot(root).render(<App />)