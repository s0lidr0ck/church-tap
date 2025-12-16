const { db } = require('../config/database');

/**
 * Requires that the authenticated user has:
 * - a selected active group (ct_users.active_organization_id)
 * - an ACTIVE membership in that organization
 *
 * Attaches:
 * - req.activeOrganizationId
 * - req.userRecord (basic user fields)
 */
async function requireActiveGroupMembership(req, res, next) {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const userResult = await db.query(
      `SELECT id, email, first_name, last_name, display_name, active_organization_id
       FROM ct_users
       WHERE id = $1`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const user = userResult.rows[0];
    const activeOrganizationId = user.active_organization_id;

    if (!activeOrganizationId) {
      return res.status(403).json({
        success: false,
        error: 'No active group selected',
        code: 'NO_ACTIVE_GROUP'
      });
    }

    const membershipResult = await db.query(
      `
      SELECT status
      FROM ct_user_organization_memberships
      WHERE user_id = $1 AND organization_id = $2
      `,
      [userId, activeOrganizationId]
    );

    const membershipStatus = membershipResult.rows[0]?.status;
    if (membershipStatus !== 'active') {
      return res.status(403).json({
        success: false,
        error: membershipStatus === 'pending' ? 'Membership pending approval' : 'Not a member of this group',
        code: membershipStatus === 'pending' ? 'MEMBERSHIP_PENDING' : 'NOT_A_MEMBER',
        membership_status: membershipStatus || null,
        active_organization_id: activeOrganizationId
      });
    }

    req.activeOrganizationId = activeOrganizationId;
    req.userRecord = user;
    return next();
  } catch (error) {
    console.error('Membership gate error:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
}

module.exports = { requireActiveGroupMembership };


