'use strict';

const clients = new Set();

function register(res) {
  clients.add(res);
  return () => clients.delete(res);
}

function closeAll(event = 'shutdown', data = { reason: 'server_shutdown' }) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
      res.end();
    } catch {
      // The connection may already have closed.
    }
    clients.delete(res);
  }
}

function size() {
  return clients.size;
}

module.exports = { register, closeAll, size };
