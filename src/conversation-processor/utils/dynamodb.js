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
    const profileData = {
      ...profile,
      profileType: 'PRIMARY',
      updatedAt: now,
      createdAt: profile.createdAt || now
    };
    
    console.log(JSON.stringify({
      message: '💾 Saving user profile to database',
      table: tableName,
      mobile: profile.mobile,
      profileKeys: Object.keys(profileData),
      hasName: !!profileData.name,
      hasDOB: !!profileData.dob,
      hasCity: !!profileData.city,
      hasAge: !!profileData.age
    }));
    
    const command = new PutCommand({
      TableName: tableName,
      Item: profileData
    });
    
    await dynamoClient.send(command);
    
    console.log(JSON.stringify({
      message: '✅ User profile saved successfully',
      table: tableName,
      mobile: profile.mobile,
      name: profileData.name
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: '❌ Error saving user profile',
      table: tableName,
      mobile: profile.mobile,
      error: error.message,
      stack: error.stack
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
    
    const stateData = {
      ...state,
      updatedAt: now,
      createdAt: state.createdAt || now,
      ttl: oneYearFromNow
    };
    
    console.log(JSON.stringify({
      message: '💾 Saving conversation state to database',
      table: tableName,
      mobile: state.mobile,
      conversationId: state.conversationId,
      currentStep: state.currentStep,
      flowState: state.flowState,
      hasUserProfile: !!state.userProfile,
      userProfileName: state.userProfile?.name || null
    }));
    
    const command = new PutCommand({
      TableName: tableName,
      Item: stateData
    });
    
    await dynamoClient.send(command);
    
    console.log(JSON.stringify({
      message: '✅ Conversation state saved successfully',
      table: tableName,
      mobile: state.mobile,
      conversationId: state.conversationId,
      currentStep: state.currentStep
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: '❌ Error saving conversation state',
      table: tableName,
      mobile: state.mobile,
      error: error.message,
      stack: error.stack
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
      }).filter(([_, value]) => value !== undefined && value !== null)
    );
    
    console.log(JSON.stringify({
      message: '💾 Saving message log to database',
      table: tableName,
      mobile: message.mobile,
      messageKeys: Object.keys(cleanMessage),
      hasMessageText: !!cleanMessage.messageText,
      hasResponseSent: !!cleanMessage.responseSent,
      conversationId: cleanMessage.conversationId,
      step: cleanMessage.step
    }));
    
    const command = new PutCommand({
      TableName: tableName,
      Item: cleanMessage
    });
    
    await dynamoClient.send(command);
    
    console.log(JSON.stringify({
      message: '✅ Message log saved successfully',
      table: tableName,
      mobile: message.mobile,
      timestamp: cleanMessage.timestamp
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: '❌ Error saving message log',
      table: tableName,
      mobile: message.mobile,
      error: error.message,
      stack: error.stack
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

/**
 * Update user preferences and interactions
 * @param {string} tableName - Table name
 * @param {string} mobile - Mobile number
 * @param {object} updates - Updates object with preferences and/or interactions
 * @returns {Promise<void>}
 */
async function updateUserProfile(tableName, mobile, updates) {
  try {
    const now = Date.now();
    
    // Get existing profile first
    const existingProfile = await getUserProfile(tableName, mobile);
    
    if (!existingProfile) {
      console.warn(JSON.stringify({
        message: '⚠️ Cannot update profile - user does not exist',
        mobile
      }));
      return;
    }
    
    // Merge preferences if provided
    let updatedPreferences = existingProfile.preferences || {
      holidays: false,
      events: false,
      health: false,
      community: false
    };
    
    if (updates.preferences) {
      updatedPreferences = {
        ...updatedPreferences,
        ...updates.preferences
      };
    }
    
    // Merge interactions if provided
    let updatedInteractions = existingProfile.interactions || {
      totalMessages: 0,
      lastMessageDate: now,
      escalations: 0
    };
    
    if (updates.interactions) {
      if (updates.interactions.totalMessages !== undefined) {
        updatedInteractions.totalMessages = (updatedInteractions.totalMessages || 0) + updates.interactions.totalMessages;
      }
      
      if (updates.interactions.lastMessageDate !== undefined) {
        updatedInteractions.lastMessageDate = updates.interactions.lastMessageDate;
      }
      
      if (updates.interactions.escalations !== undefined) {
        updatedInteractions.escalations = (updatedInteractions.escalations || 0) + updates.interactions.escalations;
      }
    }
    
    // Build update expression
    const updateExpressions = [];
    const expressionAttributeNames = {};
    const expressionAttributeValues = {};
    
    // Update preferences if changed
    if (updates.preferences) {
      expressionAttributeNames['#preferences'] = 'preferences';
      expressionAttributeValues[':preferences'] = updatedPreferences;
      updateExpressions.push('#preferences = :preferences');
    }
    
    // Update interactions if changed
    if (updates.interactions) {
      expressionAttributeNames['#interactions'] = 'interactions';
      expressionAttributeValues[':interactions'] = updatedInteractions;
      updateExpressions.push('#interactions = :interactions');
    }
    
    // Always update updatedAt
    expressionAttributeNames['#updatedAt'] = 'updatedAt';
    expressionAttributeValues[':updatedAt'] = now;
    updateExpressions.push('#updatedAt = :updatedAt');
    
    if (updateExpressions.length === 0) {
      console.warn(JSON.stringify({
        message: '⚠️ No updates provided',
        mobile
      }));
      return;
    }
    
    const command = new UpdateCommand({
      TableName: tableName,
      Key: {
        mobile: mobile,
        profileType: 'PRIMARY'
      },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    });
    
    await dynamoClient.send(command);
    
    console.log(JSON.stringify({
      message: '✅ User profile updated successfully',
      table: tableName,
      mobile,
      updates: Object.keys(updates),
      preferences: updatedPreferences,
      interactions: updatedInteractions
    }));
  } catch (error) {
    console.error(JSON.stringify({
      message: '❌ Error updating user profile',
      table: tableName,
      mobile,
      error: error.message,
      stack: error.stack
    }));
    throw error;
  }
}

module.exports = {
  getUserProfile,
  saveUserProfile,
  updateUserProfile,
  getLatestConversationState,
  saveConversationState,
  saveMessageLog,
  createEscalation
};

