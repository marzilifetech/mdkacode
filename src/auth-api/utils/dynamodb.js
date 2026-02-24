const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const AUTH_USER_TABLE = process.env.AUTH_USER_TABLE_NAME;
const OTP_ATTEMPT_TABLE = process.env.OTP_ATTEMPT_TABLE_NAME;
const BOT_CONFIG_TABLE = process.env.BOT_CONFIG_TABLE_NAME || '';

const GSI_MOBILE_REQUESTED_AT = 'mobile-requestedAt-index';

/**
 * Get auth user by mobile.
 * @param {string} mobile - E.164 mobile
 * @returns {Promise<object|null>} AuthUser item or null
 */
async function getAuthUser(mobile) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: AUTH_USER_TABLE,
      Key: { mobile }
    })
  );
  return result.Item || null;
}

/**
 * Create or update auth user (upsert).
 * @param {object} item - { mobile, validatedAt, platform, createdAt, updatedAt, userType?, metadata? }
 *   userType: 'guest' | 'ADMIN' | others; default guest or null
 * @returns {Promise<void>}
 */
async function putAuthUser(item) {
  await dynamoClient.send(
    new PutCommand({
      TableName: AUTH_USER_TABLE,
      Item: item
    })
  );
}

/**
 * Create an OTP attempt record.
 * @param {object} item - { attemptId, mobile, requestedAt, expiresAt, codeHash, status, createdAt }
 * @returns {Promise<void>}
 */
async function createOTPAttempt(item) {
  await dynamoClient.send(
    new PutCommand({
      TableName: OTP_ATTEMPT_TABLE,
      Item: item
    })
  );
}

/**
 * Get latest OTP attempt for a mobile (for rate limit and verification).
 * @param {string} mobile - E.164 mobile
 * @returns {Promise<object|null>} Latest OTPAttempt item or null
 */
async function getLatestOTPAttemptByMobile(mobile) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: OTP_ATTEMPT_TABLE,
      IndexName: GSI_MOBILE_REQUESTED_AT,
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: { ':mobile': mobile },
      ScanIndexForward: false,
      Limit: 1
    })
  );
  return (result.Items && result.Items[0]) || null;
}

/**
 * Get auth config from BotConfig (configKey: 'auth').
 * Drives static_code vs OTP: { mode: 'static_code'|'otp', staticCodeGuest, staticCodeAdmin }.
 * Falls back to env AUTH_MODE, AUTH_STATIC_CODE_GUEST, AUTH_STATIC_CODE_ADMIN.
 * @returns {Promise<{ mode: string, staticCodeGuest: string, staticCodeAdmin: string }>}
 */
async function getAuthConfig() {
  const defaults = {
    mode: process.env.AUTH_MODE || 'otp',
    staticCodeGuest: process.env.AUTH_STATIC_CODE_GUEST || '123456',
    staticCodeAdmin: process.env.AUTH_STATIC_CODE_ADMIN || '908070'
  };
  if (!BOT_CONFIG_TABLE) return defaults;
  try {
    const result = await dynamoClient.send(
      new GetCommand({
        TableName: BOT_CONFIG_TABLE,
        Key: { configKey: 'auth' }
      })
    );
    const item = result.Item;
    if (!item || !item.mode) return defaults;
    return {
      mode: String(item.mode),
      staticCodeGuest: item.staticCodeGuest != null ? String(item.staticCodeGuest) : defaults.staticCodeGuest,
      staticCodeAdmin: item.staticCodeAdmin != null ? String(item.staticCodeAdmin) : defaults.staticCodeAdmin
    };
  } catch (err) {
    return defaults;
  }
}

/**
 * Update OTP attempt status (e.g. to 'verified').
 * @param {string} attemptId - UUID
 * @param {string} status - New status
 * @returns {Promise<void>}
 */
async function updateOTPAttemptStatus(attemptId, status) {
  await dynamoClient.send(
    new UpdateCommand({
      TableName: OTP_ATTEMPT_TABLE,
      Key: { attemptId },
      UpdateExpression: 'SET #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status }
    })
  );
}

module.exports = {
  getAuthUser,
  putAuthUser,
  createOTPAttempt,
  getLatestOTPAttemptByMobile,
  updateOTPAttemptStatus,
  getAuthConfig
};
