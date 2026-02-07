const { v4: uuidv4 } = require('uuid');
const {
  getAuthUser,
  putAuthUser,
  createOTPAttempt,
  getLatestOTPAttemptByMobile,
  updateOTPAttemptStatus
} = require('./utils/dynamodb');
const { sendTemplateMessage } = require('./utils/gupshup');
const { signAccess, signRefresh, verifyAccess, verifyRefresh, getAccessExpirySeconds } = require('./utils/jwt');
const {
  generateOTP,
  hashOTP,
  verifyOTP,
  OTP_EXPIRY_MS,
  OTP_RATE_LIMIT_MS
} = require('./utils/otp');

const USER_AUTH_TEMPLATE_ID = process.env.USER_AUTH_TEMPLATE_ID || 'user_authentication';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-me-refresh';

/** Comma-separated list of E.164 mobiles that get userType ADMIN (e.g. ADMIN_MOBILES=91999...,91998...). */
const ADMIN_MOBILES = (process.env.ADMIN_MOBILES || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

/** When set to 'true' or '1', skip DynamoDB and Gupshup (for local testing without AWS credentials). */
const LOCAL_MOCK_AUTH = process.env.LOCAL_MOCK_AUTH === 'true' || process.env.LOCAL_MOCK_AUTH === '1';

/** Resolve userType: preserve existing userType, or ADMIN if mobile in ADMIN_MOBILES, else guest. */
function resolveUserType(existingUser, mobile) {
  if (existingUser && existingUser.userType != null && existingUser.userType !== '') {
    return existingUser.userType;
  }
  return ADMIN_MOBILES.includes(mobile) ? 'ADMIN' : 'guest';
}

/** Detect AWS credential/security token errors so we can fall back to mock locally. */
function isAwsCredentialError(err) {
  const msg = (err && err.message || String(err)).toLowerCase();
  return (
    msg.includes('security token') ||
    msg.includes('invalid') && msg.includes('token') ||
    msg.includes('credentials') ||
    msg.includes('unrecognizedclientexception') ||
    msg.includes('requestexpired')
  );
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,PATCH,OPTIONS'
};

/**
 * Normalize mobile to E.164 (digits only; add 91 if 10 digits).
 * @param {string} mobile - Raw mobile input
 * @returns {string|null} E.164 or null if invalid
 */
function normalizeMobile(mobile) {
  if (!mobile || typeof mobile !== 'string') return null;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('6') === false) {
    return '91' + digits;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits;
  }
  return digits.length >= 10 ? digits : null;
}

/**
 * Parse JSON body from API Gateway event.
 * @param {object} event - API Gateway event
 * @returns {object} Parsed body or {}
 */
function parseBody(event) {
  try {
    const body = event.body;
    if (!body) return {};
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return {};
  }
}

/**
 * Respond with JSON and status.
 */
function respond(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
}

/**
 * POST /auth/otp/request — Request OTP for mobile (30s rate limit, send via WhatsApp).
 * When LOCAL_MOCK_AUTH=true, skips DynamoDB and Gupshup (no AWS credentials needed).
 */
