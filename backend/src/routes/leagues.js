const router = require('express').Router();
const db     = require('../db/pool');

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query('SELECT * FROM leagues ORDER BY sport, name');
    res.json({ success: true, data: rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
