// Last line of defence. Without a boundary, one render error anywhere unmounts
// the whole React tree and leaves a blank page; with it the app shows what broke
// and a way back, and isolated layers (the shared tooltip) fail on their own.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useT } from '../i18n';

interface ErrorBoundaryProps {
  name: string;
  /** Rendered instead of the children after an error; omit to render nothing. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[od-design-preview] ${this.props.name} crashed`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback ? this.props.fallback(error, this.reset) : null;
  }
}

export function CrashScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="odp-crash" role="alert" data-testid="app-crash">
      <div className="odp-crash-card">
        <h1 className="odp-crash-title">{t('app.crashTitle')}</h1>
        <p className="odp-crash-body">{t('app.crashBody')}</p>
        <pre className="odp-crash-detail">{error.message}</pre>
        <div className="odp-crash-actions">
          <button type="button" className="odp-crash-btn" onClick={onRetry}>
            {t('app.crashRetry')}
          </button>
          <button type="button" className="odp-crash-btn odp-crash-btn-primary" onClick={() => window.location.reload()}>
            {t('app.crashReload')}
          </button>
        </div>
      </div>
    </div>
  );
}
