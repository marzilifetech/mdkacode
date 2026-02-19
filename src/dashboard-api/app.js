const {
  getUserProfile,
  getAllUserProfiles,
  getConversationState,
  getAllConversationStates,
  getUserMessages,
  getConversationMessages,
  getPendingEscalations,
  getUserEscalations,
  resolveEscalation,
  getDashboardStats
} = require('./utils/dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const ssmClient = new SSMClient({});

// Environment variables
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME;
const CONVERSATION_STATE_TABLE = process.env.CONVERSATION_STATE_TABLE_NAME;
const MESSAGE_LOG_TABLE = process.env.MESSAGE_LOG_TABLE_NAME;
const ESCALATION_TABLE = process.env.ESCALATION_TABLE_NAME;
const BOT_CONFIG_TABLE = process.env.BOT_CONFIG_TABLE_NAME;
const META_PAT_SSM_NAME = process.env.META_PAGE_ACCESS_TOKEN_SSM_NAME || '';
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '';
const KNOWN_FLOW_IDS = ['marzi-lead'];

/** Get Meta phone number ID: BotConfig meta.phoneNumberId or env. */
async function getMetaPhoneNumberId() {
  const fromConfig = BOT_CONFIG_TABLE ? await (async () => {
    try {
      const r = await dynamoClient.send(new GetCommand({
        TableName: BOT_CONFIG_TABLE,
        Key: { configKey: 'meta' }
      }));
      return r.Item?.phoneNumberId || r.Item?.phone_number_id || null;
    } catch { return null; }
  })() : null;
  return fromConfig || META_PHONE_NUMBER_ID || '';
}

/** Get Meta Page Access Token from SSM for manual send. */
async function getMetaPat() {
  if (!META_PAT_SSM_NAME) return '';
  try {
    const out = await ssmClient.send(new GetParameterCommand({
      Name: META_PAT_SSM_NAME,
      WithDecryption: true
    }));
    return out.Parameter?.Value || '';
  } catch (err) {
    console.warn('getMetaPat failed:', err.message);
    return '';
  }
}

/** Normalize mobile to E.164 (no +). Indian 10-digit -> 919xxxxxxxxx. */
function normalizeMobile(mobile) {
  const digits = String(mobile).replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits.slice(-15);
}

/** Send text via Meta WhatsApp Cloud API. Returns { success, metaMessageId, error }. */
async function sendMetaWhatsAppText(phoneNumberId, to, body) {
  const pid = phoneNumberId || META_PHONE_NUMBER_ID;
  if (!pid || !to || body == null) return { success: false, error: 'missing phoneNumberId, to, or body' };
  const token = await getMetaPat();
  if (!token) return { success: false, error: 'no access token' };
  const toE164 = normalizeMobile(to);
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pid}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toE164,
    type: 'text',
    text: { preview_url: false, body: String(body).slice(0, 4096) }
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.error?.message || res.statusText;
      const hint = /does not exist|cannot be loaded|missing permissions/i.test(errMsg)
        ? 'Verify META_PHONE_NUMBER_ID in Meta Business Suite (WhatsApp > API Setup) and ensure the token has whatsapp_business_messaging permission.'
        : null;
      return { success: false, error: errMsg, metaMessageId: null, hint };
    }
    return { success: true, metaMessageId: data.messages?.[0]?.id || null };
  } catch (err) {
    return { success: false, error: err.message, metaMessageId: null };
  }
}

