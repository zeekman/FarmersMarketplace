import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
      errorDetails: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'An unexpected error occurred',
    };
  }

  componentDidCatch(error, errorInfo) {
    // Log error details to console
    console.error('Error caught by ErrorBoundary:', error);
    console.error('Error Info:', errorInfo);

    // Store error details for display
    this.setState({
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        componentStack: errorInfo?.componentStack,
        timestamp: new Date().toISOString(),
      },
    });

    // Optionally log to backend
    this.logErrorToBackend(error, errorInfo);
  }

  logErrorToBackend = (error, errorInfo) => {
    const url = import.meta.env.VITE_ERROR_REPORTING_URL;
    if (!url) return;
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: error?.message || 'Unknown error',
          stack: error?.stack,
          componentStack: errorInfo?.componentStack,
          url: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        }),
      }).catch(e => console.error('Failed to log error to backend:', e));
    } catch (err) {
      console.error('Error logging to backend:', err);
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.errorBox}>
            <div style={styles.icon}>⚠️</div>
            <h1 style={styles.title}>Oops! Something Went Wrong</h1>
            <p style={styles.message}>
              {this.state.errorMessage}
            </p>
            <p style={styles.subtext}>
              The app encountered an unexpected error. Try reloading the page to continue.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.errorDetails && (
              <details style={styles.details}>
                <summary style={styles.summary}>Error Details (Development Only)</summary>
                <pre style={styles.pre}>
                  {JSON.stringify(this.state.errorDetails, null, 2)}
                </pre>
              </details>
            )}

            <button style={styles.button} onClick={this.handleReload}>
              🔄 Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles = {
  container: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f5f5f5 0%, #efefef 100%)',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  errorBox: {
    background: 'white',
    borderRadius: '12px',
    padding: '40px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.1)',
    maxWidth: '500px',
    textAlign: 'center',
  },
  icon: {
    fontSize: '64px',
    marginBottom: '20px',
  },
  title: {
    fontSize: '28px',
    fontWeight: '700',
    color: '#2d2d2d',
    margin: '0 0 16px 0',
  },
  message: {
    fontSize: '16px',
    color: '#555',
    margin: '0 0 12px 0',
    lineHeight: '1.5',
  },
  subtext: {
    fontSize: '14px',
    color: '#999',
    margin: '0 0 24px 0',
    lineHeight: '1.5',
  },
  button: {
    background: '#2d6a4f',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    marginTop: '16px',
  },
  details: {
    marginTop: '20px',
    marginBottom: '20px',
    textAlign: 'left',
    padding: '16px',
    background: '#f9f9f9',
    borderRadius: '8px',
    border: '1px solid #eee',
  },
  summary: {
    cursor: 'pointer',
    fontWeight: '600',
    color: '#333',
    fontSize: '12px',
    userSelect: 'none',
  },
  pre: {
    fontSize: '11px',
    overflow: 'auto',
    background: '#fff',
    border: '1px solid #ddd',
    borderRadius: '4px',
    padding: '12px',
    marginTop: '8px',
    color: '#c0392b',
    fontFamily: 'monospace',
    lineHeight: '1.4',
  },
};

export default ErrorBoundary;
