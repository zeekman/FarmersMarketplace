const EventEmitter = require('events');

// Pub/sub abstraction so realtime fan-out works across processes/instances.
// When REDIS_URL is set we use Redis pub/sub; otherwise we fall back to an
// in-process EventEmitter (single-instance / tests).
//
// Usage:
//   const realtime = require('../utils/realtime');
//   realtime.subscribe('messages', (event, data) => { ... });
//   realtime.publish('messages', 'new_message', payload);

const CHANNEL_PREFIX = 'realtime:';

const local = new EventEmitter();
local.setMaxListeners(0);

let publisher = null;
let subscriber = null;
let ready = false;

function channelName(channel) {
  return `${CHANNEL_PREFIX}${channel}`;
}

function init() {
  if (ready) return;
  ready = true;

  const url = process.env.REDIS_URL;
  if (!url) return; // in-memory mode

  let Redis;
  try {
    Redis = require('ioredis');
  } catch {
    // ioredis not installed — stay in-memory rather than crash the process.
    return;
  }

  publisher = new Redis(url);
  subscriber = new Redis(url);

  subscriber.on('message', (channel, message) => {
    if (!channel.startsWith(CHANNEL_PREFIX)) return;
    const name = channel.slice(CHANNEL_PREFIX.length);
    let parsed;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    local.emit(name, parsed.event, parsed.data);
  });

  subscriber.psubscribe(`${CHANNEL_PREFIX}*`).catch(() => {
    // If subscription fails we degrade to in-memory delivery.
  });
}

// Register a local handler for a channel. Every process registers its own
// handlers, so a published event is delivered to local subscribers everywhere.
function subscribe(channel, handler) {
  init();
  local.on(channel, handler);
  return () => local.off(channel, handler);
}

// Publish an event. With Redis this fans out to all instances; each instance
// then delivers to its own local subscribers via the subscriber above.
function publish(channel, event, data) {
  init();
  if (publisher) {
    publisher
      .publish(channelName(channel), JSON.stringify({ event, data }))
      .catch(() => {
        // Fall back to local delivery if the publish fails.
        local.emit(channel, event, data);
      });
    return;
  }
  local.emit(channel, event, data);
}

async function close() {
  for (const client of [publisher, subscriber]) {
    if (!client) continue;
    try { await client.quit(); } catch { client.disconnect(); }
  }
  publisher = null;
  subscriber = null;
  ready = false;
}

module.exports = { subscribe, publish, close };
