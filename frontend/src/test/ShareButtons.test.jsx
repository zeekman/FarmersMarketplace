// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import ShareButtons from '../components/ShareButtons';

const mockTrackShareEvent = vi.fn();

vi.mock('../api/client', () => ({
  api: {
    trackShareEvent: (...args) => mockTrackShareEvent(...args),
  },
}));

describe('ShareButtons (#798)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockTrackShareEvent.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    delete navigator.share;
  });

  // --- Native share path ---

  it('shows only the "Share" button when navigator.share is available', () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
      writable: true,
    });

    render(<ShareButtons productId={1} title="Test" url="https://example.com" />);

    expect(screen.getByText('Share')).toBeTruthy();
    expect(screen.queryByText('Twitter/X')).toBeNull();
    expect(screen.queryByText('WhatsApp')).toBeNull();
    expect(screen.queryByText('Copy link')).toBeNull();
  });

  it('calls navigator.share and records the event on native share', async () => {
    const shareMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', {
      value: shareMock,
      configurable: true,
      writable: true,
    });

    render(<ShareButtons productId={42} title="Fresh Tomatoes" url="https://example.com/p/42" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Share'));
    });

    expect(shareMock).toHaveBeenCalledWith({
      title: 'Fresh Tomatoes',
      url: 'https://example.com/p/42',
      text: 'Fresh Tomatoes',
    });
    expect(mockTrackShareEvent).toHaveBeenCalledWith(42, 'native_share');
  });

  it('does not record the event when the native share is aborted', async () => {
    const abortError = new DOMException('Share aborted', 'AbortError');
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockRejectedValue(abortError),
      configurable: true,
      writable: true,
    });

    render(<ShareButtons productId={1} title="Test" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Share'));
    });

    expect(mockTrackShareEvent).not.toHaveBeenCalled();
    expect(screen.queryByText('Share failed')).toBeNull();
  });

  // --- Fallback path (no navigator.share) ---

  it('shows Twitter, WhatsApp, and Copy link when navigator.share is unavailable', () => {
    render(<ShareButtons productId={1} title="Test" url="https://example.com" />);

    expect(screen.queryByText('Share')).toBeNull();
    expect(screen.getByText('Twitter/X')).toBeTruthy();
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(screen.getByText('Copy link')).toBeTruthy();
  });

  it('shows "Copied!" toast on successful copy via navigator.clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<ShareButtons productId={1} title="Test Product" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(writeTextMock).toHaveBeenCalledWith('https://example.com');
    expect(mockTrackShareEvent).toHaveBeenCalledWith(1, 'copy_link');
    expect(screen.getByText('Copied!')).toBeTruthy();
  });

  it('shows error toast when clipboard copy fails', async () => {
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard error'));
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<ShareButtons productId={1} title="Test Product" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(screen.getByText('Failed to copy link')).toBeTruthy();
  });

  it('falls back to execCommand when navigator.clipboard is not available', async () => {
    Object.assign(navigator, { clipboard: undefined });

    const execCommandMock = vi.fn().mockReturnValue(true);
    document.execCommand = execCommandMock;

    render(<ShareButtons productId={1} title="Test Product" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(execCommandMock).toHaveBeenCalledWith('copy');
    expect(screen.getByText('Copied!')).toBeTruthy();
  });

  it('shows error toast when execCommand fallback fails', async () => {
    Object.assign(navigator, { clipboard: undefined });

    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('execCommand failed');
    });

    render(<ShareButtons productId={1} title="Test Product" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(screen.getByText('Failed to copy link')).toBeTruthy();
  });

  it('toast disappears after 2 seconds', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<ShareButtons productId={1} title="Test Product" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(screen.getByText('Copied!')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    expect(screen.queryByText('Copied!')).toBeNull();
  });

  it('works without productId — skips backend call', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<ShareButtons title="Test" url="https://example.com" />);

    await act(async () => {
      fireEvent.click(screen.getByText('Copy link'));
    });

    expect(mockTrackShareEvent).not.toHaveBeenCalled();
    expect(screen.getByText('Copied!')).toBeTruthy();
  });
});
