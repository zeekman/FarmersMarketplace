import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import InfiniteList from '../components/InfiniteList';
import { useMarkNotificationsRead, useNotificationCount } from '../hooks/queries';
import { queryKeys } from '../lib/queryClient';
import { notificationLink, isUnread } from '../utils/notifications';

const PAGE_SIZE = 20;

const s = {
  page: { maxWidth: 720, margin: '0 auto', padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 },
  btn: { background: '#2d6a4f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 14, minHeight: 44 },
  item: { display: 'flex', justifyContent: 'space-between', gap: 12, padding: 14, borderRadius: 8, background: 'var(--color-surface, #fff)', boxShadow: '0 1px 4px #0001', marginBottom: 8 },
  link: { textDecoration: 'none', color: 'inherit', flex: 1 },
  small: { background: 'none', border: '1px solid #2d6a4f', color: '#2d6a4f', borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, alignSelf: 'center' },
};

export default function Notifications() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const unreadOnly = searchParams.get('unread') === '1';
  const count = useNotificationCount().data ?? 0;
  const { mutate: markRemote } = useMarkNotificationsRead();

  const list = useInfiniteQuery({
    queryKey: queryKeys.notificationList(unreadOnly),
    queryFn: ({ pageParam }) => api.getNotifications({
      limit: PAGE_SIZE,
      ...(pageParam && { cursor: pageParam }),
      ...(unreadOnly && { unread: 1 }),
    }),
    initialPageParam: null,
    getNextPageParam: (last) => last?.next_cursor ?? last?.nextCursor ?? null,
  });

  const items = list.data?.pages.flatMap((p) => p?.data ?? []) ?? [];

  function toggleUnread(on) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (on) params.set('unread', '1'); else params.delete('unread');
      return params;
    }, { replace: true });
  }

  const query = {
    items,
    hasMore: Boolean(list.hasNextPage),
    loading: list.isPending,
    loadingMore: list.isFetchingNextPage,
    error: list.error ? { message: t('notificationCenter.loadError') } : null,
    loadMore: () => { if (!list.isFetchingNextPage) list.fetchNextPage(); },
    retry: () => list.refetch(),
  };

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={{ margin: 0, fontSize: 24 }}>{t('notificationCenter.title')}</h1>
        <button type="button" style={s.btn} onClick={() => markRemote(undefined)} disabled={count === 0}>
          {t('notificationCenter.markAllRead')}
        </button>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 14, marginBottom: 8 }}>
        <input type="checkbox" checked={unreadOnly} onChange={(e) => toggleUnread(e.target.checked)} />
        {t('notificationCenter.unreadOnly')}
      </label>
      <p role="status" style={{ fontSize: 13, color: '#666' }}>{t('notificationCenter.unreadCount', { count })}</p>
      <InfiniteList
        query={query}
        emptyText={t('notificationCenter.empty')}
        renderItem={(n) => (
          <div style={{ ...s.item, borderLeft: isUnread(n) ? '4px solid #2d6a4f' : '4px solid transparent' }}>
            <Link to={notificationLink(n)} style={s.link} onClick={() => { if (isUnread(n)) markRemote(n.id); }}>
              <div style={{ fontWeight: isUnread(n) ? 700 : 400 }}>{n.title}</div>
              {n.body && <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{n.body}</div>}
              {n.created_at && <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{new Date(n.created_at).toLocaleString()}</div>}
            </Link>
            {isUnread(n) && (
              <button type="button" style={s.small} onClick={() => markRemote(n.id)}>
                {t('notificationCenter.markRead')}
              </button>
            )}
          </div>
        )}
      />
    </div>
  );
}
