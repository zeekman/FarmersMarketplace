const router = require('express').Router();
const db = require('../db/schema');

// GET /federation?q=name*domain&type=name
// Stellar federation protocol endpoint
router.get('/', async (req, res) => {
  const { q, type } = req.query;

  if (type !== 'name') {
    return res.status(400).json({ detail: 'Only type=name is supported' });
  }

  if (!q || !q.includes('*')) {
    return res.status(400).json({
      detail: 'Invalid federation address format. Expected name*domain',
    });
  }

  const [username] = q.split('*');
  const name = username.toLowerCase();

  try {
    const { rows } = await db.query(
      'SELECT stellar_public_key, federation_name FROM users WHERE federation_name = $1',
      [name]
    );
    const user = rows[0];

    if (!user || !user.stellar_public_key) {
      return res.status(404).json({ detail: 'Not found' });
    }

    res.json({
      stellar_address: q,
      account_id: user.stellar_public_key,
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

module.exports = router;
