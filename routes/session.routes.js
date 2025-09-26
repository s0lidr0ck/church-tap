const express = require('express');
const { SessionService } = require('../services/sessionService');

const router = express.Router();

// End current session (called by frontend on browser close)
router.post('/end', (req, res) => {
  const { reason = 'browser_close' } = req.body;
  const taggedSessionId = req.cookies?.taggedSession;
  const sessionId = req.cookies?.trackingSession;
  
  if (taggedSessionId) {
    SessionService.endSession(taggedSessionId, reason);
    res.clearCookie('taggedSession');
    res.clearCookie('originatingTag');
    console.log(`🔚 Session ended: ${taggedSessionId} (${reason})`);
  }
  
  res.json({ success: true, ended: !!taggedSessionId });
});

// Get current session status
router.get('/status', (req, res) => {
  const taggedSessionId = req.cookies?.taggedSession;
  const originatingTagId = req.cookies?.originatingTag;
  const sessionId = req.cookies?.trackingSession;
  
  res.json({
    success: true,
    session: {
      sessionId,
      taggedSessionId,
      originatingTagId,
      hasActiveTagSession: !!taggedSessionId
    }
  });
});

// Extend current session (called by frontend on activity)
router.post('/extend', (req, res) => {
  const taggedSessionId = req.cookies?.taggedSession;
  
  if (taggedSessionId) {
    // Reset the tagged session cookie to extend it
    res.cookie('taggedSession', taggedSessionId, {
      maxAge: 30 * 60 * 1000, // 30 minutes
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    });
    
    res.cookie('originatingTag', req.cookies?.originatingTag, {
      maxAge: 30 * 60 * 1000, // 30 minutes  
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production'
    });
  }
  
  res.json({ success: true, extended: !!taggedSessionId });
});

module.exports = router;