/**
 * CORS headers
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET,PATCH,POST,PUT,OPTIONS'
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

    } else if (path.match(/^\/dashboard\/escalations\/[^/]+$/) && method === 'PATCH') {
      const escalationId = (event.pathParameters && event.pathParameters.escalationId) ||
        path.replace(/^\/dashboard\/escalations\//, '').split('/')[0];
      if (!escalationId || !ESCALATION_TABLE) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'escalationId required' })
        };
      }
      const updated = await resolveEscalation(ESCALATION_TABLE, escalationId);
      if (!updated) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Not Found', message: 'Escalation not found', escalationId })
        };
      }
      result = { escalationId, status: 'resolved', resolved: true };
      
    } else if (path === '/dashboard/config/meta' && method === 'GET') {
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      try {
        const r = await dynamoClient.send(new GetCommand({
          TableName: BOT_CONFIG_TABLE,
          Key: { configKey: 'meta' }
        }));
        const item = r.Item || {};
        result = {
          phoneNumberId: item.phoneNumberId || item.phone_number_id || META_PHONE_NUMBER_ID,
          envPhoneNumberId: META_PHONE_NUMBER_ID || null
        };
      } catch (err) {
        result = { phoneNumberId: META_PHONE_NUMBER_ID, envPhoneNumberId: META_PHONE_NUMBER_ID };
      }

    } else if (path === '/dashboard/config/meta' && method === 'PATCH') {
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'Invalid JSON body' })
        };
      }
      const phoneNumberId = body.phoneNumberId || body.phone_number_id;
      if (!phoneNumberId || typeof phoneNumberId !== 'string') {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'phoneNumberId required' })
        };
      }
      await dynamoClient.send(new PutCommand({
        TableName: BOT_CONFIG_TABLE,
        Item: {
          configKey: 'meta',
          phoneNumberId: phoneNumberId.trim(),
          updatedAt: Date.now()
        }
      }));
      result = { phoneNumberId: phoneNumberId.trim(), saved: true };

    } else if (path === '/dashboard/config/gupshup' && method === 'GET') {
      // Get Gupshup config (e.g. ignore-reply toggle)
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      const getRes = await dynamoClient.send(new GetCommand({
        TableName: BOT_CONFIG_TABLE,
        Key: { configKey: 'gupshup' }
      }));
      const item = getRes.Item || {};
      result = { ignoreReply: item.ignoreReply === true };
      
    } else if (path === '/dashboard/config/gupshup' && method === 'PATCH') {
      // Update Gupshup ignore-reply (enable/disable sending replies)
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'Invalid JSON body' })
        };
      }
      const ignoreReply = body.ignoreReply === true || body.enabled === true;
      await dynamoClient.send(new PutCommand({
        TableName: BOT_CONFIG_TABLE,
        Item: {
          configKey: 'gupshup',
          ignoreReply,
          updatedAt: Date.now()
        }
      }));
      result = { ignoreReply };

    } else if (path === '/dashboard/bot/status' && method === 'GET') {
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      const getRes = await dynamoClient.send(new GetCommand({
        TableName: BOT_CONFIG_TABLE,
        Key: { configKey: 'botEnabled' }
      }));
      const item = getRes.Item || {};
      result = { botEnabled: item.enabled !== false };

    } else if (path === '/dashboard/bot/status' && method === 'PATCH') {
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'Invalid JSON body' })
        };
      }
      const enabled = body.enabled !== undefined ? body.enabled === true : body.botEnabled === true;
      await dynamoClient.send(new PutCommand({
        TableName: BOT_CONFIG_TABLE,
        Item: {
          configKey: 'botEnabled',
          enabled,
          updatedAt: Date.now()
        }
      }));
      result = { botEnabled: enabled };

    } else if (path === '/api/flows' && method === 'GET') {
      result = { flowIds: KNOWN_FLOW_IDS };

    } else if (path.startsWith('/api/flows/') && method === 'GET') {
      const flowId = (event.pathParameters && event.pathParameters.flowId) || path.replace(/^\/api\/flows\//, '').split('/')[0];
      if (!flowId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'flowId required' })
        };
      }
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      const getRes = await dynamoClient.send(new GetCommand({
        TableName: BOT_CONFIG_TABLE,
        Key: { configKey: `flow_${flowId}` }
      }));
      const item = getRes.Item;
      if (!item || item.flow == null) {
        return {
          statusCode: 404,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Not Found',
            message: 'Flow not customized in DB; meta-webhook uses default from repo.',
            flowId
          })
        };
      }
      result = typeof item.flow === 'string' ? JSON.parse(item.flow) : item.flow;

    } else if (path.startsWith('/api/flows/') && method === 'PUT') {
      const flowId = (event.pathParameters && event.pathParameters.flowId) || path.replace(/^\/api\/flows\//, '').split('/')[0];
      if (!flowId) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'flowId required' })
        };
      }
      if (!BOT_CONFIG_TABLE) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bot config not configured' })
        };
      }
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'Invalid JSON body' })
        };
      }
      await dynamoClient.send(new PutCommand({
        TableName: BOT_CONFIG_TABLE,
        Item: {
          configKey: `flow_${flowId}`,
          flow: body,
          updatedAt: Date.now()
        }
      }));
      result = { flowId, saved: true };

    } else if (path === '/dashboard/messages/send' && method === 'POST') {
      let body;
      try {
        body = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : (event.body || {});
      } catch {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'Bad Request', message: 'Invalid JSON body' })
        };
      }
      const mobile = body.mobile || body.to;
      const messageBody = body.body || body.text || body.message;
      const phoneNumberId = body.phone_number_id || body.phoneNumberId || (await getMetaPhoneNumberId());
      if (!mobile || messageBody == null) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({
            error: 'Bad Request',
            message: 'body must include mobile (or to) and body (or text or message)'
          })
        };
      }
      if (!phoneNumberId) {
        return {
          statusCode: 503,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'META_PHONE_NUMBER_ID not configured. Set it in env or pass phone_number_id in body.'
          })
        };
      }
      const sendResult = await sendMetaWhatsAppText(phoneNumberId, mobile, messageBody);
      if (!sendResult.success) {
        return {
          statusCode: 502,
          headers: corsHeaders,
          body: JSON.stringify({
            success: false,
            error: 'Send failed',
            detail: sendResult.error,
            phoneNumberIdUsed: phoneNumberId,
            hint: sendResult.hint || '1) Get correct Phone number ID from Meta Business Suite > WhatsApp > API Setup. 2) PATCH /dashboard/config/meta with { "phoneNumberId": "YOUR_ID" }. 3) Ensure SSM /whatsapp-bot/meta-page-access-token has a valid token with whatsapp_business_messaging permission.'
          })
        };
      }
      const now = Date.now();
      const conversationId = String(mobile).replace(/\D/g, '').slice(-15);
      const normalizedMobile = normalizeMobile(mobile);
      if (BOT_CONFIG_TABLE && normalizedMobile) {
        try {
          await dynamoClient.send(new PutCommand({
            TableName: BOT_CONFIG_TABLE,
            Item: {
              configKey: `agent_cooldown_${normalizedMobile}`,
              timestamp: now,
              updatedAt: now
            }
          }));
        } catch (err) {
          console.warn('agent_cooldown_save_error', err.message);
        }
      }
      if (MESSAGE_LOG_TABLE) {
        try {
          await dynamoClient.send(new PutCommand({
            TableName: MESSAGE_LOG_TABLE,
            Item: {
              mobile: conversationId,
              timestamp: now,
              conversationId,
              direction: 'outbound',
              source: 'manual',
              type: 'text',
              messageText: String(messageBody).slice(0, 4096),
              metaMessageId: sendResult.metaMessageId || null,
              waNumber: conversationId
            }
          }));
        } catch (err) {
          console.warn('message_log_save_error', err.message);
        }
      }
      result = { sent: true, metaMessageId: sendResult.metaMessageId, timestamp: now };

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
            'GET /dashboard/escalations?mobile={mobile}&limit={limit}',
            'PATCH /dashboard/escalations/{escalationId} (resolve - bot resumes for user)',
            'GET /dashboard/config/gupshup',
            'PATCH /dashboard/config/gupshup (body: { "ignoreReply": true|false } or { "enabled": true|false })',
            'GET /dashboard/config/meta (returns phoneNumberId)',
            'PATCH /dashboard/config/meta (body: { "phoneNumberId": "YOUR_ID" } - fix "Object does not exist" error)',
            'GET /dashboard/bot/status',
            'PATCH /dashboard/bot/status (body: { "enabled": true|false } or { "botEnabled": true|false })',
            'GET /api/flows',
            'GET /api/flows/{flowId}',
            'PUT /api/flows/{flowId} (body: flow JSON)',
            'POST /dashboard/messages/send (body: { "mobile", "body" })'
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

