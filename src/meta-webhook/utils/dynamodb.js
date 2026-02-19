/**
 * DynamoDB helpers for Meta webhook flow runner.
 * CRM (UserProfile), conversation state (UserConversationState), escalations (HumanEscalation).
 * Single client instance; removeUndefinedValues to keep items small.
 */
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

/**
 * Get user profile from CRM (PK: mobile, SK: profileType 'PRIMARY').
 * @param {string} tableName - UserProfile table name
 * @param {string} mobile - User mobile
 * @returns {Promise<object|null>}
 */
async function getUserProfile(tableName, mobile) {
  if (!tableName || !mobile) return null;
  try {
    const res = await dynamoClient.send(new GetCommand({
      TableName: tableName,
      Key: { mobile, profileType: 'PRIMARY' }
    }));
    return res.Item || null;
  } catch (err) {
    console.warn(JSON.stringify({ message: 'getUserProfile failed', mobile, error: err.message }));
    throw err;
  }
}

/**
 * Save or overwrite user profile.
 * @param {string} tableName - UserProfile table name
 * @param {object} profile - { mobile, name?, dob?, city?, area?, age?, status?, ... }
 */
async function saveUserProfile(tableName, profile) {
  if (!tableName || !profile?.mobile) return;
  const now = Date.now();
  const item = {
    ...profile,
    profileType: 'PRIMARY',
    updatedAt: now,
    createdAt: profile.createdAt || now
  };
  await dynamoClient.send(new PutCommand({ TableName: tableName, Item: item }));
}

/**
 * Get latest conversation state for a user (by mobile, most recent first).
 * @param {string} tableName - UserConversationState table name
 * @param {string} mobile - User mobile
 * @returns {Promise<object|null>}
 */
async function getLatestConversationState(tableName, mobile) {
  if (!tableName || !mobile) return null;
  try {
    const res = await dynamoClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: { ':mobile': mobile },
      ScanIndexForward: false,
      Limit: 1
    }));
    return (res.Items && res.Items[0]) || null;
  } catch (err) {
    console.warn(JSON.stringify({ message: 'getLatestConversationState failed', mobile, error: err.message }));
    throw err;
  }
}

/**
 * Save conversation state (creates or overwrites). Sets ttl for DynamoDB TTL.
 * @param {string} tableName - UserConversationState table name
 * @param {object} state - { mobile, conversationId, currentStep, flowState, userProfile?, stepData?, ... }
 */
async function saveConversationState(tableName, state) {
  if (!tableName || !state?.mobile || !state?.conversationId) return;
  const now = Date.now();
  const ttl = Math.floor((now + 365 * 24 * 60 * 60 * 1000) / 1000);
  const item = {
    ...state,
    lastInteraction: state.lastInteraction || now,
    updatedAt: now,
    createdAt: state.createdAt || now,
    ttl
  };
  await dynamoClient.send(new PutCommand({ TableName: tableName, Item: item }));
}

/**
 * Update user profile (preferences, interactions, flags). Merges with existing.
 * @param {string} tableName - UserProfile table name
 * @param {string} mobile - User mobile
 * @param {object} updates - { preferences?, interactions?, RM_Escalation_Required?, Unanswered_Query? }
 */
async function updateUserProfile(tableName, mobile, updates) {
  if (!tableName || !mobile || !updates || typeof updates !== 'object') return;
  const existing = await getUserProfile(tableName, mobile);
  if (!existing) return;
  const now = Date.now();
  const merged = { ...existing, ...updates, updatedAt: now };
  await dynamoClient.send(new PutCommand({ TableName: tableName, Item: { ...merged, profileType: 'PRIMARY' } }));
}

/**
 * Check if user has any pending escalation (agent is handling this conversation).
 * @param {string} tableName - HumanEscalation table name
 * @param {string} mobile - User mobile
 * @returns {Promise<boolean>}
 */
async function hasPendingEscalationForUser(tableName, mobile) {
  if (!tableName || !mobile) return false;
  try {
    const res = await dynamoClient.send(new QueryCommand({
      TableName: tableName,
      IndexName: 'mobile-index',
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: { ':mobile': mobile },
      Limit: 10
    }));
    const items = res.Items || [];
    return items.some((item) => item.status === 'pending');
  } catch (err) {
    console.warn(JSON.stringify({ message: 'hasPendingEscalationForUser failed', mobile, error: err.message }));
    return false;
  }
}

/**
 * Create human escalation record.
 * @param {string} tableName - HumanEscalation table name
 * @param {object} escalation - { mobile, conversationId, userProfile?, userMessage?, escalationReason?, step? }
 * @returns {Promise<string>} escalationId
 */
async function createEscalation(tableName, escalation) {
  if (!tableName) return '';
  const now = Date.now();
  const escalationId = `esc_${now}`;
  const item = {
    ...escalation,
    escalationId,
    timestamp: now,
    status: 'pending',
    createdAt: now
  };
  await dynamoClient.send(new PutCommand({ TableName: tableName, Item: item }));
  return escalationId;
}

module.exports = {
  getUserProfile,
  saveUserProfile,
  getLatestConversationState,
  saveConversationState,
  updateUserProfile,
  createEscalation,
  hasPendingEscalationForUser
};
