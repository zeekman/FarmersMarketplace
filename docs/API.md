
## Conventions

Paginated list endpoints return `{ success, data, page, limit, total }`, use a stable `created_at DESC, id DESC` ordering where those columns exist, and include `Link: <…>; rel="next"` when another page is available. SSE endpoints emit a `shutdown` event before the server closes the connection during graceful shutdown.
