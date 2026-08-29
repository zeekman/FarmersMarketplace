const express = require("express");
const router = express.Router();
const requireAdmin = require("../middleware/requireAdmin");
const { writeAuditLog } = require("../utils/auditLog");
const db = require("../db/schema");
const logger = require("../logger");

// POST /api/admin/users/:id/ban
router.post("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const { rows } = await db.query(
      `SELECT id, role, banned_at, ban_reason FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    if (user.role === "admin") return res.status(400).json({ error: "Cannot ban an admin account." });
    if (user.banned_at) return res.status(409).json({ error: "User is already banned." });

    const bannedAt = new Date();
    await db.query(
      `UPDATE users SET banned_at = $1, ban_reason = $2 WHERE id = $3`,
      [bannedAt, reason || null, id]
    );

    await writeAuditLog({
      adminId: req.user.id,
      action: "ban_user",
      targetType: "user",
      targetId: id,
      before: { banned_at: null, ban_reason: null },
      after: { banned_at: bannedAt.toISOString(), ban_reason: reason || null },
    });

    res.json({ message: `User ${id} has been banned.`, banned_at: bannedAt, reason: reason || null });
  } catch (err) {
    logger.error("ban user error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error." });
  }
});

// DELETE /api/admin/users/:id/ban
router.delete("/users/:id/ban", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      `SELECT id, banned_at, ban_reason FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "User not found." });
    if (!user.banned_at) return res.status(409).json({ error: "User is not banned." });

    await db.query(`UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = $1`, [id]);

    await writeAuditLog({
      adminId: req.user.id,
      action: "unban_user",
      targetType: "user",
      targetId: id,
      before: { banned_at: user.banned_at, ban_reason: user.ban_reason || null },
      after: { banned_at: null, ban_reason: null },
    });

    res.json({ message: `User ${id} has been unbanned.` });
  } catch (err) {
    logger.error("unban user error", { error: err.message, stack: err.stack });
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
