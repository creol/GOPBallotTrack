// auditLog.js — writer for admin_audit_log (Prompt H).
//
// admin_audit_log is append-only (enforced by a trigger; see migration 039).
// This is the first writer — H2 logs sticker-batch generation through it;
// H3-H7 expand coverage to every admin action.
//
// Audit writes must never break the operation being audited: logAdminAction
// swallows and logs its own errors rather than throwing.

const db = require('../db');

/**
 * Append a row to admin_audit_log.
 *
 * @param {object}  entry
 * @param {number} [entry.adminUserId] - admin_users.id (null for unauthenticated events)
 * @param {string}  entry.action       - short action key, e.g. 'sticker_batch.generate'
 * @param {string} [entry.targetType]  - e.g. 'election', 'sticker_batch'
 * @param {number} [entry.targetId]    - id of the target row
 * @param {object} [entry.details]     - arbitrary JSON detail
 * @param {string} [entry.ipAddress]   - request IP
 * @returns {Promise<void>}
 */
async function logAdminAction({ adminUserId = null, action, targetType = null, targetId = null, details = null, ipAddress = null }) {
  try {
    await db.query(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, details_json, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminUserId, action, targetType, targetId, details ? JSON.stringify(details) : null, ipAddress]
    );
  } catch (err) {
    // Never let an audit-log failure abort the audited operation.
    console.error('[auditLog] failed to write audit entry:', action, err.message);
  }
}

/**
 * Convenience: derive adminUserId + ipAddress from an Express request
 * (requireAuth populates req.session) and append an entry.
 */
async function logFromRequest(req, action, { targetType, targetId, details } = {}) {
  return logAdminAction({
    adminUserId: req.session?.user_id ?? null,
    action,
    targetType,
    targetId,
    details,
    ipAddress: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
  });
}

module.exports = { logAdminAction, logFromRequest };
