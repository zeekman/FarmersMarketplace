// #1199 – Navbar unread-message badge driven by the messages SSE stream
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Navbar from '../components/Navbar';
import { api } from '../api/client';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Alice', role: 'buyer' }, logout: vi.fn() }),
}));
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn(), useSystemTheme: vi.fn(), isUsingSystemTheme: false }),
}));
vi.mock('../api/client', () => ({
  api: {
    getNetwork: vi.fn(() => Promise.resolve({ network: 'testnet' })),
    getUnreadMessageCount: vi.fn(),
    getMessagesStreamUrl: vi.fn(() => '/api/messages/events?token=test'),
  },
}));

class MockEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = {};
    MockEventSource.instances.push(this);
  }
  addEventListener(type, cb) {
    (this.listeners[type] ||= []).push(cb);
  }
  removeEventListener() {}
  close() {}
  emit(type, data) {
    (this.listeners[type] || []).forEach(cb => cb({ data: JSON.stringify(data) }));
  }
}
MockEventSource.instances = [];

describe('Navbar unread-message badge (#1199)', () => {
  let originalEventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = MockEventSource;
    MockEventSource.instances = [];
    api.getUnreadMessageCount.mockReset();
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
  });

  it('renders no badge when there are no unread messages', async () => {
    api.getUnreadMessageCount.mockResolvedValue({ count: 0 });
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    await waitFor(() => expect(api.getUnreadMessageCount).toHaveBeenCalled());
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the fetched unread count and increments live on a new_message SSE event', async () => {
    api.getUnreadMessageCount.mockResolvedValue({ count: 2 });
    render(<MemoryRouter><Navbar /></MemoryRouter>);

    expect(await screen.findByRole('status')).toHaveTextContent('2');
    expect(MockEventSource.instances).toHaveLength(1);

    act(() => {
      MockEventSource.instances[0].emit('new_message', { id: 99, content: 'hi' });
    });

    expect(await screen.findByRole('status')).toHaveTextContent('3');
  });

  it('clears the badge after messages are marked read', async () => {
    api.getUnreadMessageCount.mockResolvedValueOnce({ count: 1 });
    render(<MemoryRouter><Navbar /></MemoryRouter>);
    expect(await screen.findByRole('status')).toHaveTextContent('1');

    api.getUnreadMessageCount.mockResolvedValueOnce({ count: 0 });
    act(() => {
      window.dispatchEvent(new CustomEvent('messages:read'));
    });

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
