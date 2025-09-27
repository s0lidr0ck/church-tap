const express = require('express');
const { dbQuery, db } = require('../config/database');

const router = express.Router();

// Track analytics
router.post('/', (req, res) => {
  const { action, verse_id, user_token, timestamp, originating_tag_id: originatingTagFromBody } = req.body;
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  const orgId = req.organizationId || req.organization?.id || null;
  
  // Get session attribution from cookies
  let taggedSessionId = req.cookies?.taggedSession;
  let originatingTagId = req.cookies?.originatingTag || originatingTagFromBody;
  const sessionIdCookie = req.cookies?.trackingSession;

  // Fallback: if attribution cookies are missing, try to resolve from anonymous_sessions by session_id
  const tryResolveAttribution = (cb) => {
    if (taggedSessionId || originatingTagId || !sessionIdCookie) return cb();
    db.query(`SELECT tagged_session_id, originating_tag_id FROM anonymous_sessions WHERE session_id = $1 ORDER BY last_seen_at DESC`, [sessionIdCookie], (err, result) => {
      const row = result.rows[0];
      if (!err && row) {
        taggedSessionId = taggedSessionId || row.tagged_session_id;
        originatingTagId = originatingTagId || row.originating_tag_id;
      }
      cb();
    });
  };
  
  tryResolveAttribution(() => {
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
        const interactionData = { action, verse_id };
        dbQuery.run(`
          INSERT INTO tag_interactions (
            session_id, tag_id, interaction_type, page_url, referrer,
            user_agent, ip_address, organization_id, interaction_data, tagged_session_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          sessionIdCookie,
          originatingTagId,
          action,
          (req.originalUrl || '/api/analytics'),
          req.get('Referrer'),
          userAgent,
          ip,
          orgId,
          JSON.stringify(interactionData),
          taggedSessionId || null
        ], (err) => {
          if (err) console.error('Tag interactions insert error:', err);
          else console.log('Tag interactions insert successful');
        });
      } else {
        console.log('Skipping tag_interactions insert - missing required data');
      }

      // Update session activity timestamp if we have a tagged session
      if (taggedSessionId) {
        dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = $1`, [taggedSessionId]);
      }
      
      res.json({ success: true });
    });
  });
});

// Background sync endpoint used by service worker to flush queued analytics
router.post('/sync', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  const userAgent = req.get('User-Agent');
  const orgId = req.organizationId || req.organization?.id || null;

  // Get session attribution from cookies
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;

  const { events } = req.body || {};

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
        
        // Update session activity timestamp if we have a tagged session
        if (taggedSessionId) {
          dbQuery.run(`UPDATE anonymous_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE tagged_session_id = $1`, [taggedSessionId]);
        }
        
        return res.json({ success: true });
      }
    );
  }
});

module.exports = router;
