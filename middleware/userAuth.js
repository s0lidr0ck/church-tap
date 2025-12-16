const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

/**
 * Authenticate a ChurchTap end-user via JWT.
 * Accepts:
 * - Authorization: Bearer <token>
 * - Cookie: authToken=<token>
 *
 * Normalizes:
 * - req.user.userId (number)
 * - req.user.email (string)
 */
function authenticateUser(req, res, next) {
  const token =
    req.header('Authorization')?.replace('Bearer ', '') ||
    req.cookies?.authToken;

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId ?? decoded.id;

    if (!userId) {
      return res.status(401).json({ success: false, error: 'Invalid token.' });
    }

    req.user = { ...decoded, userId };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid token.' });
  }
}

module.exports = { authenticateUser };


