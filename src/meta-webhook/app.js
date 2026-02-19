const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

// AWS clients
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const ssmClient = new SSMClient({});

// Env
const EVENT_TABLE = process.env.META_WEBHOOK_EVENT_TABLE_NAME;
const S3_BUCKET = process.env.META_WEBHOOK_S3_BUCKET;
const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || '';
const APP_SECRET = process.env.META_APP_SECRET || '';
const SIGNATURE_REQUIRED = process.env.META_SIGNATURE_REQUIRED === 'true' || process.env.META_SIGNATURE_REQUIRED === '1';
const WEBHOOK_TTL_DAYS = Number(process.env.WEBHOOK_TTL_DAYS || '90') || 90;
const META_PAT_SSM_NAME = process.env.META_PAGE_ACCESS_TOKEN_SSM_NAME || '';
const META_PAT_ENV = process.env.META_PAGE_ACCESS_TOKEN || '';
const MESSAGE_LOG_TABLE = process.env.MESSAGE_LOG_TABLE_NAME || '';
const BOT_CONFIG_TABLE = process.env.BOT_CONFIG_TABLE_NAME || '';
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '';
const USER_PROFILE_TABLE = process.env.USER_PROFILE_TABLE_NAME || '';
const CONVERSATION_STATE_TABLE = process.env.CONVERSATION_STATE_TABLE_NAME || '';
const ESCALATION_TABLE = process.env.ESCALATION_TABLE_NAME || '';
const DEFAULT_FLOW_ID = process.env.DEFAULT_FLOW_ID || 'marzi-lead';

const { loadFlow } = require('./flowLoader');
const { runFlow } = require('./flowRunner');
const {
  getUserProfile,
  getLatestConversationState,
  saveConversationState,
  saveUserProfile,
  createEscalation,
  hasPendingEscalationForUser
} = require('./utils/dynamodb');

const AGENT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function normalizeMobile(mobile) {
  const digits = String(mobile).replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits.slice(-15) || mobile;
}

async function isAgentCooldownActive(tableName, mobile) {
  if (!tableName || !mobile) return false;
  try {
    const key = `agent_cooldown_${normalizeMobile(mobile)}`;
    const res = await dynamoClient.send(new GetCommand({
      TableName: tableName,
      Key: { configKey: key }
    }));
    const ts = res.Item?.timestamp;
    if (!ts || typeof ts !== 'number') return false;
    return (Date.now() - ts) < AGENT_COOLDOWN_MS;
  } catch (err) {
    console.warn(JSON.stringify({ message: 'agent_cooldown_check_failed', mobile, error: err.message }));
    return false;
  }
}

let metaPatCached = null;
let metaPatCacheTime = 0;
const META_PAT_CACHE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get Meta Page Access Token (for sending messages). Prefers env for local; otherwise SSM SecureString.
 * @returns {Promise<string>} PAT or empty string if not configured
 */
