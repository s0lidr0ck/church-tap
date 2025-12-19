const { db } = require('../config/database');

/**
 * Recurring Event Service
 * Handles automatic generation of recurring event instances
 */

const RecurringEventService = {
  /**
   * Normalize recurrence type values coming from UI.
   * We support: daily, weekly, monthly, quarterly
   */
  normalizeRecurrenceType(type) {
    const t = (type || '').toString().trim().toLowerCase();
    if (t === 'daily' || t === 'weekly' || t === 'monthly' || t === 'quarterly') return t;
    return 'weekly';
  },

  /**
   * Parse recurrence_days from DB/UI into an array of weekday numbers [0..6] (Sun..Sat).
   * Accepts:
   * - JSON string like "[0,2,4]"
   * - array of numbers
   * - array of strings like ["sunday","wed"]
   */
  parseRecurrenceDays(value) {
    if (value === null || value === undefined) return null;
    let arr = value;
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) return null;
      try {
        arr = JSON.parse(s);
      } catch (e) {
        return null;
      }
    }
    if (!Array.isArray(arr)) return null;

    const map = new Map([
      ['sun', 0], ['sunday', 0],
      ['mon', 1], ['monday', 1],
      ['tue', 2], ['tues', 2], ['tuesday', 2],
      ['wed', 3], ['wednesday', 3],
      ['thu', 4], ['thur', 4], ['thurs', 4], ['thursday', 4],
      ['fri', 5], ['friday', 5],
      ['sat', 6], ['saturday', 6]
    ]);

    const out = [];
    for (const v of arr) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 6) out.push(Math.floor(v));
      else if (typeof v === 'string') {
        const k = v.trim().toLowerCase();
        if (map.has(k)) out.push(map.get(k));
      }
    }
    const uniq = Array.from(new Set(out)).sort((a, b) => a - b);
    return uniq.length ? uniq : null;
  },

  startOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  },

  toDateOnlyString(d) {
    return new Date(d).toISOString().split('T')[0];
  },

  addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  },

  /**
   * Add months preserving day-of-month, clamped to the last day of the target month.
   * Example: Jan 31 + 1 month => Feb 28/29.
   */
  addMonthsClamped(d, months) {
    const src = new Date(d);
    const day = src.getDate();
    const hours = src.getHours();
    const minutes = src.getMinutes();
    const seconds = src.getSeconds();
    const ms = src.getMilliseconds();

    // Go to first of month to avoid rollover surprises, then clamp.
    const x = new Date(src);
    x.setDate(1);
    x.setMonth(x.getMonth() + months);

    const lastDay = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(day, lastDay));
    x.setHours(hours, minutes, seconds, ms);
    return x;
  },
  
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

    const type = this.normalizeRecurrenceType(parentEvent.recurrence_type);
    const interval = Math.max(1, parseInt(parentEvent.recurrence_interval || 1, 10) || 1);

    const now = new Date();
    const windowEnd = new Date(endDate);
    const seriesEnd = parentEvent.recurrence_end_date ? new Date(parentEvent.recurrence_end_date) : null;
    const effectiveEnd = (seriesEnd && seriesEnd < windowEnd) ? seriesEnd : windowEnd;

    const startAt = new Date(parentEvent.start_at);
    if (!Number.isFinite(startAt.getTime())) return 0;

    // Use date-only for schedule evaluation but preserve time/duration when creating instance rows.
    const startDay = this.startOfDay(startAt);
    const today = this.startOfDay(now);

    // Duration-based end time (handles events spanning midnight).
    const durationMs = parentEvent.end_at ? (new Date(parentEvent.end_at).getTime() - startAt.getTime()) : null;

    const occurrences = [];

    // Preload cancelled occurrence exceptions for this parent within our window.
    const cancelledSet = new Set();
    try {
      const ex = await db.query(
        `
        SELECT instance_date
        FROM ct_event_occurrence_exceptions
        WHERE parent_event_id = $1
          AND action = 'cancelled'
          AND instance_date >= $2::date
          AND instance_date <= $3::date
        `,
        [parentEvent.id, this.toDateOnlyString(today), this.toDateOnlyString(effectiveEnd)]
      );
      for (const r of (ex.rows || [])) {
        if (r.instance_date) cancelledSet.add(String(r.instance_date).slice(0, 10));
      }
    } catch (e) {
      // If the exceptions table doesn't exist yet, fail open (still generate).
    }

    if (type === 'daily') {
      for (let d = new Date(startDay); d <= effectiveEnd; d = this.addDays(d, 1)) {
        const diffDays = Math.floor((this.startOfDay(d).getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays < 0) continue;
        if (diffDays % interval !== 0) continue;
        occurrences.push(new Date(d));
      }
    } else if (type === 'weekly') {
      const days = this.parseRecurrenceDays(parentEvent.recurrence_days) ?? [startAt.getDay()];
      const daySet = new Set(days);
      for (let d = new Date(startDay); d <= effectiveEnd; d = this.addDays(d, 1)) {
        if (!daySet.has(d.getDay())) continue;
        const diffDays = Math.floor((this.startOfDay(d).getTime() - startDay.getTime()) / (24 * 60 * 60 * 1000));
        if (diffDays < 0) continue;
        const weeksBetween = Math.floor(diffDays / 7);
        if (weeksBetween % interval !== 0) continue;
        occurrences.push(new Date(d));
      }
    } else {
      // monthly / quarterly (quarterly = monthly with 3x interval)
      const monthsStep = type === 'quarterly' ? (interval * 3) : interval;
      for (let d = new Date(startAt); d <= effectiveEnd; d = this.addMonthsClamped(d, monthsStep)) {
        // Always evaluate on date-only boundary
        occurrences.push(this.startOfDay(d));
        // Guard against infinite loops if date math goes sideways
        if (occurrences.length > 5000) break;
      }
    }

    for (const occDay of occurrences) {
      // Only generate instances within window and not in the past
      if (occDay < today) continue;

      const instanceDateString = this.toDateOnlyString(occDay);
      if (cancelledSet.has(instanceDateString)) continue;
      const existing = await db.query(
        `SELECT id FROM CT_events WHERE parent_event_id = $1 AND instance_date = $2`,
        [parentEvent.id, instanceDateString]
      );

      if ((existing.rows || []).length > 0) continue;

      await this.createEventInstance(parentEvent, occDay, durationMs);
      generatedCount++;
    }

    return generatedCount;
  },
  
  /**
   * Create an instance of a recurring event
   */
  async createEventInstance(parentEvent, instanceDay, durationMs) {
    const instanceStartTime = new Date(instanceDay);

    // Copy time-of-day from original start.
    const originalStart = new Date(parentEvent.start_at);
    instanceStartTime.setHours(
      originalStart.getHours(),
      originalStart.getMinutes(),
      originalStart.getSeconds(),
      originalStart.getMilliseconds()
    );

    const instanceEndTime = (durationMs !== null && Number.isFinite(durationMs))
      ? new Date(instanceStartTime.getTime() + durationMs)
      : null;
    
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
      this.toDateOnlyString(instanceDay),
      true
    ]);
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
