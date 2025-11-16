const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

/**
 * Get user profile from CRM
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @returns {Promise<object|null>} User profile or null
 */
async function getUserProfile(tableName, mobile) {
  try {
    const command = new GetCommand({
      TableName: tableName,
      Key: {
        mobile: mobile,
        profileType: 'PRIMARY'
      }
    });
    
    const result = await dynamoClient.send(command);
    return result.Item || null;
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error getting user profile',
      mobile,
      error: error.message
    }));
    throw error;
  }
}

/**
 * Create or update user profile
 * @param {string} tableName - Table name
 * @param {object} profile - User profile data
 * @returns {Promise<void>}
 */
async function saveUserProfile(tableName, profile) {
  try {
    const now = Date.now();
    const command = new PutCommand({
      TableName: tableName,
      Item: {
        ...profile,
        profileType: 'PRIMARY',
        updatedAt: now,
        createdAt: profile.createdAt || now
      }
    });
    
    await dynamoClient.send(command);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error saving user profile',
      mobile: profile.mobile,
      error: error.message
    }));
    throw error;
  }
}

/**
 * Get latest conversation state for a user
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @returns {Promise<object|null>} Conversation state or null
 */
async function getLatestConversationState(tableName, mobile) {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: {
        ':mobile': mobile
      },
      ScanIndexForward: false, // Get most recent first
      Limit: 1
    });
    
    const result = await dynamoClient.send(command);
    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error getting conversation state',
      mobile,
      error: error.message
    }));
    throw error;
  }
}

/**
 * Create or update conversation state
 * @param {string} tableName - Table name
 * @param {object} state - Conversation state data
 * @returns {Promise<void>}
 */
async function saveConversationState(tableName, state) {
  try {
    const now = Date.now();
    const oneYearFromNow = Math.floor((now + 365 * 24 * 60 * 60 * 1000) / 1000); // TTL in seconds
    
    const command = new PutCommand({
      TableName: tableName,
      Item: {
        ...state,
        updatedAt: now,
        createdAt: state.createdAt || now,
        ttl: oneYearFromNow
      }
    });
    
    await dynamoClient.send(command);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error saving conversation state',
      mobile: state.mobile,
      error: error.message
    }));
    throw error;
  }
}

/**
 * Save message to message log
 * @param {string} tableName - Table name
 * @param {object} message - Message data
 * @returns {Promise<void>}
 */
async function saveMessageLog(tableName, message) {
  try {
    // Remove undefined values to avoid DynamoDB errors
    const cleanMessage = Object.fromEntries(
      Object.entries({
        ...message,
        timestamp: Number(message.timestamp),
        processed: true,
        processedAt: Date.now()
      }).filter(([_, value]) => value !== undefined)
    );
    
    const command = new PutCommand({
      TableName: tableName,
      Item: cleanMessage
    });
    
    await dynamoClient.send(command);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error saving message log',
      mobile: message.mobile,
      error: error.message
    }));
    throw error;
  }
}

/**
 * Create human escalation record
 * @param {string} tableName - Table name
 * @param {object} escalation - Escalation data
 * @returns {Promise<void>}
 */
async function createEscalation(tableName, escalation) {
  try {
    const now = Date.now();
    const escalationId = `esc_${now}`;
    
    const command = new PutCommand({
      TableName: tableName,
      Item: {
        ...escalation,
        escalationId,
        timestamp: now,
        status: 'pending',
        createdAt: now
      }
    });
    
    await dynamoClient.send(command);
    
    return escalationId;
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error creating escalation',
      mobile: escalation.mobile,
      error: error.message
    }));
    throw error;
  }
}

module.exports = {
  getUserProfile,
  saveUserProfile,
  getLatestConversationState,
  saveConversationState,
  saveMessageLog,
  createEscalation
};

