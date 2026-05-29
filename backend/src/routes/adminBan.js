const express = require("express");
const router = express.Router();
const requireAdmin = require("../middleware/requireAdmin");

router.post("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const user = await req.db("users").where({ id }).first();
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.role === "admin") return res.status(400).json({ error: "Cannot ban an admin account." });
    if (user.banned_at) return res.status(409).json({ error: "User is already banned." });
    await req.db("users").where({ id }).update({ banned_at: new Date(), ban_reason: reason || null });
    res.json({ message: `User ${id} has been banned.`, banned_at: new Date(), reason: reason || null });
  } catch (err) {
    console.error("ban user error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.delete("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await req.db("users").where({ id }).first();
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!user.banned_at) return res.status(409).json({ error: "User is not banned." });
    await req.db("users").where({ id }).update({ banned_at: null, ban_reason: null });
    res.json({ message: `User ${id} has been unbanned.` });
  } catch (err) {
    console.error("unban user error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
