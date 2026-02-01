const jwt = require('jsonwebtoken');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'change-me';

/**
 * Verify access token (Bearer) and return decoded payload.
 * Uses same secret as Auth API so tokens issued by auth work here.
 * @param {string} token - JWT access token string
 * @returns {object} Decoded payload { sub (mobile), type, iat, exp }
 * @throws {Error} If invalid or not type 'access'
 */
function verifyAccess(token) {
  const decoded = jwt.verify(token, JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (decoded.type !== 'access') {
    throw new Error('Invalid token type');
  }
  return decoded;
}

module.exports = {
  verifyAccess
};
