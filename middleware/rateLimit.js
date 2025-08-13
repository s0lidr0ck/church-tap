// Simple in-memory rate limiter middleware factory
// Configurable via options or environment variables

const defaultWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '', 10) || 60_000; // 1 minute
const defaultMax = parseInt(process.env.RATE_LIMIT_MAX || '', 10) || 30; // 30 requests per window

// Buckets map: key -> { start: number, count: number }
const buckets = new Map();

function createRateLimiter(options = {}) {
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : defaultWindowMs;
  const max = Number.isFinite(options.max) ? options.max : defaultMax;

  return function rateLimit(keyBase) {
    return (req, res, next) => {
      const now = Date.now();
      const orgId = req.organizationId || 1;
      const ip = (req.ip || req.connection?.remoteAddress || 'unknown').toString();
      const key = `${keyBase}:${orgId}:${ip}`;
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.start > windowMs) {
        bucket = { start: now, count: 0 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > max) {
        return res.status(429).json({ success: false, error: 'Too many requests. Please slow down.' });
      }
      next();
    };
  };
}

module.exports = createRateLimiter;


