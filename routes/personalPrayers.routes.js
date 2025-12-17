const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

// List personal prayers
router.get('/', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;

    const result = await db.query(
      `
      SELECT id, content, is_answered, answered_at, created_at
      FROM ct_personal_prayer_requests
      WHERE user_id = $1 AND organization_id = $2
      ORDER BY created_at DESC
      `,
      [userId, orgId]
    );

    return res.json({ success: true, prayers: result.rows || [] });
  } catch (error) {
    console.error('Error listing personal prayers:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Create personal prayer
router.post('/', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const content = String(req.body?.content || '').trim();

    if (!content) {
      return res.status(400).json({ success: false, error: 'content is required' });
    }

    if (content.length > 1000) {
      return res.status(400).json({ success: false, error: 'Prayer too long (max 1000 characters)' });
    }

    const result = await db.query(
      `
      INSERT INTO ct_personal_prayer_requests (user_id, organization_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, content, is_answered, answered_at, created_at
      `,
      [userId, orgId, content]
    );

    return res.json({ success: true, prayer: result.rows[0] });
  } catch (error) {
    console.error('Error creating personal prayer:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Update personal prayer (mark answered/unanswered)
router.put('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const prayerId = Number(req.params.id);
    const isAnswered = !!req.body?.is_answered;

    if (!prayerId || Number.isNaN(prayerId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    const answeredAt = isAnswered ? new Date() : null;

    const result = await db.query(
      `
      UPDATE ct_personal_prayer_requests
      SET is_answered = $1,
          answered_at = $2
      WHERE id = $3 AND user_id = $4 AND organization_id = $5
      RETURNING id, content, is_answered, answered_at, created_at
      `,
      [isAnswered, answeredAt, prayerId, userId, orgId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Prayer not found' });
    }

    return res.json({ success: true, prayer: result.rows[0] });
  } catch (error) {
    console.error('Error updating personal prayer:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Delete personal prayer
router.delete('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const prayerId = Number(req.params.id);

    if (!prayerId || Number.isNaN(prayerId)) {
      return res.status(400).json({ success: false, error: 'Invalid id' });
    }

    const result = await db.query(
      `DELETE FROM ct_personal_prayer_requests WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [prayerId, userId, orgId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Prayer not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting personal prayer:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;