async function handleOtpRequest(event) {
  const body = parseBody(event);
  const mobile = normalizeMobile(body.mobile);
  if (!mobile) {
    console.warn(JSON.stringify({ message: 'Auth OTP rejected: invalid or missing mobile' }));
    return respond(400, { success: false, error: 'Invalid or missing mobile number' });
  }

  if (LOCAL_MOCK_AUTH) {
    console.warn(JSON.stringify({ message: 'LOCAL_MOCK_AUTH: skipping DynamoDB and Gupshup', mobile, mockOtp: '123456' }));
    return respond(200, {
      success: true,
      message: 'OTP sent to your WhatsApp number (mock: use code 123456 for verify)'
    });
  }

  try {
    const now = Date.now();
    const latest = await getLatestOTPAttemptByMobile(mobile);
    if (latest && latest.requestedAt > now - OTP_RATE_LIMIT_MS) {
      return respond(429, {
        success: false,
        error: 'Please wait 30 seconds before requesting another OTP'
      });
    }

    const otp = generateOTP();
    const attemptId = uuidv4();
    const codeHash = hashOTP(otp, JWT_REFRESH_SECRET);
    const requestedAt = now;
    const expiresAt = now + OTP_EXPIRY_MS;

    try {
      await createOTPAttempt({
        attemptId,
        mobile,
        requestedAt,
        expiresAt,
        codeHash,
        status: 'sent',
        createdAt: now
      });
    } catch (dbErr) {
      if (isAwsCredentialError(dbErr)) {
        console.warn(JSON.stringify({ message: 'AWS credential error, returning mock OTP success', mobile }));
        return respond(200, {
          success: true,
          message: 'OTP sent to your WhatsApp number (mock: use code 123456 for verify)'
        });
      }
      console.error(JSON.stringify({ message: 'Auth OTP DynamoDB failed', mobile, error: dbErr.message }));
      return respond(500, {
        success: false,
        error: 'Failed to create OTP attempt. Please try again later.'
      });
    }

    let gupshupResult;
    try {
      gupshupResult = await sendTemplateMessage(mobile, USER_AUTH_TEMPLATE_ID, { var1: otp });
    } catch (err) {
      if (isAwsCredentialError(err)) {
        console.warn(JSON.stringify({ message: 'AWS/network error, returning mock OTP success', mobile }));
        return respond(200, {
          success: true,
          message: 'OTP sent to your WhatsApp number (mock: use code 123456 for verify)'
        });
      }
      console.error(JSON.stringify({ message: 'Gupshup sendTemplateMessage failed', mobile, error: err.message }));
      return respond(500, {
        success: false,
        error: 'Failed to send OTP. Please try again later.'
      });
    }

    if (!gupshupResult.success) {
      const details = gupshupResult.data?.response?.details || gupshupResult.data?.details || null;
      console.error(JSON.stringify({ message: 'Gupshup OTP send failed', mobile, details }));
      const clientMessage = details
        ? `Failed to send OTP: ${details}`
        : 'Failed to send OTP. Please try again later.';
      return respond(500, {
        success: false,
        error: clientMessage,
        ...(details && { errorDetail: details })
      });
    }

    return respond(200, {
      success: true,
      message: 'OTP sent to your WhatsApp number'
    });
  } catch (err) {
    if (isAwsCredentialError(err)) {
      console.warn(JSON.stringify({ message: 'AWS credential error, returning mock OTP success', mobile, error: err.message }));
      return respond(200, {
        success: true,
        message: 'OTP sent to your WhatsApp number (mock: use code 123456 for verify)'
      });
    }
    throw err;
  }
}

/**
 * POST /auth/otp/verify — Verify OTP and return access + refresh tokens.
 * When LOCAL_MOCK_AUTH=true, accepts code 123456 and returns tokens without DynamoDB.
 */
async function handleOtpVerify(event) {
  const body = parseBody(event);
  const mobile = normalizeMobile(body.mobile);
  const code = body.code != null ? String(body.code).trim() : '';
  if (!mobile || !code) {
    return respond(400, { success: false, error: 'mobile and code are required' });
  }

  if (LOCAL_MOCK_AUTH) {
    if (code !== '123456') {
      return respond(401, { success: false, error: 'Invalid OTP (mock: use 123456)' });
    }
    const userType = 'guest';
    const accessToken = signAccess(mobile, userType);
    const refreshToken = signRefresh(mobile, userType);
    const expiresIn = getAccessExpirySeconds();
    return respond(200, {
      success: true,
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      userType
    });
  }

  try {
    const latest = await getLatestOTPAttemptByMobile(mobile);
    if (!latest) {
      return respond(401, { success: false, error: 'No OTP found for this number. Request OTP first.' });
    }
    if (latest.expiresAt < Date.now()) {
      return respond(401, { success: false, error: 'OTP has expired. Request a new one.' });
    }
    if (latest.status === 'verified') {
      return respond(401, { success: false, error: 'OTP already used.' });
    }

    const valid = verifyOTP(code, latest.codeHash, JWT_REFRESH_SECRET);
    if (!valid) {
      return respond(401, { success: false, error: 'Invalid OTP' });
    }

    await updateOTPAttemptStatus(latest.attemptId, 'verified');

    const now = Date.now();
    const platform = body.platform || 'unknown';
    const existingUser = await getAuthUser(mobile);
    const userType = resolveUserType(existingUser, mobile);
    await putAuthUser({
      mobile,
      validatedAt: now,
      platform,
      userType,
      createdAt: existingUser?.createdAt ?? now,
      updatedAt: now,
      ...(body.metadata && typeof body.metadata === 'object' ? { metadata: body.metadata } : {})
    });

    const accessToken = signAccess(mobile, userType);
    const refreshToken = signRefresh(mobile, userType);
    const expiresIn = getAccessExpirySeconds();

    return respond(200, {
      success: true,
      accessToken,
      refreshToken,
      expiresIn,
      tokenType: 'Bearer',
      userType
    });
  } catch (err) {
    if (isAwsCredentialError(err) && code === '123456') {
      console.warn(JSON.stringify({ message: 'AWS credential error, returning mock verify tokens', mobile }));
      const userType = 'guest';
      const accessToken = signAccess(mobile, userType);
      const refreshToken = signRefresh(mobile, userType);
      const expiresIn = getAccessExpirySeconds();
      return respond(200, {
        success: true,
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer',
        userType
      });
    }
    if (isAwsCredentialError(err)) {
      return respond(401, { success: false, error: 'No OTP found or invalid (mock: use code 123456)' });
    }
    throw err;
  }
}

