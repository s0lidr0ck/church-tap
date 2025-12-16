const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');

const router = express.Router();

// List memberships + active org
router.get('/', authenticateUser, async (req, res) => {
  const userId = req.user.userId;

  try {
    const userResult = await db.query(
      `SELECT id, active_organization_id FROM ct_users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const activeOrganizationId = userResult.rows[0].active_organization_id;

    const membershipsResult = await db.query(
      `
      SELECT
        m.organization_id,
        m.status,
        m.joined_at,
        m.left_at,
        m.updated_at,
        o.name AS organization_name,
        o.subdomain AS organization_subdomain,
        o.join_type,
        o.is_active AS organization_is_active
      FROM ct_user_organization_memberships m
      JOIN ct_organizations o ON o.id = m.organization_id
      WHERE m.user_id = $1
      ORDER BY
        (m.organization_id = $2) DESC,
        (m.status = 'active') DESC,
        m.updated_at DESC NULLS LAST,
        m.joined_at DESC NULLS LAST
      `,
      [userId, activeOrganizationId]
    );

    return res.json({
      success: true,
      active_organization_id: activeOrganizationId,
      memberships: membershipsResult.rows
    });
  } catch (error) {
    console.error('Error listing memberships:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Join an organization (open => active, approval_required => pending)
router.post('/join', authenticateUser, async (req, res) => {
  const userId = req.user.userId;
  const { organization_id } = req.body;

  if (!organization_id) {
    return res.status(400).json({ success: false, error: 'organization_id is required' });
  }

  const orgId = Number(organization_id);
  if (!Number.isFinite(orgId)) {
    return res.status(400).json({ success: false, error: 'organization_id must be a number' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const orgResult = await client.query(
      `SELECT id, name, subdomain, join_type, is_active FROM ct_organizations WHERE id = $1`,
      [orgId]
    );
    if (orgResult.rows.length === 0 || orgResult.rows[0].is_active !== true) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Organization not found or inactive' });
    }

    const org = orgResult.rows[0];
    const status = org.join_type === 'approval_required' ? 'pending' : 'active';

    // Upsert membership
    const upsertResult = await client.query(
      `
      INSERT INTO ct_user_organization_memberships (user_id, organization_id, status, joined_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, organization_id)
      DO UPDATE SET
        status = CASE
          WHEN ct_user_organization_memberships.status IN ('left', 'denied') THEN EXCLUDED.status
          ELSE ct_user_organization_memberships.status
        END,
        left_at = CASE
          WHEN ct_user_organization_memberships.status IN ('left', 'denied') THEN NULL
          ELSE ct_user_organization_memberships.left_at
        END,
        updated_at = NOW()
      RETURNING status
      `,
      [userId, orgId, status]
    );

    // Remember last selected group regardless of status (active or pending)
    await client.query(
      `UPDATE ct_users SET active_organization_id = $1 WHERE id = $2`,
      [orgId, userId]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      organization: {
        id: org.id,
        name: org.name,
        subdomain: org.subdomain,
        join_type: org.join_type
      },
      membership: {
        organization_id: orgId,
        status: upsertResult.rows[0]?.status || status
      },
      active_organization_id: orgId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error joining organization:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  } finally {
    client.release();
  }
});

// Switch active organization (must be a member: active or pending)
router.post('/switch', authenticateUser, async (req, res) => {
  const userId = req.user.userId;
  const { organization_id } = req.body;

  if (!organization_id) {
    return res.status(400).json({ success: false, error: 'organization_id is required' });
  }

  const orgId = Number(organization_id);
  if (!Number.isFinite(orgId)) {
    return res.status(400).json({ success: false, error: 'organization_id must be a number' });
  }

  try {
    const membershipResult = await db.query(
      `
      SELECT status
      FROM ct_user_organization_memberships
      WHERE user_id = $1 AND organization_id = $2
      `,
      [userId, orgId]
    );
    if (membershipResult.rows.length === 0 || !['active', 'pending'].includes(membershipResult.rows[0].status)) {
      return res.status(403).json({ success: false, error: 'You are not a member of this organization' });
    }

    await db.query(`UPDATE ct_users SET active_organization_id = $1 WHERE id = $2`, [orgId, userId]);
    return res.json({ success: true, active_organization_id: orgId });
  } catch (error) {
    console.error('Error switching organization:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Leave an organization
router.post('/leave', authenticateUser, async (req, res) => {
  const userId = req.user.userId;
  const { organization_id } = req.body;

  if (!organization_id) {
    return res.status(400).json({ success: false, error: 'organization_id is required' });
  }

  const orgId = Number(organization_id);
  if (!Number.isFinite(orgId)) {
    return res.status(400).json({ success: false, error: 'organization_id must be a number' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT active_organization_id FROM ct_users WHERE id = $1`,
      [userId]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    const activeOrgId = userResult.rows[0].active_organization_id;

    const updateResult = await client.query(
      `
      UPDATE ct_user_organization_memberships
      SET status = 'left', left_at = NOW(), updated_at = NOW()
      WHERE user_id = $1 AND organization_id = $2 AND status IN ('active', 'pending')
      RETURNING organization_id
      `,
      [userId, orgId]
    );

    if (updateResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Active or pending membership not found' });
    }

    let newActiveOrgId = activeOrgId;
    if (Number(activeOrgId) === orgId) {
      const nextOrgResult = await client.query(
        `
        SELECT organization_id
        FROM ct_user_organization_memberships
        WHERE user_id = $1 AND status = 'active'
        ORDER BY updated_at DESC NULLS LAST, joined_at DESC NULLS LAST
        LIMIT 1
        `,
        [userId]
      );
      newActiveOrgId = nextOrgResult.rows[0]?.organization_id || null;
      await client.query(
        `UPDATE ct_users SET active_organization_id = $1 WHERE id = $2`,
        [newActiveOrgId, userId]
      );
    }

    await client.query('COMMIT');
    return res.json({ success: true, active_organization_id: newActiveOrgId });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error leaving organization:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  } finally {
    client.release();
  }
});

module.exports = router;


