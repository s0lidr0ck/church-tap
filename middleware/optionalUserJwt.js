const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/constants');

/**
 * Optionally decode an end-user JWT and attach it to req.user.
 * Does NOT block if unauthenticated.
 */
function optionalUserJwt(req, _res, next) {
  const token =
    req.header('Authorization')?.replace('Bearer ', '') ||
    req.cookies?.authToken;

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId ?? decoded.id;
    if (userId) {
      req.user = { ...decoded, userId };
    }
  } catch (e) {
    // Ignore invalid tokens for optional mode
  }

  return next();
}

module.exports = { optionalUserJwt };


