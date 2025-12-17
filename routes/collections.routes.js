const express = require('express');
const { db } = require('../config/database');
const { authenticateUser } = require('../middleware/userAuth');
const { requireActiveGroupMembership } = require('../middleware/membershipGate');

const router = express.Router();

// List collections
router.get('/', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;

    const result = await db.query(
      `
      SELECT id, name, description, created_at
      FROM ct_user_collections
      WHERE user_id = $1 AND organization_id = $2
      ORDER BY created_at DESC
      `,
      [userId, orgId]
    );

    return res.json({ success: true, collections: result.rows || [] });
  } catch (error) {
    console.error('Error listing collections:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Create collection
router.post('/', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();

    if (!name) {
      return res.status(400).json({ success: false, error: 'name is required' });
    }

    const result = await db.query(
      `
      INSERT INTO ct_user_collections (user_id, name, description, organization_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, description, created_at
      `,
      [userId, name, description || null, orgId]
    );

    return res.json({ success: true, collection: result.rows[0] });
  } catch (error) {
    console.error('Error creating collection:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Get a collection + verses
router.get('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const collectionId = Number(req.params.id);

    if (!collectionId || Number.isNaN(collectionId)) {
      return res.status(400).json({ success: false, error: 'Invalid collection id' });
    }

    const collectionResult = await db.query(
      `
      SELECT id, name, description, created_at
      FROM ct_user_collections
      WHERE id = $1 AND user_id = $2 AND organization_id = $3
      `,
      [collectionId, userId, orgId]
    );

    const collection = collectionResult.rows[0];
    if (!collection) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    const versesResult = await db.query(
      `
      SELECT
        v.id,
        v.date,
        v.content_type,
        v.verse_text,
        v.image_path,
        v.bible_reference,
        v.context,
        v.tags,
        cv.created_at AS added_at
      FROM ct_collection_verses cv
      JOIN ct_verses v
        ON v.id = cv.verse_id
       AND v.organization_id = $2
      WHERE cv.collection_id = $1
      ORDER BY cv.created_at DESC
      `,
      [collectionId, orgId]
    );

    return res.json({ success: true, collection, verses: versesResult.rows || [] });
  } catch (error) {
    console.error('Error getting collection:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Add verse to collection
router.post('/:id/verses', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const collectionId = Number(req.params.id);
    const verseId = Number(req.body?.verse_id);

    if (!collectionId || Number.isNaN(collectionId)) {
      return res.status(400).json({ success: false, error: 'Invalid collection id' });
    }
    if (!verseId || Number.isNaN(verseId)) {
      return res.status(400).json({ success: false, error: 'verse_id is required' });
    }

    // Ensure the collection belongs to this user/org
    const ownership = await db.query(
      `SELECT id FROM ct_user_collections WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [collectionId, userId, orgId]
    );

    if ((ownership.rows || []).length === 0) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    // Ensure verse belongs to this org
    const verseCheck = await db.query(
      `SELECT id FROM ct_verses WHERE id = $1 AND organization_id = $2`,
      [verseId, orgId]
    );
    if ((verseCheck.rows || []).length === 0) {
      return res.status(404).json({ success: false, error: 'Verse not found for this group' });
    }

    // Insert; ignore duplicates if a unique exists (best-effort)
    try {
      await db.query(
        `INSERT INTO ct_collection_verses (collection_id, verse_id) VALUES ($1, $2)`,
        [collectionId, verseId]
      );
    } catch (e) {
      // If duplicate key, treat as success
      const msg = String(e?.message || '');
      if (!/duplicate key/i.test(msg)) throw e;
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error adding verse to collection:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Remove verse from collection
router.delete('/:id/verses/:verse_id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const collectionId = Number(req.params.id);
    const verseId = Number(req.params.verse_id);

    if (!collectionId || Number.isNaN(collectionId) || !verseId || Number.isNaN(verseId)) {
      return res.status(400).json({ success: false, error: 'Invalid ids' });
    }

    // Ensure the collection belongs to this user/org
    const ownership = await db.query(
      `SELECT id FROM ct_user_collections WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [collectionId, userId, orgId]
    );
    if ((ownership.rows || []).length === 0) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    await db.query(
      `DELETE FROM ct_collection_verses WHERE collection_id = $1 AND verse_id = $2`,
      [collectionId, verseId]
    );

    return res.json({ success: true });
  } catch (error) {
    console.error('Error removing verse from collection:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

// Delete collection
router.delete('/:id', authenticateUser, requireActiveGroupMembership, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = req.activeOrganizationId;
    const collectionId = Number(req.params.id);

    if (!collectionId || Number.isNaN(collectionId)) {
      return res.status(400).json({ success: false, error: 'Invalid collection id' });
    }

    const result = await db.query(
      `DELETE FROM ct_user_collections WHERE id = $1 AND user_id = $2 AND organization_id = $3`,
      [collectionId, userId, orgId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Collection not found' });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting collection:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

module.exports = router;
