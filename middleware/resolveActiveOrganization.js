const { db } = require('../config/database');

/**
 * If no organization has been resolved from subdomain/query,
 * but the user is logged in, resolve org context from ct_users.active_organization_id.
 *
 * This keeps existing org-scoped endpoints working even when the frontend
 * isn't passing ?org=... (since org selection is now account-driven).
 */
async function resolveActiveOrganization(req, _res, next) {
  try {
    if (req.organization) return next();
    const userId = req.user?.userId;
    if (!userId) return next();

    const userResult = await db.query(
      `SELECT active_organization_id FROM ct_users WHERE id = $1`,
      [userId]
    );
    const activeOrgId = userResult.rows[0]?.active_organization_id;
    if (!activeOrgId) return next();

    const orgResult = await db.query(
      `SELECT * FROM ct_organizations WHERE id = $1 AND is_active = TRUE`,
      [activeOrgId]
    );
    if (orgResult.rows.length === 0) return next();

    req.organization = orgResult.rows[0];
    return next();
  } catch (e) {
    console.error('resolveActiveOrganization error:', e);
    return next();
  }
}

module.exports = { resolveActiveOrganization };


