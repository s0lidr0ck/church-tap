const express = require('express');
const { dbQuery, db } = require('../config/database');

const router = express.Router();

// Track analytics
router.post('/', (req, res) => {
  const { action, verse_id, user_token, timestamp, originating_tag_id: originatingTagFromBody } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  let orgId = req.organization?.id || null;
  
  // Get session attribution from cookies
  let taggedSessionId = req.cookies?.taggedSession;
  let originatingTagId = req.cookies?.originatingTag || originatingTagFromBody;
  const sessionIdCookie = req.cookies?.trackingSession;

  // Note: Attribution is now handled via cookies set during initial tap
  // No need for database fallback since cookies persist the session data
  const tryResolveAttribution = (cb) => {
    cb(); // Attribution comes from cookies or request body
  };
  
  // Resolve organization from tag if not already available
  const resolveOrgFromTag = (cb) => {
    // If we already have an org ID, skip resolution
    if (orgId) return cb();
    
    // If we have an originating tag, try to resolve org from it
    if (!originatingTagId) return cb();
    
    db.query(`
      SELECT organization_id 
      FROM ct_nfc_tags 
      WHERE custom_id = $1
    `, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
        console.log(`✅ Resolved organization ${orgId} from tag ${originatingTagId}`);
      }
      cb();
    });
  };
  
  tryResolveAttribution(() => {
    resolveOrgFromTag(() => {
      console.log(`Analytics tracking - action: ${action}, verse_id: ${verse_id}, taggedSession: ${taggedSessionId}, originatingTag: ${originatingTagId}, sessionId: ${sessionIdCookie}, orgId: ${orgId}`);

      // Only track analytics if we have a valid organization
      if (!orgId) {
        console.log('Skipping analytics tracking - no organization ID available');
        return res.json({ success: true });
      }

    dbQuery.run(`INSERT INTO ct_analytics
      (verse_id, action, ip_address, user_agent, organization_id, tagged_session_id, originating_tag_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [verse_id, action, ip, userAgent, orgId, taggedSessionId, originatingTagId], (err) => {
      if (err) {
        console.error('Analytics error:', err);
        return res.status(500).json({ success: false });
      }
      
      // Also mirror to tag_interactions so session analytics reflect the event immediately
      console.log(`Tag interactions check - sessionIdCookie: ${sessionIdCookie}, originatingTagId: ${originatingTagId}, orgId: ${orgId}`);
      if (sessionIdCookie && originatingTagId && orgId) {
        console.log('Writing to tag_interactions table');
        const interactionData = { action, verse_id, taggedSession: taggedSessionId };
        db.query(`
          INSERT INTO tag_interactions (
            session_id, tag_id, interaction_type, page_url, referrer,
            user_agent, ip_address, organization_id, interaction_data
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          sessionIdCookie,
          originatingTagId,
          action,
          (req.originalUrl || '/api/analytics'),
          req.get('Referrer'),
          userAgent,
          ip,
          orgId,
          JSON.stringify(interactionData)
        ], (err) => {
          if (err) console.error('Tag interactions insert error:', err);
          else console.log('Tag interactions insert successful');
        });
      } else {
        console.log('Skipping tag_interactions insert - missing required data');
      }

      // Update session activity timestamp if we have a session
      if (sessionIdCookie) {
        db.query(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [sessionIdCookie], (err) => {
          if (err) console.error('Error updating session timestamp:', err);
        });
      }
      
      res.json({ success: true });
    });
    });
  });
});

// Background sync endpoint used by service worker to flush queued analytics
router.post('/sync', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  let orgId = req.organization?.id || null;

  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;

  // Resolve organization from tag if not already available
  const resolveOrgFromTag = (cb) => {
    // If we already have an org ID, skip resolution
    if (orgId) return cb();
    
    // If we have an originating tag, try to resolve org from it
    if (!originatingTagId) return cb();
    
    db.query(`
      SELECT organization_id 
      FROM ct_nfc_tags 
      WHERE custom_id = $1
    `, [originatingTagId], (err, result) => {
      if (!err && result.rows.length > 0) {
        orgId = result.rows[0].organization_id;
        console.log(`✅ Resolved organization ${orgId} from tag ${originatingTagId} for sync`);
      }
      cb();
    });
  };

  const { events } = req.body || {};

  resolveOrgFromTag(() => {

  if (Array.isArray(events) && events.length > 0) {
    let processed = 0;
    let errors = [];
    
    const processEvent = (index) => {
      if (index >= events.length) {
        if (errors.length > 0) {
          console.error('Background sync batch errors:', errors);
          return res.status(500).json({ success: false });
        }
        return res.json({ success: true, processed });
      }
      
      const ev = events[index];
      dbQuery.run(`INSERT INTO ct_analytics
        (verse_id, action, ip_address, user_agent, organization_id, tagged_session_id, originating_tag_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [ev.verse_id || null, ev.action || 'bg_event', ip, userAgent, orgId, taggedSessionId, originatingTagId],
        (err) => {
          if (err) {
            errors.push(`Event ${index}: ${err.message}`);
          } else {
            processed++;
          }
          processEvent(index + 1);
        }
      );
    };
    
    processEvent(0);
  } else {
    dbQuery.run(
      `INSERT INTO ct_analytics
        (verse_id, action, ip_address, user_agent, organization_id, tagged_session_id, originating_tag_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [null, 'background-sync', ip, userAgent, orgId, taggedSessionId, originatingTagId],
      (err) => {
        if (err) {
          console.error('Background sync error:', err);
          return res.status(500).json({ success: false });
        }
        
        // Update session activity timestamp if we have a session
        if (sessionId) {
          db.query(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE session_id = $1`, [sessionId], (err) => {
            if (err) console.error('Error updating session timestamp:', err);
          });
        }
        
        return res.json({ success: true });
      }
    );
  }
  });
});

module.exports = router;
