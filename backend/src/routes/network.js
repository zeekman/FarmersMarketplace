/**
 * Network federation routes.
 *
 * GET  /api/network/identity          → { name, version, public_key }
 * POST /api/network/peers             → register a peer (admin only)
 * GET  /api/network/peers/:peerId/products → proxy peer products (cached 5 min)
 *
 * All outbound requests to peers are signed with an Ed25519 key derived from
 * NETWORK_SIGNING_SECRET (falls back to JWT_SECRET).  The signature is sent as
 * the X-Signature header (hex-encoded), and the signing timestamp as X-Timestamp.
 */

const router = require('express').Router();
const crypto = require('crypto');
const db = require('../db/schema');
const auth = require('../middleware/auth');
const adminAuth = require('../middleware/adminAuth');
const cache = require('../cache');
const { err } = require('../middleware/error');

const APP_NAME = 'FarmersMarketplace';
const APP_VERSION = '1.0.0';
const PEER_CACHE_TTL = 5 * 60; // 5 minutes in seconds

// ---------------------------------------------------------------------------
// Ed25519 key pair — deterministically derived from a secret seed.
// In production set NETWORK_SIGNING_SECRET to a stable, high-entropy value.
// Deterministic Ed25519 key pair from raw seed (Node ≥ 15)
let _keyPair = null;
function keyPair() {
  if (_keyPair) return _keyPair;
  const seed = process.env.NETWORK_SIGNING_SECRET || process.env.JWT_SECRET || 'default-dev-seed';
  const seedBuf = crypto.createHash('sha256').update(seed).digest(); // 32 bytes
  const privateKey = crypto.createPrivateKey({ key: seedBuf, format: 'der', type: 'pkcs8' });
  // Build PKCS8 DER for Ed25519: fixed 16-byte header + 32-byte seed
  const pkcs8Header = Buffer.from('302e020100300506032b657004220420', 'hex');
  const pkcs8Der = Buffer.concat([pkcs8Header, seedBuf]);
  const privKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const pubKey = crypto.createPublicKey(privKey);
  _keyPair = { privKey, pubKey };
  return _keyPair;
}

function publicKeyHex() {
  const { pubKey } = keyPair();
  // SPKI DER for Ed25519 is 44 bytes; last 32 are the raw key
  const spki = pubKey.export({ type: 'spki', format: 'der' });
  return spki.slice(-32).toString('hex');
}

function sign(message) {
  const { privKey } = keyPair();
  return crypto.sign(null, Buffer.from(message), privKey).toString('hex');
}

// ---------------------------------------------------------------------------
// Signed fetch helper
// ---------------------------------------------------------------------------
async function signedFetch(url) {
  const timestamp = Date.now().toString();
  const signature = sign(`GET ${url} ${timestamp}`);
  const res = await fetch(url, {
    headers: {
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Peer responded with ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// GET /api/network/identity
// ---------------------------------------------------------------------------
router.get('/identity', (req, res) => {
  res.json({
    name: APP_NAME,
    version: APP_VERSION,
    public_key: publicKeyHex(),
  });
});

// ---------------------------------------------------------------------------
// POST /api/network/peers  (admin only)
// Body: { url }
// ---------------------------------------------------------------------------
router.post('/peers', adminAuth, async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return err(res, 400, 'url is required', 'validation_error');
  }

  let peerUrl;
  try {
    peerUrl = new URL(url);
  } catch {
    return err(res, 400, 'Invalid peer URL', 'validation_error');
  }

  // Verify peer by fetching its /api/network/identity
  let identity;
  try {
    identity = await signedFetch(`${peerUrl.origin}/api/network/identity`);
  } catch (e) {
    return err(res, 502, `Peer verification failed: ${e.message}`, 'peer_unreachable');
  }

  if (!identity || !identity.name || !identity.public_key) {
    return err(res, 502, 'Peer returned invalid identity response', 'peer_invalid_identity');
  }

  // Upsert peer record
  await db.query(
    `INSERT INTO network_peers (url, name, public_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (url) DO UPDATE SET name = $2, public_key = $3`,
    [peerUrl.origin, identity.name, identity.public_key]
  );

  const { rows } = await db.query(
    'SELECT id, url, name, public_key, created_at FROM network_peers WHERE url = $1',
    [peerUrl.origin]
  );

  res.status(201).json({ success: true, peer: rows[0] });
});

// ---------------------------------------------------------------------------
// GET /api/network/peers/:peerId/products  (authenticated)
// Proxies the peer's /api/products endpoint, caches for 5 min.
// ---------------------------------------------------------------------------
router.get('/peers/:peerId/products', auth, async (req, res) => {
  const { peerId } = req.params;
  const cacheKey = `federation:peer:${peerId}:products`;

  const cached = await cache.get(cacheKey);
  if (cached) return res.json({ success: true, data: cached, cached: true });

  const { rows } = await db.query(
    'SELECT id, url, name, public_key FROM network_peers WHERE id = $1',
    [peerId]
  );
  if (!rows[0]) return err(res, 404, 'Peer not found', 'peer_not_found');

  const peer = rows[0];
  let products;
  try {
    const data = await signedFetch(`${peer.url}/api/products`);
    products = (data.data || data.products || []).map((p) => ({
      ...p,
      source: 'federated',
      peer_id: peer.id,
      peer_name: peer.name,
    }));
  } catch (e) {
    return err(res, 502, `Failed to fetch products from peer: ${e.message}`, 'peer_fetch_error');
  }

  await cache.set(cacheKey, products, PEER_CACHE_TTL);
  res.json({ success: true, data: products });
});

module.exports = router;
