let Sentry = null;

export async function initSentry() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  try {
    Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
    });
  } catch {
    // Sentry SDK not installed, skip initialization
  }
}

export function captureException(error, extra) {
  if (!Sentry) return;
  Sentry.captureException(error, extra);
}
