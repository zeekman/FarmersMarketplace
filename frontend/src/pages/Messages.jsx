import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useMessageStream } from '../hooks/useMessageStream';
import { queueMessage } from '../utils/draftOutbox';

const MOBILE_QUERY = '(max-width: 767px)';

const s = {
  page: { maxWidth: 1000, margin: '0 auto', padding: 16 },
  layout: { display: 'flex', gap: 16, minHeight: 480 },
  list: { flex: '0 0 300px', background: 'var(--color-surface, #fff)', borderRadius: 10, boxShadow: '0 1px 6px #0001', overflowY: 'auto', listStyle: 'none', margin: 0, padding: 0 },
  convBtn: { display: 'flex', gap: 10, alignItems: 'center', width: '100%', padding: 12, border: 'none', borderBottom: '1px solid #eee', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'inherit' },
  avatar: { width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', background: '#d8f3dc', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  dot: { width: 10, height: 10, borderRadius: '50%', background: '#2d6a4f', flexShrink: 0 },
  thread: { flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--color-surface, #fff)', borderRadius: 10, boxShadow: '0 1px 6px #0001', minWidth: 0 },
  log: { flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8, listStyle: 'none', margin: 0 },
  bubble: { maxWidth: '75%', padding: '8px 12px', borderRadius: 12, fontSize: 14, wordBreak: 'break-word' },
  form: { display: 'flex', gap: 8, padding: 12, borderTop: '1px solid #eee' },
  input: { flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ccc', fontSize: 14, minHeight: 44 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', cursor: 'pointer', fontWeight: 600, minHeight: 44 },
  link: { background: 'none', border: 'none', color: '#2d6a4f', cursor: 'pointer', padding: 4, fontSize: 13 },
};

function useIsMobile() {
  const get = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
  const [mobile, setMobile] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return mobile;
}

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString();
}

let tempId = 0;

// Swaps the optimistic row for the server copy; drops a duplicate if SSE already added it.
function confirmSent(list, pendingTempId, saved) {
  return list
    .filter(m => m.tempId === pendingTempId || saved.id == null || m.id !== saved.id)
    .map(m => (m.tempId === pendingTempId ? { ...m, ...saved, status: 'sent', error: null } : m));
}

export default function Messages() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const toParam = searchParams.get('to');
  const activeId = toParam ? Number(toParam) || toParam : null;

  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const activeRef = useRef(activeId);
  activeRef.current = activeId;

  const loadConversations = useCallback(() => {
    return api.getConversations({ limit: 50 })
      .then(res => setConversations(res?.data || []))
      .catch(() => setError(t('inbox.loadError')))
      .finally(() => setLoadingList(false));
  }, [t]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const markRead = useCallback((otherId) => {
    setConversations(prev => prev.map(c => (String(c.other_user_id) === String(otherId) ? { ...c, unread_count: 0 } : c)));
    return api.markConversationRead(otherId)
      .catch(() => {})
      .finally(() => window.dispatchEvent(new Event('messages:read')));
  }, []);

  useEffect(() => {
    if (activeId == null) { setMessages([]); return undefined; }
    let cancelled = false;
    setLoadingThread(true);
    api.getThread(activeId, { limit: 50 })
      .then(res => { if (!cancelled) setMessages(res?.data || []); })
      .catch(() => { if (!cancelled) setMessages([]); })
      .finally(() => { if (!cancelled) setLoadingThread(false); });
    markRead(activeId);
    return () => { cancelled = true; };
  }, [activeId, markRead]);

  useEffect(() => {
    function onOutboxSent(e) {
      const { tempId: pendingId, message: saved, error } = e.detail || {};
      if (saved) {
        setMessages(prev => confirmSent(prev, pendingId, saved));
        loadConversations();
      } else {
        setMessages(prev => prev.map(m => (m.tempId === pendingId ? { ...m, status: 'failed', error: error || null } : m)));
      }
    }
    window.addEventListener('messages:sent', onOutboxSent);
    return () => window.removeEventListener('messages:sent', onOutboxSent);
  }, [loadConversations]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useMessageStream((type, message) => {
    if (type !== 'new_message' || !message) return;
    const current = activeRef.current;
    if (current != null && String(message.sender_id) === String(current)) {
      setMessages(prev => (prev.some(m => m.id === message.id) ? prev : [...prev, message]));
      markRead(current);
    }
    loadConversations();
  }, { enabled: !!user });

  function openConversation(otherId) {
    setSearchParams({ to: String(otherId) });
  }

  async function deliver(pending) {
    const body = { receiver_id: pending.receiver_id, content: pending.content };
    setMessages(prev => prev.map(m => (m.tempId === pending.tempId ? { ...m, status: 'sending', error: null } : m)));
    try {
      const res = await api.sendMessage(body);
      setMessages(prev => confirmSent(prev, pending.tempId, res?.data || {}));
      loadConversations();
    } catch (e) {
      // A network failure (fetch throws TypeError) means nothing reached the server: park it in the outbox.
      if (e instanceof TypeError) {
        try {
          await queueMessage(pending.tempId, body);
          setMessages(prev => prev.map(m => (m.tempId === pending.tempId ? { ...m, status: 'queued' } : m)));
          return;
        } catch { /* IndexedDB unavailable: fall through to failed */ }
      }
      const error = e.status === 429 && e.retryAfter ? t('inbox.rateLimited', { seconds: e.retryAfter }) : null;
      setMessages(prev => prev.map(m => (m.tempId === pending.tempId ? { ...m, status: 'failed', error } : m)));
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || activeId == null) return;
    const pending = {
      tempId: `tmp-${++tempId}`,
      sender_id: user?.id,
      receiver_id: activeId,
      content,
      created_at: new Date().toISOString(),
      status: 'sending',
    };
    setMessages(prev => [...prev, pending]);
    setDraft('');
    deliver(pending);
  }

  const active = conversations.find(c => String(c.other_user_id) === String(activeId));
  const showList = !isMobile || activeId == null;
  const showThread = !isMobile || activeId != null;

  return (
    <div style={s.page}>
      <h1 style={{ fontSize: 24, marginTop: 0 }}>{t('inbox.title')}</h1>
      {error && <p role="alert" style={{ color: '#c0392b' }}>{error}</p>}
      <div style={s.layout}>
        {showList && (
          <nav aria-label={t('inbox.conversations')} style={{ ...s.list, flex: isMobile ? 1 : s.list.flex }}>
            {loadingList ? (
              <p style={{ padding: 12 }}>{t('inbox.loading')}</p>
            ) : conversations.length === 0 ? (
              <p style={{ padding: 12 }}>{t('inbox.empty')}</p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {conversations.map(c => {
                  const unread = Number(c.unread_count) > 0;
                  const selected = String(c.other_user_id) === String(activeId);
                  return (
                    <li key={c.other_user_id}>
                      <button
                        type="button"
                        style={{ ...s.convBtn, background: selected ? '#d8f3dc' : 'none' }}
                        onClick={() => openConversation(c.other_user_id)}
                        aria-current={selected ? 'true' : undefined}
                        aria-label={unread ? `${c.other_user_name} (${t('inbox.unread')})` : c.other_user_name}
                      >
                        {c.other_user_avatar
                          ? <img src={c.other_user_avatar} alt="" style={s.avatar} />
                          : <span style={s.avatar} aria-hidden="true">{(c.other_user_name || '?')[0]}</span>}
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                            <strong style={{ fontSize: 14 }}>{c.other_user_name}</strong>
                            <span style={{ fontSize: 11, color: '#888' }}>{formatTime(c.last_message_at)}</span>
                          </span>
                          <span style={{ display: 'block', fontSize: 13, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: unread ? 700 : 400 }}>
                            {c.last_message}
                          </span>
                        </span>
                        {unread && <span style={s.dot} aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        )}
        {showThread && (
          <section style={s.thread} aria-label={t('inbox.thread')}>
            {activeId == null ? (
              <p style={{ padding: 16, color: '#666' }}>{t('inbox.selectConversation')}</p>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 12, borderBottom: '1px solid #eee' }}>
                  {isMobile && (
                    <button type="button" style={s.link} onClick={() => setSearchParams({})}>
                      ← {t('inbox.back')}
                    </button>
                  )}
                  <h2 style={{ fontSize: 16, margin: 0 }}>{active?.other_user_name || t('inbox.newConversation')}</h2>
                </div>
                <ol ref={logRef} role="log" aria-live="polite" aria-label={t('inbox.thread')} style={s.log} tabIndex={0}>
                  {loadingThread && messages.length === 0 && <li>{t('inbox.loading')}</li>}
                  {messages.map(m => {
                    const mine = String(m.sender_id) === String(user?.id);
                    return (
                      <li key={m.id ?? m.tempId} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                        <span style={{ ...s.bubble, background: mine ? '#2d6a4f' : '#f1f1f1', color: mine ? '#fff' : '#222', opacity: m.status === 'sending' ? 0.6 : 1 }}>
                          {m.content}
                        </span>
                        <span style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                          {m.status === 'sending' && t('inbox.sending')}
                          {m.status === 'queued' && t('inbox.queued')}
                          {m.status === 'failed' && (
                            <>
                              <span role="alert" style={{ color: '#c0392b' }}>{m.error || t('inbox.failed')}</span>{' '}
                              <button type="button" style={s.link} onClick={() => deliver(m)}>{t('inbox.retry')}</button>
                            </>
                          )}
                          {(!m.status || m.status === 'sent') && formatTime(m.created_at)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <form style={s.form} onSubmit={handleSubmit}>
                  <label htmlFor="message-input" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                    {t('inbox.inputLabel')}
                  </label>
                  <input
                    id="message-input"
                    ref={inputRef}
                    style={s.input}
                    value={draft}
                    maxLength={2000}
                    onChange={e => setDraft(e.target.value)}
                    placeholder={t('inbox.placeholder')}
                  />
                  <button type="submit" style={s.btn} disabled={!draft.trim()}>{t('inbox.send')}</button>
                </form>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
