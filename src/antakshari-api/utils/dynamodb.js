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

const TEAM_TABLE = process.env.ANTAKSHARI_TEAM_TABLE_NAME;
const MEMBER_TABLE = process.env.ANTAKSHARI_MEMBER_TABLE_NAME;
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME;
const PAYMENT_ORDER_TABLE = process.env.PAYMENT_ORDER_TABLE_NAME;
const GSI_OWNER_CREATED = 'ownerMobile-createdAt-index';

// --- AntakshariTeam ---

/**
 * Put team (create or update).
 * @param {object} item - { teamId, teamName, ownerMobile, ref, createdAt, updatedAt, paymentOrderId?, paymentStatus? }
 */
async function putTeam(item) {
  await dynamoClient.send(
    new PutCommand({
      TableName: TEAM_TABLE,
      Item: item
    })
  );
}

/**
 * Get team by teamId.
 * @param {string} teamId
 * @returns {Promise<object|null>}
 */
async function getTeam(teamId) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: TEAM_TABLE,
      Key: { teamId }
    })
  );
  return result.Item || null;
}

/**
 * List teams by owner mobile (GSI ownerMobile-createdAt-index), newest first.
 * @param {string} ownerMobile
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function listTeamsByOwner(ownerMobile, limit = 50) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: TEAM_TABLE,
      IndexName: GSI_OWNER_CREATED,
      KeyConditionExpression: 'ownerMobile = :ownerMobile',
      ExpressionAttributeValues: { ':ownerMobile': ownerMobile },
      ScanIndexForward: false,
      Limit: limit
    })
  );
  return result.Items || [];
}

/**
 * Update team with paymentOrderId (and optionally paymentStatus).
 * @param {string} teamId
 * @param {string} paymentOrderId
 * @param {string} [paymentStatus]
 */
async function updateTeamPaymentOrder(teamId, paymentOrderId, paymentStatus) {
  const now = Date.now();
  const setParts = ['paymentOrderId = :orderId', 'updatedAt = :updatedAt'];
  const values = { ':orderId': paymentOrderId, ':updatedAt': now };
  if (paymentStatus != null) {
    setParts.push('#status = :paymentStatus');
    values[':paymentStatus'] = paymentStatus;
  }
  const names = paymentStatus != null ? { '#status': 'paymentStatus' } : undefined;
  await dynamoClient.send(
    new UpdateCommand({
      TableName: TEAM_TABLE,
      Key: { teamId },
      UpdateExpression: 'SET ' + setParts.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
}

// --- AntakshariMember ---

/**
 * Put a single member (teamId, memberIndex "1".."5", name, phone, dob, ref).
 * @param {object} item
 */
async function putMember(item) {
  await dynamoClient.send(
    new PutCommand({
      TableName: MEMBER_TABLE,
      Item: item
    })
  );
}

/**
 * Get all members for a team (query by teamId).
 * @param {string} teamId
 * @returns {Promise<object[]>}
 */
async function getMembersByTeam(teamId) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: MEMBER_TABLE,
      KeyConditionExpression: 'teamId = :teamId',
      ExpressionAttributeValues: { ':teamId': teamId }
    })
  );
  return (result.Items || []).sort((a, b) => Number(a.memberIndex) - Number(b.memberIndex));
}

// --- UserProfile (existing table) ---

/**
 * Get user profile by mobile + profileType PRIMARY.
 * @param {string} mobile
 * @returns {Promise<object|null>}
 */
async function getUserProfile(mobile) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: USER_PROFILE_TABLE,
      Key: { mobile, profileType: 'PRIMARY' }
    })
  );
  return result.Item || null;
}

/**
 * Put/update user profile (mobile, profileType PRIMARY, name, optional ref, optional dob dd/mm/yyyy).
 * @param {object} item - { mobile, profileType: 'PRIMARY', name, ref?, dob?, updatedAt, createdAt? }
 */
async function putUserProfile(item) {
  const now = Date.now();
  const profile = {
    ...item,
    profileType: 'PRIMARY',
    updatedAt: now,
    createdAt: item.createdAt || now
  };
  await dynamoClient.send(
    new PutCommand({
      TableName: USER_PROFILE_TABLE,
      Item: profile
    })
  );
}

// --- PaymentOrder (read + write team name on link) ---

/**
 * Get order by orderId (for payment status).
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
async function getPaymentOrder(orderId) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: PAYMENT_ORDER_TABLE,
      Key: { orderId }
    })
  );
  return result.Item || null;
}

/**
 * Update PaymentOrder with Antakshari team name (so payment webhook can send WhatsApp).
 * @param {string} orderId
 * @param {string} antakshariTeamName
 */
async function updatePaymentOrderWithAntakshari(orderId, antakshariTeamName) {
  const now = Date.now();
  await dynamoClient.send(
    new UpdateCommand({
      TableName: PAYMENT_ORDER_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET antakshariTeamName = :name, updatedAt = :updatedAt',
      ExpressionAttributeValues: { ':name': antakshariTeamName, ':updatedAt': now }
    })
  );
}

module.exports = {
  putTeam,
  getTeam,
  listTeamsByOwner,
  updateTeamPaymentOrder,
  putMember,
  getMembersByTeam,
  getUserProfile,
  putUserProfile,
  getPaymentOrder,
  updatePaymentOrderWithAntakshari
};
