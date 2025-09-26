const { db } = require('../config/database');

/**
 * Service for managing user sessions and tracking
 */
class SessionService {
  constructor() {
    this.activeSessions = new Map();
  }

  /**
   * Create a new session
   */
  async createSession(sessionData) {
    try {
      const {
        userId,
        organizationId,
        ipAddress,
        userAgent,
        sessionId
      } = sessionData;

      if (!db || !db.query) {
        console.warn('Database not available for session creation');
        return { success: false, error: 'Database not available' };
      }

      // Store session in database
      const result = await db.query(
        `INSERT INTO user_sessions (
          session_id, user_id, organization_id, ip_address, user_agent, 
          created_at, last_active, is_active
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), true)
        RETURNING id`,
        [sessionId, userId, organizationId, ipAddress, userAgent]
      );

      // Store in memory for quick access
      this.activeSessions.set(sessionId, {
        id: result.rows[0].id,
        userId,
        organizationId,
        createdAt: new Date(),
        lastActive: new Date()
      });

      console.log('📊 Session created:', sessionId);
      return { success: true, sessionId };
    } catch (error) {
      console.error('❌ Failed to create session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionId) {
    try {
      if (!db || !db.query) {
        return { success: false, error: 'Database not available' };
      }

      // Update database
      await db.query(
        'UPDATE user_sessions SET last_active = NOW() WHERE session_id = $1',
        [sessionId]
      );

      // Update memory
      if (this.activeSessions.has(sessionId)) {
        this.activeSessions.get(sessionId).lastActive = new Date();
      }

      return { success: true };
    } catch (error) {
      console.error('❌ Failed to update session activity:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * End a session
   */
  async endSession(sessionId) {
    try {
      if (!db || !db.query) {
        return { success: false, error: 'Database not available' };
      }

      // Update database
      await db.query(
        'UPDATE user_sessions SET is_active = false, ended_at = NOW() WHERE session_id = $1',
        [sessionId]
      );

      // Remove from memory
      this.activeSessions.delete(sessionId);

      console.log('📊 Session ended:', sessionId);
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to end session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get session information
   */
  async getSession(sessionId) {
    try {
      // Check memory first
      if (this.activeSessions.has(sessionId)) {
        return {
          success: true,
          session: this.activeSessions.get(sessionId)
        };
      }

      if (!db || !db.query) {
        return { success: false, error: 'Database not available' };
      }

      // Check database
      const result = await db.query(
        'SELECT * FROM user_sessions WHERE session_id = $1 AND is_active = true',
        [sessionId]
      );

      if (result.rows.length === 0) {
        return { success: false, error: 'Session not found' };
      }

      return { success: true, session: result.rows[0] };
    } catch (error) {
      console.error('❌ Failed to get session:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Clean up expired sessions
   */
  async cleanupExpiredSessions() {
    try {
      if (!db || !db.query) {
        return { success: false, error: 'Database not available' };
      }

      // Mark sessions as inactive if they haven't been active for 24 hours
      const result = await db.query(
        `UPDATE user_sessions 
         SET is_active = false, ended_at = NOW() 
         WHERE is_active = true 
         AND last_active < NOW() - INTERVAL '24 hours'`
      );

      // Clean up memory
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.lastActive < oneDayAgo) {
          this.activeSessions.delete(sessionId);
        }
      }

      console.log(`🧹 Cleaned up ${result.rowCount} expired sessions`);
      return { success: true, cleaned: result.rowCount };
    } catch (error) {
      console.error('❌ Failed to cleanup sessions:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get active session count
   */
  getActiveSessionCount() {
    return this.activeSessions.size;
  }
}

module.exports = {
  SessionService
};
