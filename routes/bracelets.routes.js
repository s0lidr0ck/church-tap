const express = require('express');
const { db } = require('../config/database');

const router = express.Router();

// Claim a bracelet (associate with an organization)
router.post('/claim', (req, res) => {
  const { tag_id, organization_short_name } = req.body;

  if (!tag_id || !organization_short_name) {
    return res.status(400).json({
      success: false,
      error: 'tag_id and organization_short_name are required'
    });
  }

  console.log(`🏷️ Claiming bracelet ${tag_id} for organization ${organization_short_name}`);

  // First, get the organization ID from the short name/subdomain
  db.query(
    `SELECT id, name FROM CT_organizations WHERE subdomain = $1 AND is_active = true`,
    [organization_short_name],
    (err, orgResult) => {
      if (err) {
        console.error('Error finding organization:', err);
        return res.status(500).json({ success: false, error: 'Database error' });
      }

      if (orgResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Organization not found or inactive'
        });
      }

      const organization = orgResult.rows[0];
      console.log(`🏢 Found organization: ${organization.name} (ID: ${organization.id})`);

      // Check if bracelet membership already exists
      db.query(
        `SELECT id, organization_id, status FROM ct_bracelet_memberships WHERE bracelet_uid = $1`,
        [tag_id],
        (err, membershipResult) => {
          if (err) {
            console.error('Error checking existing bracelet membership:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
          }

          if (membershipResult.rows.length > 0) {
            const existingMembership = membershipResult.rows[0];
            if (existingMembership.organization_id === organization.id) {
              return res.json({
                success: true,
                message: 'Bracelet already claimed by this organization',
                already_claimed: true
              });
            } else {
              return res.status(409).json({
                success: false,
                error: 'Bracelet already claimed by another organization'
              });
            }
          }

          // Create new bracelet membership (direct approval for choose-organization flow)
          db.query(
            `INSERT INTO ct_bracelet_memberships (bracelet_uid, organization_id, status, created_at)
             VALUES ($1, $2, 'approved', NOW())`,
            [tag_id, organization.id],
            (err, insertResult) => {
              if (err) {
                console.error('Error creating bracelet:', err);
                return res.status(500).json({ success: false, error: 'Failed to claim bracelet' });
              }

              console.log(`✅ Successfully claimed bracelet ${tag_id} for ${organization.name}`);
              res.json({
                success: true,
                message: `Bracelet successfully claimed by ${organization.name}`,
                organization: {
                  id: organization.id,
                  name: organization.name,
                  short_name: organization_short_name
                }
              });
            }
          );
        }
      );
    }
  );
});

module.exports = router;