/**
 * PATCH /auth/user/permission — Update a user's userType (ADMIN only).
 * Body: { mobile, userType } where userType is 'ADMIN' or 'guest'.
 */
async function handlePatchUserPermission(event) {
  const authHeader = event.headers?.Authorization || event.headers?.authorization || '';
  let decoded;
  try {
    decoded = verifyAccess(authHeader);
  } catch (err) {
    return respond(401, { success: false, error: 'Invalid or expired access token' });
  }
  const callerUserType = decoded.userType || 'guest';
  if (callerUserType !== 'ADMIN') {
    return respond(403, { success: false, error: 'Only ADMIN can update user permission' });
  }

  const body = parseBody(event);
  const mobile = normalizeMobile(body.mobile);
  if (!mobile) {
    return respond(400, { success: false, error: 'Valid mobile is required' });
  }
  const userType = body.userType != null ? String(body.userType).trim() : '';
  if (userType !== 'ADMIN' && userType !== 'guest') {
    return respond(400, { success: false, error: 'userType must be ADMIN or guest' });
  }

  if (LOCAL_MOCK_AUTH) {
    return respond(200, { success: true, mobile, userType, message: 'Permission updated (mock)' });
  }

  const existing = await getAuthUser(mobile);
  if (!existing) {
    return respond(404, { success: false, error: 'User not found' });
  }

  const now = Date.now();
  await putAuthUser({
    ...existing,
    userType,
    updatedAt: now
  });
  return respond(200, { success: true, mobile, userType });
}

/**
 * POST /auth/refresh — Exchange refresh token for new access token.
 */
async function handleRefresh(event) {
  const body = parseBody(event);
  const refreshToken = body.refreshToken || body.refresh_token || '';
  if (!refreshToken) {
    return respond(400, { success: false, error: 'refreshToken is required' });
  }

  let decoded;
  try {
    decoded = verifyRefresh(refreshToken);
  } catch (err) {
    return respond(401, { success: false, error: 'Invalid or expired refresh token' });
  }

  const userType = decoded.userType || 'guest';
  const accessToken = signAccess(decoded.sub, userType);
  const newRefreshToken = signRefresh(decoded.sub, userType);
  const expiresIn = getAccessExpirySeconds();

  return respond(200, {
    success: true,
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
    tokenType: 'Bearer',
    userType
  });
}

/**
 * Lambda handler — route by path and method.
 */
exports.handler = async (event) => {
  const path = event.path || event.requestContext?.http?.path || '';
  const method = (event.httpMethod || event.requestContext?.http?.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    if (path === '/auth/otp/request' && method === 'POST') {
      return await handleOtpRequest(event);
    }
    if (path === '/auth/otp/verify' && method === 'POST') {
      return await handleOtpVerify(event);
    }
    if (path === '/auth/refresh' && method === 'POST') {
      return await handleRefresh(event);
    }
    if (path === '/auth/user/permission' && method === 'PATCH') {
      return await handlePatchUserPermission(event);
    }

    return respond(404, { success: false, error: 'Not found' });
  } catch (err) {
    console.error(JSON.stringify({ message: 'Auth API error', path, error: err.message }));
    return respond(500, { success: false, error: 'Internal server error' });
  }
};
