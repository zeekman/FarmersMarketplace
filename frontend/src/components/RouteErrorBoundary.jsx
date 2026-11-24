import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { captureException } from '../utils/sentry';
import { isChunkLoadError } from './ErrorBoundary';

// Scoped boundaries: a crash here stays inside the route or widget, so the Navbar
// keeps working. The app-level ErrorBoundary remains the last-resort fallback.
function componentNameFrom(errorInfo) {
  return errorInfo?.componentStack?.match(/at (\w+)/)?.[1] || 'unknown';
}

class ScopedErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    const { scope, name } = this.props;
    captureException(error, {
      tags: { scope, [scope]: name, component: componentNameFrom(errorInfo) },
      extra: { componentStack: errorInfo?.componentStack },
    });
  }

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { t, scope, children } = this.props;
    const { error } = this.state;
    // Stale-deploy chunk failures belong to the app-level ErrorBoundary ("refresh" prompt)
    if (error && scope === 'route' && isChunkLoadError(error.message)) throw error;
    if (!error) return children;

    if (scope === 'widget') {
      return (
        <p role="alert" style={styles.widget}>
          {t('errorBoundary.widgetBody')}
        </p>
      );
    }

    return (
      <div role="alert" style={styles.route}>
        <h1 style={styles.title}>{t('errorBoundary.routeTitle')}</h1>
        <p style={styles.message}>{t('errorBoundary.routeBody')}</p>
        <div>
          <button type="button" style={styles.button} onClick={this.handleReset}>
            {t('errorBoundary.tryAgain')}
          </button>
          <Link to="/" style={styles.link}>{t('errorBoundary.goHome')}</Link>
        </div>
      </div>
    );
  }
}

// Resets on navigation: keyed by pathname (not search), so filter changes in the URL don't remount pages.
export function RouteErrorBoundary({ children }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const route = `/${pathname.split('/')[1] ?? ''}`;
  return (
    <ScopedErrorBoundary key={pathname} t={t} scope="route" name={route}>
      {children}
    </ScopedErrorBoundary>
  );
}

export function WidgetErrorBoundary({ name, children }) {
  const { t } = useTranslation();
  return (
    <ScopedErrorBoundary t={t} scope="widget" name={name}>
      {children}
    </ScopedErrorBoundary>
  );
}

const styles = {
  route: {
    padding: '40px 20px',
    textAlign: 'center',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  title: { fontSize: 24, fontWeight: 700, color: '#2d2d2d', margin: '0 0 12px 0' },
  message: { fontSize: 15, color: '#555', margin: '0 0 20px 0', lineHeight: 1.5 },
  button: {
    background: '#2d6a4f',
    color: 'white',
    border: 'none',
    borderRadius: 8,
    padding: '12px 32px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    marginRight: 12,
  },
  link: { color: '#2d6a4f', fontWeight: 600, fontSize: 14 },
  widget: { fontSize: 13, color: '#888', margin: '8px 0', fontStyle: 'italic' },
};
