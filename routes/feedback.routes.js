const express = require('express');
const { dbQuery } = require('../config/database');

const router = express.Router();

// Submit feedback
router.post('/', (req, res) => {
  const { feedback, user_token, url } = req.body;
  
  if (!feedback) {
    return res.status(400).json({ success: false, error: 'Feedback is required' });
  }
  
  // Store feedback in analytics table
  dbQuery.run(`INSERT INTO ct_analytics (action, ip_address, user_agent) VALUES (?, ?, ?)`,
    [`feedback: ${feedback}`, req.ip, req.get('User-Agent')], (err) => {
    if (err) {
      console.error('Feedback error:', err);
      return res.status(500).json({ success: false });
    }
    
    res.json({ success: true });
  });
});

module.exports = router;
