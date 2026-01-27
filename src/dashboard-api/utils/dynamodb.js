const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

/**
 * Get user profile
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @returns {Promise<object|null>} User profile
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
    throw new Error(`Error getting user profile: ${error.message}`);
  }
}

/**
 * Get all user profiles (with pagination)
 * @param {string} tableName - Table name
 * @param {number} limit - Limit per page
 * @param {string} lastEvaluatedKey - Last evaluated key for pagination
 * @returns {Promise<object>} Users and pagination info
 */
async function getAllUserProfiles(tableName, limit = 50, lastEvaluatedKey = null) {
  try {
    const params = {
      TableName: tableName,
      Limit: limit
    };
    
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
    }
    
    const command = new ScanCommand(params);
    const result = await dynamoClient.send(command);
    
    return {
      items: result.Items || [],
      count: result.Count || 0,
      lastEvaluatedKey: result.LastEvaluatedKey 
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null
    };
  } catch (error) {
    throw new Error(`Error getting user profiles: ${error.message}`);
  }
}

/**
 * Get conversation state for a user
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @returns {Promise<object|null>} Latest conversation state
 */
async function getConversationState(tableName, mobile) {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: {
        ':mobile': mobile
      },
      ScanIndexForward: false, // Most recent first
      Limit: 1
    });
    
    const result = await dynamoClient.send(command);
    return result.Items && result.Items.length > 0 ? result.Items[0] : null;
  } catch (error) {
    throw new Error(`Error getting conversation state: ${error.message}`);
  }
}

/**
 * Get all conversation states (with pagination)
 * @param {string} tableName - Table name
 * @param {number} limit - Limit per page
 * @param {string} lastEvaluatedKey - Last evaluated key
 * @returns {Promise<object>} Conversation states and pagination
 */
async function getAllConversationStates(tableName, limit = 50, lastEvaluatedKey = null) {
  try {
    const params = {
      TableName: tableName,
      Limit: limit
    };
    
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
    }
    
    const command = new ScanCommand(params);
    const result = await dynamoClient.send(command);
    
    return {
      items: result.Items || [],
      count: result.Count || 0,
      lastEvaluatedKey: result.LastEvaluatedKey 
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null
    };
  } catch (error) {
    throw new Error(`Error getting conversation states: ${error.message}`);
  }
}

/**
 * Get all messages for a user
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @param {number} limit - Limit per page (default: 100, set higher for more messages)
 * @param {number} lastTimestamp - Last timestamp for pagination
 * @returns {Promise<object>} Messages and pagination
 */
async function getUserMessages(tableName, mobile, limit = 100, lastTimestamp = null) {
  try {
    const params = {
      TableName: tableName,
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: {
        ':mobile': mobile
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit
    };
    
    if (lastTimestamp) {
      params.ExclusiveStartKey = {
        mobile: mobile,
        timestamp: Number(lastTimestamp)
      };
    }
    
    const command = new QueryCommand(params);
    const result = await dynamoClient.send(command);
    
    // Ensure all messages include phone number and mobile
    const items = (result.Items || []).map(item => ({
      ...item,
      phoneNumber: item.mobile || mobile,
      mobile: item.mobile || mobile
    }));
    
    return {
      items: items,
      count: result.Count || 0,
      lastEvaluatedKey: result.LastEvaluatedKey 
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null,
      phoneNumber: mobile // Include phone number in response
    };
  } catch (error) {
    throw new Error(`Error getting user messages: ${error.message}`);
  }
}

/**
 * Get messages by conversation ID
 * @param {string} tableName - Table name
 * @param {string} conversationId - Conversation ID
 * @param {number} limit - Limit per page
 * @param {number} lastTimestamp - Last timestamp
 * @returns {Promise<object>} Messages and pagination
 */
async function getConversationMessages(tableName, conversationId, limit = 100, lastTimestamp = null) {
  try {
    const params = {
      TableName: tableName,
      IndexName: 'conversation-index',
      KeyConditionExpression: 'conversationId = :convId',
      ExpressionAttributeValues: {
        ':convId': conversationId
      },
      ScanIndexForward: true, // Chronological order
      Limit: limit
    };
    
    if (lastTimestamp) {
      params.ExclusiveStartKey = {
        conversationId: conversationId,
        timestamp: Number(lastTimestamp)
      };
    }
    
    const command = new QueryCommand(params);
    const result = await dynamoClient.send(command);
    
    // Ensure all messages include phone number
    const items = (result.Items || []).map(item => ({
      ...item,
      phoneNumber: item.mobile || item.phoneNumber,
      mobile: item.mobile || item.phoneNumber
    }));
    
    return {
      items: items,
      count: result.Count || 0,
      lastEvaluatedKey: result.LastEvaluatedKey 
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null,
      conversationId: conversationId
    };
  } catch (error) {
    throw new Error(`Error getting conversation messages: ${error.message}`);
  }
}

/**
 * Get pending escalations
 * @param {string} tableName - Table name
 * @param {number} limit - Limit per page
 * @param {string} lastEvaluatedKey - Last evaluated key
 * @returns {Promise<object>} Escalations and pagination
 */
async function getPendingEscalations(tableName, limit = 50, lastEvaluatedKey = null) {
  try {
    const params = {
      TableName: tableName,
      IndexName: 'status-index',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'pending'
      },
      ScanIndexForward: true, // Oldest first
      Limit: limit
    };
    
    if (lastEvaluatedKey) {
      params.ExclusiveStartKey = JSON.parse(Buffer.from(lastEvaluatedKey, 'base64').toString());
    }
    
    const command = new QueryCommand(params);
    const result = await dynamoClient.send(command);
    
    return {
      items: result.Items || [],
      count: result.Count || 0,
      lastEvaluatedKey: result.LastEvaluatedKey 
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : null
    };
  } catch (error) {
    throw new Error(`Error getting pending escalations: ${error.message}`);
  }
}

