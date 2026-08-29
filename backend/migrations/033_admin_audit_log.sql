-- #1028: Admin audit log
-- Records every sensitive admin action for compliance/security audit trail.
--
-- Columns:
--   admin_id    — ID of the admin who performed the action
--   action      — Short action name, e.g. 'ban_user', 'unban_user', 'resolve_dispute', 'contract_simulate'
--   target_type — Entity type: 'user', 'dispute', 'contract', 'order'
--   target_id   — String ID of the affected entity (nullable for bulk/system actions)
--   before_val  — JSON snapshot of relevant fields before the action (nullable)
--   after_val   — JSON snapshot of relevant fields after the action (nullable)
--   created_at  — Timestamp of the action

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  admin_id    INTEGER  NOT NULL REFERENCES users(id),
  action      TEXT     NOT NULL,
  target_type TEXT     NOT NULL,
  target_id   TEXT,
  before_val  TEXT,
  after_val   TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id
  ON admin_audit_log(admin_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target
  ON admin_audit_log(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at
  ON admin_audit_log(created_at);
