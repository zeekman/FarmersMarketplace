// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { LoadingProvider, useLoading } from '../context/LoadingContext';

function TestConsumer() {
  const { loading, startLoading, stopLoading } = useLoading();
  return (
    <div>
      <span data-testid="status">{loading ? 'loading' : 'idle'}</span>
      <button data-testid="start" onClick={startLoading}>start</button>
      <button data-testid="stop" onClick={stopLoading}>stop</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <LoadingProvider>
      <TestConsumer />
    </LoadingProvider>
  );
}

describe('LoadingContext (#801)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle', () => {
    renderWithProvider();
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('shows loading after startLoading is called', async () => {
    renderWithProvider();
    await act(async () => { screen.getByTestId('start').click(); });
    expect(screen.getByTestId('status').textContent).toBe('loading');
  });

  it('enforces 300ms minimum display time', async () => {
    renderWithProvider();

    await act(async () => { screen.getByTestId('start').click(); });
    expect(screen.getByTestId('status').textContent).toBe('loading');

    // Stop before 300ms has elapsed
    await act(async () => { screen.getByTestId('stop').click(); });
    // Still loading — minimum time not yet met
    expect(screen.getByTestId('status').textContent).toBe('loading');

    // Advance to just before the 300ms threshold
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(screen.getByTestId('status').textContent).toBe('loading');

    // Cross the threshold
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('hides immediately when stopLoading is called after 300ms have passed', async () => {
    renderWithProvider();

    await act(async () => { screen.getByTestId('start').click(); });
    await act(async () => { vi.advanceTimersByTime(300); });
    // Min time met, still loading (not stopped yet)
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => { screen.getByTestId('stop').click(); });
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('counts concurrent operations — hides only when all have stopped', async () => {
    renderWithProvider();

    await act(async () => { screen.getByTestId('start').click(); }); // count = 1
    await act(async () => { screen.getByTestId('start').click(); }); // count = 2

    await act(async () => { screen.getByTestId('stop').click(); }); // count = 1
    // Advance past min display time
    await act(async () => { vi.advanceTimersByTime(300); });
    // count is still 1 — must stay loading
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => { screen.getByTestId('stop').click(); }); // count = 0
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });

  it('resets correctly for a second loading cycle', async () => {
    renderWithProvider();

    // First cycle
    await act(async () => { screen.getByTestId('start').click(); });
    await act(async () => { vi.advanceTimersByTime(300); });
    await act(async () => { screen.getByTestId('stop').click(); });
    expect(screen.getByTestId('status').textContent).toBe('idle');

    // Second cycle
    await act(async () => { screen.getByTestId('start').click(); });
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => { screen.getByTestId('stop').click(); });
    // Min time not yet met — still loading
    expect(screen.getByTestId('status').textContent).toBe('loading');

    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId('status').textContent).toBe('idle');
  });
});
