const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand, BatchWriteCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

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
 * Get escalation by escalationId (PK). Returns first match.
 * @param {string} tableName - HumanEscalation table name
 * @param {string} escalationId - e.g. esc_1739900000000
 * @returns {Promise<object|null>}
 */
async function getEscalationById(tableName, escalationId) {
  if (!tableName || !escalationId) return null;
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'escalationId = :id',
      ExpressionAttributeValues: { ':id': escalationId },
      Limit: 1
    }));
    return (result.Items && result.Items[0]) || null;
  } catch (error) {
    throw new Error(`Error getting escalation: ${error.message}`);
  }
}

/**
 * Resolve escalation (set status to 'resolved'). Bot will resume replying to this user.
 * @param {string} tableName - HumanEscalation table name
 * @param {string} escalationId - e.g. esc_1739900000000
 * @returns {Promise<object|null>} Updated item or null if not found
 */
async function resolveEscalation(tableName, escalationId) {
  const item = await getEscalationById(tableName, escalationId);
  if (!item) return null;
  const updated = { ...item, status: 'resolved', resolvedAt: Date.now() };
  await dynamoClient.send(new PutCommand({ TableName: tableName, Item: updated }));
  return updated;
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

/**
 * Delete a user and all their conversations, messages, and escalations.
 * @param {object} tables - { userProfile, conversationState, messageLog, escalation }
 * @param {string} mobile - User mobile (E.164 or 10-digit Indian)
 * @returns {Promise<object>} { deleted: { userProfile, conversationState, messageLog, escalation } }
 */
async function deleteUserAndConversations(tables, mobile) {
  if (!mobile || !tables?.userProfile) {
    throw new Error('tables and mobile are required');
  }
  const results = { userProfile: 0, conversationState: 0, messageLog: 0, escalation: 0 };

  async function batchDelete(tableName, items, keySchema) {
    if (!items.length) return 0;
    let deleted = 0;
    for (let i = 0; i < items.length; i += 25) {
      const batch = items.slice(i, i + 25).map((item) => ({
        DeleteRequest: {
          Key: keySchema.pk && keySchema.sk
            ? { [keySchema.pk]: item[keySchema.pk], [keySchema.sk]: item[keySchema.sk] }
            : { [keySchema.pk]: item[keySchema.pk] }
        }
      }));
      await dynamoClient.send(new BatchWriteCommand({
        RequestItems: { [tableName]: batch }
      }));
      deleted += batch.length;
    }
    return deleted;
  }

  if (tables.userProfile) {
    const q = await dynamoClient.send(new QueryCommand({
      TableName: tables.userProfile,
      KeyConditionExpression: 'mobile = :m',
      ExpressionAttributeValues: { ':m': mobile }
    }));
    const items = q.Items || [];
    results.userProfile = await batchDelete(tables.userProfile, items, { pk: 'mobile', sk: 'profileType' });
  }

  if (tables.conversationState) {
    const q = await dynamoClient.send(new QueryCommand({
      TableName: tables.conversationState,
      KeyConditionExpression: 'mobile = :m',
      ExpressionAttributeValues: { ':m': mobile }
    }));
    const items = q.Items || [];
    results.conversationState = await batchDelete(tables.conversationState, items, { pk: 'mobile', sk: 'conversationId' });
  }

  if (tables.messageLog) {
    let lastKey = null;
    do {
      const params = {
        TableName: tables.messageLog,
        KeyConditionExpression: 'mobile = :m',
        ExpressionAttributeValues: { ':m': mobile }
      };
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const q = await dynamoClient.send(new QueryCommand(params));
      const items = q.Items || [];
      results.messageLog += await batchDelete(tables.messageLog, items, { pk: 'mobile', sk: 'timestamp' });
      lastKey = q.LastEvaluatedKey || null;
    } while (lastKey);
  }

  if (tables.escalation) {
    const q = await dynamoClient.send(new QueryCommand({
      TableName: tables.escalation,
      IndexName: 'mobile-index',
      KeyConditionExpression: 'mobile = :m',
      ExpressionAttributeValues: { ':m': mobile }
    }));
    const items = q.Items || [];
    for (const item of items) {
      await dynamoClient.send(new DeleteCommand({
        TableName: tables.escalation,
        Key: { escalationId: item.escalationId, timestamp: item.timestamp }
      }));
      results.escalation++;
    }
  }

  return { deleted: results, mobile };
}

/**
 * Delete all users and conversations (full reset). Does NOT delete BotConfig, Payment*.
 * @param {object} tables - All table names (userProfile, conversationState, messageLog, escalation, authUser?, otpAttempt?)
 * @returns {Promise<object>} { deleted: { ... } }
 */
async function deleteAllUsersAndConversations(tables) {
  const results = {};
  const tableConfigs = [
    { key: 'userProfile', pk: 'mobile', sk: 'profileType' },
    { key: 'conversationState', pk: 'mobile', sk: 'conversationId' },
    { key: 'messageLog', pk: 'mobile', sk: 'timestamp' },
    { key: 'escalation', pk: 'escalationId', sk: 'timestamp' }
  ];

  for (const tc of tableConfigs) {
    const tableName = tables[tc.key];
    if (!tableName) continue;
    let deleted = 0;
    let lastKey = null;
    do {
      const params = { TableName: tableName };
      if (lastKey) params.ExclusiveStartKey = lastKey;
      const scan = await dynamoClient.send(new ScanCommand(params));
      const items = scan.Items || [];
      for (let i = 0; i < items.length; i += 25) {
        const batch = items.slice(i, i + 25).map((item) => ({
          DeleteRequest: {
            Key: tc.sk && item[tc.sk] !== undefined
              ? { [tc.pk]: item[tc.pk], [tc.sk]: item[tc.sk] }
              : { [tc.pk]: item[tc.pk] }
          }
        }));
        await dynamoClient.send(new BatchWriteCommand({
          RequestItems: { [tableName]: batch }
        }));
        deleted += batch.length;
      }
      lastKey = scan.LastEvaluatedKey || null;
    } while (lastKey);
    results[tc.key] = deleted;
  }

  return { deleted: results };
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
  getEscalationById,
  resolveEscalation,
  getDashboardStats,
  deleteUserAndConversations,
  deleteAllUsersAndConversations
};

