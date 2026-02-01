const crypto = require('crypto');

const OTP_LENGTH = 6;
const OTP_MIN = 100000;
const OTP_MAX = 999999;

/**
 * Generate a 6-digit numeric OTP.
 * @returns {string} OTP string (e.g. "123456")
 */
function generateOTP() {
  const otp = crypto.randomInt(OTP_MIN, OTP_MAX + 1);
  return String(otp);
}

/**
 * Hash OTP for storage (HMAC-SHA256 with secret).
 * @param {string} otp - Plain OTP string
 * @param {string} secret - Server secret (e.g. JWT_REFRESH_SECRET)
 * @returns {string} Hex-encoded hash
 */
function hashOTP(otp, secret) {
  return crypto.createHmac('sha256', secret).update(otp).digest('hex');
}

/**
 * Verify user-provided OTP against stored hash (timing-safe).
 * @param {string} input - User-provided OTP
 * @param {string} storedHash - Stored codeHash from OTPAttempt
 * @param {string} secret - Same secret used for hashOTP
 * @returns {boolean} True if match
 */
function verifyOTP(input, storedHash, secret) {
  if (!input || !storedHash || !secret) return false;
  const inputHash = hashOTP(String(input).trim(), secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(inputHash, 'hex'), Buffer.from(storedHash, 'hex'));
  } catch {
    return false;
  }
}

module.exports = {
  generateOTP,
  hashOTP,
  verifyOTP,
  OTP_LENGTH,
  OTP_EXPIRY_MS: 24 * 60 * 60 * 1000,
  OTP_RATE_LIMIT_MS: 30 * 1000
};
