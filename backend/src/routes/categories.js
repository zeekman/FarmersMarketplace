const router = require('express').Router();
const db = require('../db/postgres');

router.get('/', async (req, res) => {
  const result = await db.query('SELECT * FROM categories ORDER BY name');
  res.json(result.rows);
});

module.exports = router;
