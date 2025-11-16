const {
  getUserProfile,
  getAllUserProfiles,
  getConversationState,
  getAllConversationStates,
  getUserMessages,
  getConversationMessages,
  getPendingEscalations,
  getUserEscalations,
  getDashboardStats
} = require('./utils/dynamodb');

// Environment variables
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME;
const CONVERSATION_STATE_TABLE = process.env.CONVERSATION_STATE_TABLE_NAME;
const MESSAGE_LOG_TABLE = process.env.MESSAGE_LOG_TABLE_NAME;
const ESCALATION_TABLE = process.env.ESCALATION_TABLE_NAME;

/**
 * CORS headers
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS'
};

/**
 * Lambda handler for Dashboard API
 * @param {object} event - API Gateway event
 * @returns {Promise<object>} API Gateway response
 */
exports.handler = async (event) => {
  console.log(JSON.stringify({
    message: 'Dashboard API request',
    path: event.path,
    method: event.httpMethod,
    queryParams: event.queryStringParameters
  }));

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  try {
    const path = event.path;
    const method = event.httpMethod;
    const queryParams = event.queryStringParameters || {};
    
    // Route requests
    let result;
    
    if (path === '/dashboard/stats' && method === 'GET') {
      // Get dashboard statistics
      result = await getDashboardStats({
        userProfile: USER_PROFILE_TABLE,
        conversationState: CONVERSATION_STATE_TABLE,
        escalation: ESCALATION_TABLE,
        messageLog: MESSAGE_LOG_TABLE
      });
      
    } else if (path === '/dashboard/users' && method === 'GET') {
      // Get all users or specific user
      const mobile = queryParams.mobile;
      const limit = parseInt(queryParams.limit) || 50;
      const lastKey = queryParams.lastKey;
      
      if (mobile) {
        result = await getUserProfile(USER_PROFILE_TABLE, mobile);
      } else {
        result = await getAllUserProfiles(USER_PROFILE_TABLE, limit, lastKey);
      }
      
    } else if (path === '/dashboard/conversations' && method === 'GET') {
      // Get conversation states
      const mobile = queryParams.mobile;
      const limit = parseInt(queryParams.limit) || 50;
      const lastKey = queryParams.lastKey;
      
      if (mobile) {
        result = await getConversationState(CONVERSATION_STATE_TABLE, mobile);
      } else {
        result = await getAllConversationStates(CONVERSATION_STATE_TABLE, limit, lastKey);
      }
      
    } else if (path === '/dashboard/messages' && method === 'GET') {
      // Get ALL messages for a user - includes phone number in every message
      const mobile = queryParams.mobile;
      const conversationId = queryParams.conversationId;
      const limit = parseInt(queryParams.limit) || 500; // Higher default to get more messages
      const lastTimestamp = queryParams.lastTimestamp;
      
      if (conversationId) {
        result = await getConversationMessages(MESSAGE_LOG_TABLE, conversationId, limit, lastTimestamp);
      } else if (mobile) {
        // Get ALL messages for user (with pagination support)
        // Phone number is automatically included in each message
        result = await getUserMessages(MESSAGE_LOG_TABLE, mobile, limit, lastTimestamp);
      } else {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Bad Request',
            message: 'mobile parameter is required to get user messages'
          })
        };
      }
      
    } else if (path === '/dashboard/escalations' && method === 'GET') {
      // Get escalations
      const mobile = queryParams.mobile;
      const status = queryParams.status || 'pending';
      const limit = parseInt(queryParams.limit) || 50;
      const lastKey = queryParams.lastKey;
      
      if (mobile) {
        result = await getUserEscalations(ESCALATION_TABLE, mobile, limit);
      } else if (status === 'pending') {
        result = await getPendingEscalations(ESCALATION_TABLE, limit, lastKey);
      } else {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Bad Request',
            message: 'Invalid status or missing mobile parameter'
          })
        };
      }
      
    } else {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Not Found',
          message: 'Endpoint not found',
          availableEndpoints: [
            'GET /dashboard/stats',
            'GET /dashboard/users?mobile={mobile}&limit={limit}&lastKey={key}',
            'GET /dashboard/conversations?mobile={mobile}&limit={limit}&lastKey={key}',
            'GET /dashboard/messages?mobile={mobile}&limit={limit}&lastTimestamp={ts}',
            'GET /dashboard/messages?conversationId={id}&limit={limit}&lastTimestamp={ts}',
            'GET /dashboard/escalations?status=pending&limit={limit}&lastKey={key}',
            'GET /dashboard/escalations?mobile={mobile}&limit={limit}'
          ]
        })
      };
    }
    
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        data: result,
        timestamp: Date.now()
      })
    };
    
  } catch (error) {
    console.error(JSON.stringify({
      message: 'Error processing dashboard API request',
      error: error.message,
      stack: error.stack,
      path: event.path
    }));
    
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: 'Internal Server Error',
        message: error.message
      })
    };
  }
};

