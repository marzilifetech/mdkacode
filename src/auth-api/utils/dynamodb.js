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
 * @param {object} item - { mobile, validatedAt, platform, createdAt, updatedAt, metadata? }
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
  updateOTPAttemptStatus
};