async function getMetaPageAccessToken() {
  if (META_PAT_ENV) return META_PAT_ENV;
  if (!META_PAT_SSM_NAME) return '';
  if (metaPatCached && Date.now() - metaPatCacheTime < META_PAT_CACHE_MS) return metaPatCached;
  try {
    const out = await ssmClient.send(new GetParameterCommand({
      Name: META_PAT_SSM_NAME,
      WithDecryption: true
    }));
    const value = out.Parameter?.Value || '';
    if (value) {
      metaPatCached = value;
      metaPatCacheTime = Date.now();
    }
    return value;
  } catch (err) {
    console.warn('getMetaPageAccessToken SSM failed:', err.message);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Global kill switch: read from BotConfig (single source of truth for all users)
// Cache for 60s to reduce DynamoDB reads; default true if not set
// ---------------------------------------------------------------------------
let botEnabledCached = null;
let botEnabledCacheTime = 0;
const BOT_ENABLED_CACHE_MS = 60 * 1000;

/**
 * Returns whether the automatic bot is enabled for all users (global kill switch).
 * @returns {Promise<boolean>}
 */
async function getGlobalBotEnabled() {
  if (!BOT_CONFIG_TABLE) return true;
  if (botEnabledCached !== null && Date.now() - botEnabledCacheTime < BOT_ENABLED_CACHE_MS) {
    return botEnabledCached;
  }
  try {
    const res = await dynamoClient.send(new GetCommand({
      TableName: BOT_CONFIG_TABLE,
      Key: { configKey: 'botEnabled' }
    }));
    const item = res.Item;
    if (item && typeof item.enabled === 'boolean') {
      botEnabledCached = item.enabled;
    } else {
      botEnabledCached = true;
    }
    botEnabledCacheTime = Date.now();
    return botEnabledCached;
  } catch (err) {
    console.warn('getGlobalBotEnabled failed:', err.message);
    botEnabledCached = true;
    botEnabledCacheTime = Date.now();
    return true;
  }
}

/**
 * Parse Meta webhook payload into an array of message events (one per user message).
 * Memory: returns minimal objects; no large string duplication.
 * @param {object} parsed - JSON-parsed webhook body
 * @returns {Array<{ from: string, messageId: string, timestamp: number, type: string, body: string, phoneNumberId: string }>}
 */
function parseMetaMessageEvents(parsed) {
  const out = [];
  if (!parsed || !Array.isArray(parsed.entry)) return out;
  for (const entry of parsed.entry) {
    const changes = entry.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id || META_PHONE_NUMBER_ID || '';
      const messages = value.messages;
      if (!Array.isArray(messages)) continue;
      for (const msg of messages) {
        const from = String(msg.from || '');
        const messageId = String(msg.id || '');
        const ts = msg.timestamp;
        const timestamp = typeof ts === 'string' ? parseInt(ts, 10) : Number(ts) || Date.now();
        const type = String(msg.type || 'text');
        let body = '';
        if (type === 'text' && msg.text && typeof msg.text.body === 'string') {
          body = msg.text.body;
        } else if (msg.button?.text) {
          body = msg.button.text;
        } else if (msg.interactive?.type === 'button_reply' && msg.interactive.button_reply?.title) {
          body = msg.interactive.button_reply.title;
        } else if (msg.interactive?.type === 'list_reply' && msg.interactive.list_reply?.title) {
          body = msg.interactive.list_reply.title;
        }
        out.push({ from, messageId, timestamp, type, body, phoneNumberId });
      }
    }
  }
  return out;
}

/**
 * Save one message to WhatsAppMessageLog. Schema: PK=mobile, SK=timestamp; GSI conversationId-timestamp.
 * @param {object} item - { mobile, timestamp, conversationId, direction, ... }
 */
async function saveMessageToLog(item) {
  if (!MESSAGE_LOG_TABLE) return;
  const clean = Object.fromEntries(
    Object.entries(item).filter(([, v]) => v !== undefined && v !== null)
  );
  clean.timestamp = Number(clean.timestamp);
  try {
    await dynamoClient.send(new PutCommand({ TableName: MESSAGE_LOG_TABLE, Item: clean }));
  } catch (err) {
    console.error(JSON.stringify({ event: 'message_log_save_error', table: MESSAGE_LOG_TABLE, error: err.message }));
  }
}

/**
 * Send a text message via Meta WhatsApp Cloud API (Graph API).
 * @param {string} phoneNumberId - From webhook metadata or env
 * @param {string} to - E.164 without + (e.g. 919876543210)
 * @param {string} body - Plain text body
 * @returns {Promise<{ success: boolean, metaMessageId?: string, error?: string }>}
 */
async function sendMetaWhatsAppText(phoneNumberId, to, body) {
  const pid = phoneNumberId || META_PHONE_NUMBER_ID;
  if (!pid || !to || body == null) {
    return { success: false, error: 'missing phoneNumberId, to, or body' };
  }
  const token = await getMetaPageAccessToken();
  if (!token) return { success: false, error: 'no access token' };
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pid}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/\D/g, '').slice(-15),
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
      return { success: false, error: data.error?.message || res.statusText, metaMessageId: null };
    }
    const metaMessageId = data.messages?.[0]?.id || null;
    return { success: true, metaMessageId };
  } catch (err) {
    return { success: false, error: err.message, metaMessageId: null };
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Hub-Signature-256',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
};

