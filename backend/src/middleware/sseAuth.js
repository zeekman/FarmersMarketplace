'use strict';

const crypto = require('crypto');
const db = require('../db/schema');

// Single-use stream tickets. A ticket is an opaque random ID bound to a user and
// expires after STREAM_TICKET_TTL_MS. It is deleted on first use, so a URL that
// leaks into logs or history cannot be replayed.
const STREAM_TICKET_TTL_MS = 60 * 1000;

// ticket -> { userId, expiresAt }
const streamTickets = new Map();

function issueStreamTicket(userId) {
  const now = Date.now();
  for (const [ticket, entry] of streamTickets) {
    if (entry.expiresAt <= now) streamTickets.delete(ticket);
  }

  const ticket = crypto.randomBytes(32).toString('hex');
  streamTickets.set(ticket, { userId: String(userId), expiresAt: now + STREAM_TICKET_TTL_MS });
  return { ticket, expiresIn: STREAM_TICKET_TTL_MS / 1000 };
}

// Returns the bound user ID, or null if the ticket is unknown or expired.
// The ticket is removed either way.
function consumeStreamTicket(ticket) {
  const entry = streamTickets.get(ticket);
  if (!entry) return null;
  streamTickets.delete(ticket);
  return entry.expiresAt > Date.now() ? entry.userId : null;
}

// Per-user cap on concurrent SSE connections. When exceeded, the oldest
// connection is closed so a single account cannot exhaust server resources
// by opening many tabs.
const MAX_SSE_CONNECTIONS_PER_USER = 5;

// userId -> array of { res, close } entries, oldest first.
const sseConnections = new Map();

function registerSseConnection(userId, res) {
  const key = String(userId);
  let conns = sseConnections.get(key);
  if (!conns) {
    conns = [];
    sseConnections.set(key, conns);
  }

  const entry = { res };
  conns.push(entry);

  // Enforce the cap by closing the oldest connections first.
  while (conns.length > MAX_SSE_CONNECTIONS_PER_USER) {
    const oldest = conns.shift();
    try {
      oldest.res.end();
    } catch (err) {
      // Connection may already be gone; ignore.
    }
  }

  const cleanup = () => {
    const list = sseConnections.get(key);
    if (!list) return;
    const idx = list.indexOf(entry);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) sseConnections.delete(key);
  };

  res.on('close', cleanup);
  res.on('finish', cleanup);

  return cleanup;
}

/**
 * Shared authentication middleware for every SSE endpoint.
 *
 * Only single-use tickets minted by `POST /messages/stream-ticket` are accepted.
 * No JWT is ever read from the query string, so bearer credentials never end up
 * in access logs, proxy logs, browser history or Referer headers.
 *
 * The account must still exist, be active and not banned.
 */
async function sseAuth(req, res, next) {
  const ticket = req.query.ticket;

  if (!ticket) {
    return res.status(401).json({ error: 'Missing stream ticket' });
  }

  const userId = consumeStreamTicket(String(ticket));
  if (!userId) {
    return res.status(401).json({ error: 'Invalid or expired stream ticket' });
  }

  try {
    const { rows } = await db.query(
      'SELECT id, name, role, active, banned_at FROM users WHERE id = $1',
      [userId]
    );
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid stream ticket' });
    }
    if (user.banned_at) {
      return res.status(403).json({ error: 'Account is banned' });
    }
    if (user.active === false) {
      return res.status(403).json({ error: 'Account is not active' });
    }

    req.user = user;
    req.userId = user.id;
    return next();
  } catch (err) {
    return res.status(500).json({ error: 'Failed to authenticate stream ticket' });
  }
}

module.exports = sseAuth;
module.exports.sseAuth = sseAuth;
module.exports.issueStreamTicket = issueStreamTicket;
module.exports.registerSseConnection = registerSseConnection;
module.exports.MAX_SSE_CONNECTIONS_PER_USER = MAX_SSE_CONNECTIONS_PER_USER;
