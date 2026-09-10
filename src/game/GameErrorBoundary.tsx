import React, { type ReactNode } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

interface Props {
  children: ReactNode;
}

function GameErrorFallback() {
  return (
    <div className="ui-error-boundary ui-error-boundary--game" role="alert">
      <div className="ui-error-boundary__content">
        <h2>Game error</h2>
        <p>The game renderer crashed. Reload the page to recover.</p>
        <div className="ui-error-boundary__actions">
          <button type="button" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      </div>
    </div>
  )
}

export function GameErrorBoundary({ children }: Props) {
  return (
    <ErrorBoundary
      FallbackComponent={GameErrorFallback}
      onError={(error, info) => {
        console.error('[GameErrorBoundary]', error, info)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