/**
 * Get escalations by mobile
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @param {number} limit - Limit per page
 * @returns {Promise<object>} Escalations
 */
async function getUserEscalations(tableName, mobile, limit = 50) {
  try {
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'mobile-index',
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: {
        ':mobile': mobile
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit
    });
    
    const result = await dynamoClient.send(command);
    
    return {
      items: result.Items || [],
      count: result.Count || 0
    };
  } catch (error) {
    throw new Error(`Error getting user escalations: ${error.message}`);
  }
}

/**
 * Get dashboard statistics
 * @param {object} tables - Table names object
 * @returns {Promise<object>} Dashboard stats
 */
async function getDashboardStats(tables) {
  try {
    // Get actual counts using COUNT scans
    const [usersResult, eligibleUsersResult, conversationsResult, escalationsResult, messagesResult] = await Promise.all([
      // Count all users with status='active' and profileType='PRIMARY'
      dynamoClient.send(new ScanCommand({
        TableName: tables.userProfile,
        FilterExpression: '#status = :status AND profileType = :profileType',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'active',
          ':profileType': 'PRIMARY'
        },
        Select: 'COUNT'
      })),
      // Count eligible users (ageEligible = true) - users with age >= 50
      dynamoClient.send(new ScanCommand({
        TableName: tables.userProfile,
        FilterExpression: '#status = :status AND profileType = :profileType AND ageEligible = :ageEligible',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'active',
          ':profileType': 'PRIMARY',
          ':ageEligible': true
        },
        Select: 'COUNT'
      })),
      // Count all conversation states
      dynamoClient.send(new ScanCommand({
        TableName: tables.conversationState,
        Select: 'COUNT'
      })),
      // Count pending escalations
      dynamoClient.send(new QueryCommand({
        TableName: tables.escalation,
        IndexName: 'status-index',
        KeyConditionExpression: '#status = :status',
        ExpressionAttributeNames: {
          '#status': 'status'
        },
        ExpressionAttributeValues: {
          ':status': 'pending'
        },
        Select: 'COUNT'
      })),
      // Count messages in last 24 hours
      dynamoClient.send(new ScanCommand({
        TableName: tables.messageLog,
        FilterExpression: '#timestamp > :oneDayAgo',
        ExpressionAttributeNames: {
          '#timestamp': 'timestamp'
        },
        ExpressionAttributeValues: {
          ':oneDayAgo': Date.now() - (24 * 60 * 60 * 1000)
        },
        Select: 'COUNT'
      }))
    ]);
    
    return {
      totalUsers: usersResult.Count || 0,
      eligibleUsers: eligibleUsersResult.Count || 0, // Users with age >= 50
      activeConversations: conversationsResult.Count || 0,
      pendingEscalations: escalationsResult.Count || 0,
      messagesLast24h: messagesResult.Count || 0,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error getting dashboard stats',
      error: error.message,
      stack: error.stack
    }));
    throw new Error(`Error getting dashboard stats: ${error.message}`);
  }
}

module.exports = {
  getUserProfile,
  getAllUserProfiles,
  getConversationState,
  getAllConversationStates,
  getUserMessages,
  getConversationMessages,
  getPendingEscalations,
  getUserEscalations,
  getDashboardStats
};

