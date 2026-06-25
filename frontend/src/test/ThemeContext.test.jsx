import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';

function Consumer() {
  const { theme, toggleTheme, useSystemTheme, isUsingSystemTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="system">{String(isUsingSystemTheme)}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={useSystemTheme}>system</button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ThemeProvider>
      <Consumer />
    </ThemeProvider>
  );
}

describe('ThemeContext (#450)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Default: no OS preference
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
  });

  it('defaults to light when no localStorage and no OS preference', () => {
    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('defaults to dark when OS prefers dark and no localStorage', () => {
    window.matchMedia.mockReturnValue({ matches: true });
    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('persists theme to localStorage on toggle', async () => {
    renderWithProvider();
    await act(async () => { screen.getByText('toggle').click(); });
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('restores theme from localStorage on mount (simulates reload)', () => {
    localStorage.setItem('theme', 'dark');
    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('localStorage value takes precedence over OS preference', () => {
    localStorage.setItem('theme', 'light');
    window.matchMedia.mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('resets to system theme when requested', async () => {
    localStorage.setItem('theme', 'dark');
    window.matchMedia.mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    });
    renderWithProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    await act(async () => { screen.getByText('system').click(); });
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('system').textContent).toBe('true');
    expect(localStorage.getItem('theme')).toBeNull();
  });
});