function respond(statusCode, body, headers = {}) {
  const isStringBody = typeof body === 'string';
  return {
    statusCode,
    headers: {
      ...corsHeaders,
      ...(isStringBody ? { 'Content-Type': 'text/plain' } : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: isStringBody ? body : JSON.stringify(body)
  };
}

function getRawBody(event) {
  if (!event.body) return '';
  if (event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return typeof event.body === 'string' ? event.body : JSON.stringify(event.body);
}

function verifySignature(headers, rawBody) {
  const headerSig =
    headers['X-Hub-Signature-256'] ||
    headers['x-hub-signature-256'] ||
    headers['X-Hub-Signature'] ||
    headers['x-hub-signature'];
  if (!headerSig) {
    return !SIGNATURE_REQUIRED;
  }
  if (!APP_SECRET) {
    // Cannot verify without secret; treat as failure only if strictly required
    return !SIGNATURE_REQUIRED;
  }
  const parts = String(headerSig).split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return !SIGNATURE_REQUIRED;
  }
  const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody, 'utf8').digest('hex');
  const provided = parts[1];
  try {
    const ok = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
    return ok;
  } catch {
    return false;
  }
}

async function handleGet(event) {
  const params = event.queryStringParameters || {};
  const mode = params['hub.mode'];
  const token = params['hub.verify_token'];
  const challenge = params['hub.challenge'];

  if (mode === 'subscribe' && token && token === VERIFY_TOKEN && challenge) {
    return respond(200, String(challenge));
  }
  return respond(403, JSON.stringify({ error: 'Forbidden' }));
}

async function handlePost(event) {
  const requestId = event.requestContext?.requestId || `req_${Date.now()}`;
  const receivedAt = Date.now();
  const rawBody = getRawBody(event);

  console.log(
    JSON.stringify({
      event: 'meta_webhook_received',
      requestId,
      path: event.path || event.requestContext?.http?.path,
      bodyLength: rawBody ? rawBody.length : 0,
      bodyPreview: rawBody ? rawBody.substring(0, 200) : ''
    })
  );

  const headers = event.headers || {};
  const headersLower = {};
  for (const [k, v] of Object.entries(headers)) {
    headersLower[String(k).toLowerCase()] = v;
  }

  const sigOk = verifySignature(headersLower, rawBody);
  if (!sigOk) {
    console.warn(
      JSON.stringify({
        event: 'meta_webhook_signature_invalid',
        requestId,
        hasHeader: !!(
          headersLower['x-hub-signature-256'] ||
          headersLower['x-hub-signature']
        ),
        required: SIGNATURE_REQUIRED
      })
    );
    if (SIGNATURE_REQUIRED) {
      return respond(403, { success: false, error: 'Invalid signature' });
    }
  }

  let parsed = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch (e) {
    console.warn(
      JSON.stringify({
        event: 'meta_webhook_parse_error',
        requestId,
        error: e.message
      })
    );
  }

  const objectType = parsed && parsed.object ? String(parsed.object) : null;
  const entryCount = parsed && Array.isArray(parsed.entry) ? parsed.entry.length : 0;
  const entryIds =
    parsed && Array.isArray(parsed.entry)
      ? parsed.entry
          .map((e) => e.id)
          .filter((x) => x != null)
          .slice(0, 10)
      : [];

  const rawBodySha256 = crypto.createHash('sha256').update(rawBody || '', 'utf8').digest('hex');
  const rawBodyBytes = Buffer.byteLength(rawBody || '', 'utf8');
  const eventId = uuidv4();
  const ttlMs = WEBHOOK_TTL_DAYS * 24 * 60 * 60 * 1000;
  const expiresAt = Math.floor((receivedAt + ttlMs) / 1000); // DynamoDB TTL expects seconds

  // Write raw payload to S3 (if configured)
  let s3Key = null;
  if (S3_BUCKET) {
    const d = new Date(receivedAt);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    s3Key = `events/${yyyy}/${mm}/${dd}/${eventId}.json`;
    try {
      await s3Client.send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          Body: rawBody || '',
          ContentType: 'application/json'
        })
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'meta_webhook_s3_error',
          requestId,
          bucket: S3_BUCKET,
          key: s3Key,
          error: e.message
        })
      );
      // continue; we still try to log metadata
    }
  }

  if (EVENT_TABLE) {
    const sourceIp =
      event.requestContext?.identity?.sourceIp ||
      event.requestContext?.http?.sourceIp ||
      null;
    const userAgent = headersLower['user-agent'] || null;
    const item = {
      eventId,
      receivedAt,
      expiresAt,
      path: event.path || event.requestContext?.http?.path || '',
      httpMethod: event.httpMethod || event.requestContext?.http?.method || '',
      sourceIp,
      userAgent,
      query: event.queryStringParameters || null,
      object: objectType,
      entryCount,
      entryIds,
      rawBodySha256,
      rawBodyBytes,
      s3Bucket: S3_BUCKET || null,
      s3Key,
      createdAt: receivedAt
    };

    try {
      await dynamoClient.send(
        new PutCommand({
          TableName: EVENT_TABLE,
          Item: item
        })
      );
    } catch (e) {
      console.error(
        JSON.stringify({
          event: 'meta_webhook_dynamo_error',
          requestId,
          table: EVENT_TABLE,
          error: e.message
        })
      );
    }
  }

  console.log(
    JSON.stringify({
      event: 'meta_webhook_stored',
      requestId,
      eventId,
      object: objectType,
      entryCount,
      rawBodyBytes,
      s3Key: s3Key || null
    })
  );

  // -------------------------------------------------------------------------
  // Message flow: parse -> save inbound -> (if bot enabled) reply -> save outbound
  // -------------------------------------------------------------------------
  const messageEvents = parseMetaMessageEvents(parsed);
  const hasMessages = parsed?.entry?.some(
    (e) => Array.isArray(e.changes) && e.changes.some((c) => c.value?.messages?.length > 0)
  );
  const hasStatuses = parsed?.entry?.some(
    (e) => Array.isArray(e.changes) && e.changes.some((c) => c.value?.statuses?.length > 0)
  );
  console.log(
    JSON.stringify({
      event: 'meta_webhook_parsed',
      requestId,
      messageEventCount: messageEvents.length,
      hasMessages,
      hasStatuses,
      entryCount: parsed?.entry?.length ?? 0
    })
  );
  for (const ev of messageEvents) {
    const mobile = ev.from;
    const conversationId = `conv_${mobile}`;
    const now = Date.now();

    const botEnabled = await getGlobalBotEnabled();
    let outboundMetaMessageId = null;
    let replyBody = '';
    let flowStepAfterReply = null;
    const phoneNumberId = ev.phoneNumberId || META_PHONE_NUMBER_ID;
    const flow = await loadFlow(DEFAULT_FLOW_ID);
    const userProfile = USER_PROFILE_TABLE ? await getUserProfile(USER_PROFILE_TABLE, mobile) : null;
    let state = CONVERSATION_STATE_TABLE ? await getLatestConversationState(CONVERSATION_STATE_TABLE, mobile) : null;

    const inboundItem = {
      mobile,
      timestamp: ev.timestamp,
      conversationId,
      direction: 'inbound',
      source: 'meta',
      type: ev.type,
      messageText: ev.body,
      messageId: ev.messageId,
      waNumber: mobile,
      flowId: DEFAULT_FLOW_ID,
      flowStep: state?.currentStep || state?.flowState || (flow?.start || 'start')
    };
    await saveMessageToLog(inboundItem);

    const agentHandling = ESCALATION_TABLE ? await hasPendingEscalationForUser(ESCALATION_TABLE, mobile) : false;
    const agentCooldown = BOT_CONFIG_TABLE ? await isAgentCooldownActive(BOT_CONFIG_TABLE, mobile) : false;
    const skipBot = agentHandling || agentCooldown;
    if (skipBot) {
      console.log(JSON.stringify({ event: 'skip_bot', requestId, mobile, reason: agentHandling ? 'pending_escalation' : 'agent_cooldown_1h' }));
    }

    if (botEnabled && phoneNumberId && !skipBot) {
      if (!state && flow) {
        state = {
          mobile,
          conversationId: `conv_${mobile}_${now}`,
          currentStep: flow.start || 'start',
          flowState: flow.start || 'start',
          userProfile: userProfile ? { name: userProfile.name, dob: userProfile.dob, city: userProfile.city, age: userProfile.age, mobile } : {},
          stepData: {},
          lastInteraction: now,
          createdAt: now
        };
      }
      if (flow && state) {
        try {
          if (userProfile && (userProfile.name || userProfile.dob || userProfile.city)) {
            state.userProfile = { ...(state.userProfile || {}), mobile, ...userProfile };
          }
          const result = await runFlow(state, ev.body, userProfile, flow);
          if (result.updatedState) {
            flowStepAfterReply = result.updatedState.currentStep || result.updatedState.flowState;
            if (CONVERSATION_STATE_TABLE) {
              await saveConversationState(CONVERSATION_STATE_TABLE, result.updatedState);
            }
            if (USER_PROFILE_TABLE) {
              const up = result.updatedState.userProfile || {};
              const sd = result.updatedState.stepData || {};
              const name = up.name || sd.name;
              const dob = up.dob || sd.dob;
              const city = up.city || sd.city;
              const area = up.area || sd.area;
              const age = up.age ?? sd.age;
              if (name || dob || city) {
                const profileToSave = {
                  mobile,
                  ...(userProfile || {}),
                  ...(name && { name }),
                  ...(dob && { dob }),
                  ...(city && { city }),
                  ...(area && { area }),
                  ...(age != null && { age }),
                  status: (userProfile && userProfile.status) || 'lead'
                };
                try {
                  await saveUserProfile(USER_PROFILE_TABLE, profileToSave);
                } catch (err) {
                  console.warn(JSON.stringify({ event: 'user_profile_save_error', mobile, error: err.message }));
                }
              }
            }
          }
          if (ESCALATION_TABLE && result.referralEscalation) {
            await createEscalation(ESCALATION_TABLE, {
              mobile,
              conversationId,
              userProfile: userProfile || {},
              escalationReason: 'Referral_Lead',
              referralName: result.referralEscalation.referralName,
              referralMobile: result.referralEscalation.referralMobile,
              referralCity: result.referralEscalation.referralCity
            });
          }
          if (ESCALATION_TABLE && result.supportEscalation) {
            await createEscalation(ESCALATION_TABLE, {
              mobile,
              conversationId,
              userProfile: userProfile || {},
              escalationReason: 'RM_Escalation_Required'
            });
          }
          const firstMsg = result.messages && result.messages[0];
          replyBody = firstMsg && firstMsg.body ? firstMsg.body : '';
        } catch (err) {
          console.warn(JSON.stringify({ event: 'flow_run_error', requestId, mobile, error: err.message }));
          replyBody = 'Got it. We will get back to you shortly.';
        }
      } else {
        replyBody = 'Got it. We will get back to you shortly.';
      }
    } else if (botEnabled && !phoneNumberId) {
      console.warn(JSON.stringify({ event: 'meta_phone_number_id_missing', requestId, mobile }));
    }
    if (replyBody) {
      const sendResult = await sendMetaWhatsAppText(phoneNumberId, mobile, replyBody);
      outboundMetaMessageId = sendResult.metaMessageId || null;
      if (!sendResult.success) {
        console.warn(JSON.stringify({ event: 'meta_send_failed', requestId, mobile, error: sendResult.error }));
      }
    }
    if (replyBody) {
      await saveMessageToLog({
        mobile,
        timestamp: now,
        conversationId,
        direction: 'outbound',
        source: 'meta',
        type: 'text',
        messageText: replyBody,
        metaMessageId: outboundMetaMessageId,
        waNumber: mobile,
        flowId: DEFAULT_FLOW_ID,
        flowStep: flowStepAfterReply || state?.currentStep || state?.flowState || (flow?.start || 'start')
      });
    }
  }

  return respond(200, { success: true, eventId });
}

exports.handler = async (event) => {
  const method = (event.httpMethod || event.requestContext?.http?.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (method === 'GET') {
    return await handleGet(event);
  }
  if (method === 'POST') {
    return await handlePost(event);
  }

  return respond(405, { success: false, error: 'Method not allowed' });
};

