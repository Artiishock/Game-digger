import React, { type ReactNode } from 'react'
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'

interface Props {
  children: ReactNode;
}

function AppErrorFallback({ resetErrorBoundary }: FallbackProps) {
  return (
    <div className="ui-error-boundary ui-error-boundary--app" role="alert">
      <div className="ui-error-boundary__content">
        <h1>Something went wrong</h1>
        <p>The app crashed, but the page is still alive.</p>
        <div className="ui-error-boundary__actions">
          <button type="button" onClick={resetErrorBoundary}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}

export function AppErrorBoundary({ children }: Props) {
  return (
    <ErrorBoundary
      FallbackComponent={AppErrorFallback}
      onError={(error, info) => {
        console.error('[AppErrorBoundary]', error, info)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}
