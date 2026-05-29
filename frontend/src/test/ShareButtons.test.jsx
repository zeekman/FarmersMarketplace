// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import ShareButtons from '../components/ShareButtons';

describe('ShareButtons (#441)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "Copied!" toast on successful copy via navigator.clipboard', async () => {
    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<ShareButtons title="Test Product" url="https://example.com" />);

    const copyBtn = screen.getByText('Copy link');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextMock).toHaveBeenCalledWith('https://example.com');
    expect(screen.getByText('Copied!')).toBeTruthy();
  });

  it('shows error toast when clipboard copy fails', async () => {
    // Mock clipboard API to reject
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard error'));
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<ShareButtons title="Test Product" url="https://example.com" />);

    const copyBtn = screen.getByText('Copy link');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByText('Failed to copy link')).toBeTruthy();
  });

  it('falls back to execCommand when navigator.clipboard is not available', async () => {
    // Remove clipboard API
    Object.assign(navigator, { clipboard: undefined });

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    render(<ShareButtons title="Test Product" url="https://example.com" />);

    const copyBtn = screen.getByText('Copy link');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(execCommandMock).toHaveBeenCalledWith('copy');
    expect(screen.getByText('Copied!')).toBeTruthy();
  });

  it('shows error toast when execCommand fallback fails', async () => {
    // Remove clipboard API
    Object.assign(navigator, { clipboard: undefined });

    // Make execCommand throw
    const execCommandMock = vi.fn().mockImplementation(() => {
      throw new Error('execCommand failed');
    });
    document.execCommand = execCommandMock;

    render(<ShareButtons title="Test Product" url="https://example.com" />);

    const copyBtn = screen.getByText('Copy link');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByText('Failed to copy link')).toBeTruthy();
  });

  it('toast disappears after 2.5 seconds', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });

    render(<ShareButtons title="Test Product" url="https://example.com" />);

    const copyBtn = screen.getByText('Copy link');
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByText('Copied!')).toBeTruthy();

    // Advance past the 2.5s timeout
    await act(async () => {
      vi.advanceTimersByTime(2600);
    });

    expect(screen.queryByText('Copied!')).toBeNull();
  });
});
