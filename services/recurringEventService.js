const { db } = require('../config/database');

/**
 * Recurring Event Service
 * Handles automatic generation of recurring event instances
 */

const RecurringEventService = {
  
  /**
   * Generate event instances for the next N days
   * @param {number} daysAhead - How many days in advance to generate (default: 90)
   */
  async generateUpcomingInstances(daysAhead = 90) {
    try {
      console.log(`🔄 Generating recurring event instances for next ${daysAhead} days...`);
      
      // Get all active recurring events
      const recurringEvents = await db.query(`
        SELECT * FROM CT_events 
        WHERE is_recurring = TRUE 
        AND is_active = TRUE 
        AND (recurrence_end_date IS NULL OR recurrence_end_date > NOW())
      `);
      
      let generatedCount = 0;
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + daysAhead);
      
      for (const event of recurringEvents.rows) {
        const instances = await this.generateInstancesForEvent(event, endDate);
        generatedCount += instances;
      }
      
      console.log(`✅ Generated ${generatedCount} recurring event instances`);
      return generatedCount;
      
    } catch (error) {
      console.error('❌ Error generating recurring events:', error);
      throw error;
    }
  },
  
  /**
   * Generate instances for a specific recurring event
   */
  async generateInstancesForEvent(parentEvent, endDate) {
    if (!parentEvent.is_recurring) return 0;
    
    let generatedCount = 0;
    const startDate = new Date(parentEvent.start_at);
    const currentDate = new Date(startDate);
    
    // If event has already passed, start from today
    if (currentDate < new Date()) {
      currentDate.setTime(new Date().getTime());
    }
    
    while (currentDate <= endDate) {
      // Check if this instance already exists
      const existing = await db.query(`
        SELECT id FROM CT_events 
        WHERE parent_event_id = $1 AND instance_date = $2
      `, [parentEvent.id, currentDate.toISOString().split('T')[0]]);
      
      if (existing.rows.length === 0) {
        await this.createEventInstance(parentEvent, currentDate);
        generatedCount++;
      }
      
      // Calculate next occurrence
      currentDate.setDate(currentDate.getDate() + this.getRecurrenceInterval(parentEvent));
      
      // Stop if we've passed the end date for this recurring series
      if (parentEvent.recurrence_end_date && currentDate > new Date(parentEvent.recurrence_end_date)) {
        break;
      }
    }
    
    return generatedCount;
  },
  
  /**
   * Create an instance of a recurring event
   */
  async createEventInstance(parentEvent, instanceDate) {
    const instanceStartTime = new Date(instanceDate);
    const instanceEndTime = parentEvent.end_at ? new Date(instanceDate) : null;
    
    // Copy the time from the original event
    const originalStart = new Date(parentEvent.start_at);
    instanceStartTime.setHours(originalStart.getHours(), originalStart.getMinutes(), originalStart.getSeconds());
    
    if (parentEvent.end_at && instanceEndTime) {
      const originalEnd = new Date(parentEvent.end_at);
      instanceEndTime.setHours(originalEnd.getHours(), originalEnd.getMinutes(), originalEnd.getSeconds());
    }
    
    await db.query(`
      INSERT INTO CT_events (
        organization_id, title, description, location, address, 
        start_at, end_at, all_day, link, is_active, notify_lead_minutes,
        parent_event_id, instance_date, is_instance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `, [
      parentEvent.organization_id,
      parentEvent.title,
      parentEvent.description,
      parentEvent.location,
      parentEvent.address,
      instanceStartTime,
      instanceEndTime,
      parentEvent.all_day,
      parentEvent.link,
      parentEvent.is_active,
      parentEvent.notify_lead_minutes,
      parentEvent.id,
      instanceDate.toISOString().split('T')[0],
      true
    ]);
  },
  
  /**
   * Get the interval in days for the recurrence
   */
  getRecurrenceInterval(event) {
    const interval = event.recurrence_interval || 1;
    
    switch (event.recurrence_type) {
      case 'daily':
        return interval;
      case 'weekly':
        return interval * 7;
      case 'monthly':
        return interval * 30; // Approximate, could be made more precise
      default:
        return 7; // Default to weekly
    }
  },
  
  /**
   * Delete future instances of a recurring event
   */
  async deleteFutureInstances(parentEventId, fromDate = new Date()) {
    await db.query(`
      DELETE FROM CT_events 
      WHERE parent_event_id = $1 
      AND is_instance = TRUE 
      AND start_at > $2
    `, [parentEventId, fromDate]);
  },
  
  /**
   * Update all future instances when parent event changes
   */
  async updateFutureInstances(parentEvent) {
    // Delete existing future instances
    await this.deleteFutureInstances(parentEvent.id);
    
    // Regenerate instances with new settings
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + 90);
    
    return await this.generateInstancesForEvent(parentEvent, endDate);
  }
};

module.exports = RecurringEventService;
