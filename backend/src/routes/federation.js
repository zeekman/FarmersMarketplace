const router = require("express").Router();
const db = require("../db/schema");
const { err } = require("../middleware/error");

// GET /federation?q=name*domain&type=name
// Stellar federation protocol endpoint
router.get("/", (req, res) => {
  const { q, type } = req.query;

  if (type !== "name") {
    return res.status(400).json({ detail: "Only type=name is supported" });
  }

  if (!q || !q.includes("*")) {
    return res
      .status(400)
      .json({
        detail: "Invalid federation address format. Expected name*domain",
      });
  }

  const [username] = q.split("*");
  const name = username.toLowerCase();

  const user = db
    .prepare(
      "SELECT stellar_public_key, federation_name FROM users WHERE federation_name = ?",
    )
    .get(name);

  if (!user || !user.stellar_public_key) {
    return res.status(404).json({ detail: "Not found" });
  }

  res.json({
    stellar_address: q,
    account_id: user.stellar_public_key,
  });
});

module.exports = router;
