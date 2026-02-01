const jwt = require('jsonwebtoken');

const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'change-me';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-me-refresh';
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '1h';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

/**
 * Sign access JWT for a mobile (subject).
 * @param {string} mobile - E.164 mobile (sub claim)
 * @returns {string} Signed access token
 */
function signAccess(mobile) {
  return jwt.sign(
    { sub: mobile, type: 'access' },
    JWT_ACCESS_SECRET,
    { expiresIn: JWT_ACCESS_EXPIRY, algorithm: 'HS256' }
  );
}

/**
 * Sign refresh JWT for a mobile.
 * @param {string} mobile - E.164 mobile (sub claim)
 * @returns {string} Signed refresh token
 */
function signRefresh(mobile) {
  return jwt.sign(
    { sub: mobile, type: 'refresh' },
    JWT_REFRESH_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRY, algorithm: 'HS256' }
  );
}

/**
 * Verify refresh token and return decoded payload.
 * @param {string} token - JWT string
 * @returns {object} Decoded payload { sub, type, iat, exp }
 * @throws {Error} If invalid or not type 'refresh'
 */
function verifyRefresh(token) {
  const decoded = jwt.verify(token, JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return decoded;
}

/**
 * Get access token expiry in seconds (for expiresIn response).
 * @returns {number} Seconds until access token expires
 */
function getAccessExpirySeconds() {
  const match = (JWT_ACCESS_EXPIRY || '1h').match(/^(\d+)([smhd])$/);
  if (!match) return 3600;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return n * (multipliers[unit] || 3600);
}

module.exports = {
  signAccess,
  signRefresh,
  verifyRefresh,
  getAccessExpirySeconds
};
