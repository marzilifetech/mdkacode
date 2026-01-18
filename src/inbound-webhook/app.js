const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');
const querystring = require('querystring');

// Initialize AWS SDK clients
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqsClient = new SQSClient({});

// Environment variables
const MESSAGE_LOG_TABLE_NAME = process.env.MESSAGE_LOG_TABLE_NAME;
const INBOUND_QUEUE_URL = process.env.INBOUND_QUEUE_URL;
const WHATSAPP_BUSINESS_NUMBER = process.env.WHATSAPP_BUSINESS_NUMBER || '916366743602';
const SKIP_AWS_CALLS = process.env.SKIP_AWS_CALLS === 'true' || process.env.AWS_SAM_LOCAL === 'true';

/**
 * Detect Gupshup event type
 * @param {object} gupshupPayload - Gupshup JSON payload
 * @returns {string} Event type: 'message', 'status', 'verification', or 'unknown'
 */
function detectEventType(gupshupPayload) {
  // Check for webhook verification/status events (WhatsApp Business API format)
  if (gupshupPayload.object === 'whatsapp_business_account' || 
      gupshupPayload.object === 'page') {
    if (gupshupPayload.entry && Array.isArray(gupshupPayload.entry)) {
      for (const entry of gupshupPayload.entry) {
        if (entry.changes && Array.isArray(entry.changes)) {
          for (const change of entry.changes) {
            if (change.value) {
              // Status events (delivery reports)
              if (change.value.statuses && Array.isArray(change.value.statuses)) {
                return 'status';
              }
              // Message events
              if (change.value.messages && Array.isArray(change.value.messages)) {
                return 'message';
              }
              // Verification events
              if (change.value.statuses && change.value.statuses.some(s => s.type === 'set-callback')) {
                return 'verification';
              }
            }
          }
        }
      }
    }
    return 'verification'; // Default for webhook setup events
  }
  
  // Check for standard Gupshup message format
  if (gupshupPayload.type === 'message' && gupshupPayload.payload) {
    return 'message';
  }
  
  // Check for event types
  if (gupshupPayload.type === 'event') {
    return 'event';
  }
  
  return 'unknown';
}

/**
 * Parse Gupshup JSON payload format
 * According to: https://docs.gupshup.io/docs/what-is-an-inbound-message
 * @param {object} gupshupPayload - Gupshup JSON payload
 * @returns {object} Normalized payload object
 */
function parseGupshupPayload(gupshupPayload) {
  const { app, timestamp, version, type, payload } = gupshupPayload;
  
  if (type !== 'message' || !payload) {
    throw new Error('Invalid Gupshup payload: expected message type');
  }
  
  const {
    id: messageId,
    source: mobile,
    type: messageType,
    payload: messagePayload,
    sender,
    context
  } = payload;
  
  // Extract message content based on type
  let messageText = '';
  let image = null;
  let sticker = null;
  
  if (messageType === 'text' && messagePayload && messagePayload.text) {
    messageText = messagePayload.text;
  } else if (messageType === 'image' && messagePayload) {
    image = messagePayload;
    messageText = messagePayload.caption || '';
  } else if (messageType === 'file' && messagePayload) {
    // Handle file/document
    messageText = messagePayload.caption || '';
  } else if (messageType === 'audio' && messagePayload) {
    messageText = '[Audio message]';
  } else if (messageType === 'video' && messagePayload) {
    messageText = messagePayload.caption || '[Video message]';
  } else if (messageType === 'location' && messagePayload) {
    messageText = `Location: ${messagePayload.latitude}, ${messagePayload.longitude}`;
  } else if (messageType === 'contact' && messagePayload) {
    messageText = `Contact: ${messagePayload.name || ''} ${messagePayload.phone_number || ''}`;
  } else if (messageType === 'button_reply' && messagePayload) {
    messageText = messagePayload.title || messagePayload.id || '';
  } else if (messageType === 'list_reply' && messagePayload) {
    messageText = messagePayload.title || messagePayload.id || '';
  }
  
  // Build normalized payload
  const normalized = {
    waNumber: mobile, // WhatsApp Business number (source)
    mobile: mobile,   // User's mobile number
    timestamp: timestamp || Date.now(),
    type: messageType,
    messageText: messageText,
    messageId: messageId || null,
    replyId: context?.id || null,
    gsId: context?.gsId || null,
    name: sender?.name || null,
    app: app || null,
    version: version || null
  };
  
  // Add media-specific fields
  if (image) {
    normalized.image = image;
  }
  if (sticker) {
    normalized.sticker = sticker;
  }
  
  // Add sender information
  if (sender) {
    normalized.sender = {
      phone: sender.phone,
      name: sender.name,
      country_code: sender.country_code,
      dial_code: sender.dial_code
    };
  }
  
  // Add context if available (reply to message)
  if (context) {
    normalized.context = {
      id: context.id,
      gsId: context.gsId
    };
  }
  
  return normalized;
}

/**
 * Handle webhook verification event
 * Gupshup sends this when setting up the webhook
 * @param {object} gupshupPayload - Gupshup JSON payload
 * @returns {object} Response indicating verification handled
 */
function handleVerificationEvent(gupshupPayload) {
  console.log(JSON.stringify({
    message: '✅ Webhook verification event received',
    object: gupshupPayload.object,
    gs_app_id: gupshupPayload.gs_app_id,
    entry_count: gupshupPayload.entry?.length || 0
  }));
  
  // Return success - Gupshup just needs 200 OK
  return {
    handled: true,
    type: 'verification',
    message: 'Webhook verified successfully'
  };
}

/**
 * Handle status event (delivery reports)
 * @param {object} gupshupPayload - Gupshup JSON payload
 * @returns {object} Response indicating status handled
 */
function handleStatusEvent(gupshupPayload) {
  const statuses = [];
  
  if (gupshupPayload.entry) {
    for (const entry of gupshupPayload.entry) {
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.value && change.value.statuses) {
            statuses.push(...change.value.statuses);
          }
        }
      }
    }
  }
  
  console.log(JSON.stringify({
    message: '📊 Status event received (delivery reports)',
    status_count: statuses.length,
    statuses: statuses.map(s => ({
      id: s.id,
      status: s.status,
      timestamp: s.timestamp
    }))
  }));
  
  // Status events don't need processing - just acknowledge
  return {
    handled: true,
    type: 'status',
    statusCount: statuses.length
  };
}

/**
 * Handle WhatsApp Business API message format
 * Different from standard Gupshup format
 * @param {object} gupshupPayload - Gupshup JSON payload
 * @returns {object} Normalized payload object
 */
function parseWhatsAppBusinessMessage(gupshupPayload) {
  const messages = [];
  
  if (gupshupPayload.entry) {
    for (const entry of gupshupPayload.entry) {
      if (entry.changes) {
        for (const change of entry.changes) {
          if (change.value && change.value.messages) {
            messages.push(...change.value.messages);
          }
        }
      }
    }
  }
  
  if (messages.length === 0) {
    throw new Error('No messages found in WhatsApp Business API format');
  }
  
  // Process first message (typically one message per webhook call)
  const message = messages[0];
  
  // Extract metadata and contacts from the value object
  const value = gupshupPayload.entry?.[0]?.changes?.[0]?.value || {};
  const contacts = value.contacts || [];
  const metadata = value.metadata || {};
  const contact = contacts.find(c => c.wa_id === message.from) || {};
  
  // Extract WhatsApp Business number from metadata, with fallback to environment variable
  const waNumber = metadata.display_phone_number || 
                   metadata.phone_number_id || 
                   message.to || 
                   WHATSAPP_BUSINESS_NUMBER;
  
  // Log extraction for debugging
  console.log(JSON.stringify({
    message: 'Extracting WhatsApp Business API fields',
    metadata: {
      display_phone_number: metadata.display_phone_number,
      phone_number_id: metadata.phone_number_id
    },
    extracted_waNumber: waNumber,
    fallback_waNumber: WHATSAPP_BUSINESS_NUMBER,
    message_from: message.from,
    message_to: message.to
  }));
  
  let messageText = '';
  let messageType = message.type;
  
  // Extract message content based on type
  if (messageType === 'text' && message.text) {
    messageText = message.text.body || '';
  } else if (messageType === 'image' && message.image) {
    messageText = message.image.caption || '';
  } else if (messageType === 'video' && message.video) {
    messageText = message.video.caption || '';
  } else if (messageType === 'audio' && message.audio) {
    messageText = '[Audio message]';
  } else if (messageType === 'document' && message.document) {
    messageText = message.document.caption || `[Document: ${message.document.filename || 'file'}]`;
  } else if (messageType === 'location' && message.location) {
    messageText = `Location: ${message.location.latitude}, ${message.location.longitude}`;
  } else if (messageType === 'contacts' && message.contacts) {
    messageText = `Contact: ${message.contacts[0]?.name?.formatted_name || ''}`;
  } else if (messageType === 'button' && message.button) {
    messageText = message.button.text || message.button.payload || '';
  } else if (messageType === 'interactive' && message.interactive) {
    if (message.interactive.type === 'button_reply') {
      messageText = message.interactive.button_reply?.title || '';
    } else if (message.interactive.type === 'list_reply') {
      messageText = message.interactive.list_reply?.title || '';
    }
  }
  
  const mobile = message.from || '';
  
  return {
    waNumber: waNumber, // Already has fallback to WHATSAPP_BUSINESS_NUMBER
    mobile: mobile,
    timestamp: parseInt(message.timestamp) * 1000 || Date.now(), // Convert to milliseconds
    type: messageType,
    messageText: messageText,
    messageId: message.id || null,
    replyId: message.context?.id || null,
    name: contact.profile?.name || null,
    app: gupshupPayload.gs_app_id || null,
    version: null
  };
}

/**
 * Parse URL-encoded body (legacy format for backward compatibility)
 * @param {string} body - URL-encoded string
 * @returns {object} Parsed payload object
 */
function parseUrlEncodedPayload(body) {
  // Parse the URL-encoded string
  const parsed = querystring.parse(body);
  
  // Handle nested JSON strings in image and sticker fields
  if (parsed.image && typeof parsed.image === 'string') {
    try {
      // Decode URL-encoded JSON string and parse it
      const decoded = decodeURIComponent(parsed.image);
      parsed.image = JSON.parse(decoded);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'Failed to parse image field',
        error: error.message,
        rawImage: parsed.image
      }));
      // Keep as string if parsing fails
    }
  }
  
  if (parsed.sticker && typeof parsed.sticker === 'string') {
    try {
      // Decode URL-encoded JSON string and parse it
      const decoded = decodeURIComponent(parsed.sticker);
      parsed.sticker = JSON.parse(decoded);
    } catch (error) {
      console.error(JSON.stringify({
        message: 'Failed to parse sticker field',
        error: error.message,
        rawSticker: parsed.sticker
      }));
      // Keep as string if parsing fails
    }
  }
  
  // Normalize URL-encoded format to match expected structure
  return {
    waNumber: parsed.waNumber || '',
    mobile: parsed.mobile || '',
    timestamp: parsed.timestamp ? Number(parsed.timestamp) : Date.now(),
    type: parsed.type || 'text',
    messageText: parsed.text || parsed.messageText || '',
    messageId: parsed.messageId || null,
    replyId: parsed.replyId || null,
    name: parsed.name || null,
    image: parsed.image || null,
    sticker: parsed.sticker || null
  };
}

/**
 * Validate required fields in the payload
 * @param {object} payload - Parsed payload object
 * @returns {boolean} True if valid, false otherwise
 */
function validatePayload(payload) {
  const requiredFields = ['waNumber', 'mobile', 'timestamp', 'type'];
  
  for (const field of requiredFields) {
    if (!payload[field]) {
      return false;
    }
  }
  
  return true;
}

/**
 * Lambda handler function
 * @param {object} event - API Gateway event
 * @returns {object} API Gateway response
 */
exports.handler = async (event) => {
  const requestId = event.requestContext?.requestId || `req_${Date.now()}`;
  const startTime = Date.now();
  
  try {
    // Log incoming request details
    console.log(JSON.stringify({
      message: '=== INBOUND WEBHOOK REQUEST RECEIVED ===',
      requestId: requestId,
      httpMethod: event.httpMethod,
      path: event.path,
      headers: {
        'Content-Type': event.headers?.['Content-Type'] || event.headers?.['content-type'] || 'not-set',
        'User-Agent': event.headers?.['User-Agent'] || event.headers?.['user-agent'] || 'not-set'
      },
      bodyPreview: event.body ? 
        (typeof event.body === 'string' ? event.body.substring(0, 500) : JSON.stringify(event.body).substring(0, 500)) : 
        'empty',
      bodyLength: event.body ? (typeof event.body === 'string' ? event.body.length : JSON.stringify(event.body).length) : 0
    }));
    
    // Detect content type from headers
    const contentType = event.headers?.['Content-Type'] || 
                       event.headers?.['content-type'] || 
                       '';
    
    let parsedPayload;
    
    // Parse based on content type
    // Gupshup sends JSON payloads according to their documentation
    if (contentType.includes('application/json') || 
        (event.body && event.body.trim().startsWith('{'))) {
      // JSON format (Gupshup standard format)
      try {
        const gupshupPayload = typeof event.body === 'string' 
          ? JSON.parse(event.body) 
          : event.body;
        
        // Detect event type
        const eventType = detectEventType(gupshupPayload);
        
        console.log(JSON.stringify({
          message: '🔍 Detected event type',
          requestId: requestId,
          eventType: eventType,
          object: gupshupPayload.object,
          type: gupshupPayload.type
        }));
        
        // Handle different event types
        if (eventType === 'verification') {
          // Webhook verification - just acknowledge
          const result = handleVerificationEvent(gupshupPayload);
          console.log(JSON.stringify({
            message: '✅ Webhook verification handled',
            requestId: requestId
          }));
          
          return {
            statusCode: 200,
            body: '',
            headers: {
              'Content-Type': 'text/plain'
            }
          };
        } else if (eventType === 'status') {
          // Status events (delivery reports) - acknowledge but don't process
          const result = handleStatusEvent(gupshupPayload);
          console.log(JSON.stringify({
            message: '✅ Status event handled',
            requestId: requestId,
            statusCount: result.statusCount
          }));
          
          return {
            statusCode: 200,
            body: '',
            headers: {
              'Content-Type': 'text/plain'
            }
          };
        } else if (eventType === 'message') {
          // Message event - process it
          // Check if it's WhatsApp Business API format or standard Gupshup format
          if (gupshupPayload.object === 'whatsapp_business_account' || 
              gupshupPayload.object === 'page') {
            // WhatsApp Business API format
            parsedPayload = parseWhatsAppBusinessMessage(gupshupPayload);
            console.log(JSON.stringify({
              message: '✅ Parsed WhatsApp Business API message',
              requestId: requestId,
              payloadType: 'whatsapp-business-api',
              messageType: parsedPayload.type
            }));
          } else {
            // Standard Gupshup format
            parsedPayload = parseGupshupPayload(gupshupPayload);
            console.log(JSON.stringify({
              message: '✅ Parsed Gupshup JSON payload successfully',
              requestId: requestId,
              payloadType: 'json',
              app: gupshupPayload.app,
              version: gupshupPayload.version,
              messageType: parsedPayload.type
            }));
          }
        } else {
          // Unknown event type - log but don't fail
          console.warn(JSON.stringify({
            message: '⚠️ Unknown event type - acknowledging',
            requestId: requestId,
            eventType: eventType,
            payload: gupshupPayload
          }));
          
          return {
            statusCode: 200,
            body: '',
            headers: {
              'Content-Type': 'text/plain'
            }
          };
        }
      } catch (error) {
        console.error(JSON.stringify({
          message: '❌ Failed to parse JSON payload',
          requestId: requestId,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack
          },
          bodyPreview: typeof event.body === 'string' ? event.body.substring(0, 500) : JSON.stringify(event.body).substring(0, 500)
        }));
        
        return {
          statusCode: 400,
          body: '',
          headers: {
            'Content-Type': 'text/plain'
          }
        };
      }
    } else {
      // URL-encoded format (legacy/backward compatibility)
      parsedPayload = parseUrlEncodedPayload(event.body);
      
      console.log(JSON.stringify({
        message: '✅ Parsed URL-encoded payload successfully',
        requestId: requestId,
        payloadType: 'url-encoded',
        fullPayload: parsedPayload
      }));
    }
    
    // Only process if we have a parsed payload (message events)
    // Verification and status events are already handled and returned above
    if (!parsedPayload) {
      console.warn(JSON.stringify({
        message: '⚠️ No payload to process - event may have been handled already',
        requestId: requestId
      }));
      
      return {
        statusCode: 200,
        body: '',
        headers: {
          'Content-Type': 'text/plain'
        }
      };
    }
    
    // Log the complete parsed payload for testing
    console.log(JSON.stringify({
      message: '📋 COMPLETE PARSED PAYLOAD',
      requestId: requestId,
      timestamp: new Date().toISOString(),
      payload: {
        waNumber: parsedPayload.waNumber,
        mobile: parsedPayload.mobile,
        timestamp: parsedPayload.timestamp,
        type: parsedPayload.type,
        messageId: parsedPayload.messageId,
        replyId: parsedPayload.replyId,
        gsId: parsedPayload.gsId,
        name: parsedPayload.name,
        messageText: parsedPayload.messageText,
        app: parsedPayload.app,
        version: parsedPayload.version,
        sender: parsedPayload.sender,
        context: parsedPayload.context,
        image: parsedPayload.image ? '[Image data present]' : null,
        sticker: parsedPayload.sticker ? '[Sticker data present]' : null
      }
    }));
    
    // Validate required fields
    console.log(JSON.stringify({
      message: '🔍 Validating payload',
      requestId: requestId,
      requiredFields: ['waNumber', 'mobile', 'timestamp', 'type'],
      payloadFields: {
        waNumber: !!parsedPayload.waNumber,
        mobile: !!parsedPayload.mobile,
        timestamp: !!parsedPayload.timestamp,
        type: !!parsedPayload.type
      }
    }));
    
    if (!validatePayload(parsedPayload)) {
      console.error(JSON.stringify({
        message: '❌ VALIDATION FAILED: Missing required fields',
        requestId: requestId,
        payload: parsedPayload,
        missingFields: ['waNumber', 'mobile', 'timestamp', 'type'].filter(
          field => !parsedPayload[field]
        )
      }));
      
      return {
        statusCode: 400,
        body: '',
        headers: {
          'Content-Type': 'text/plain'
        }
      };
    }
    
    console.log(JSON.stringify({
      message: '✅ Payload validation passed',
      requestId: requestId
    }));
    
    // Prepare DynamoDB item
    // Convert timestamp to Number for the Sort Key
    const dynamoItem = {
      ...parsedPayload,
      timestamp: Number(parsedPayload.timestamp)
    };
    
    console.log(JSON.stringify({
      message: '💾 Preparing DynamoDB item',
      requestId: requestId,
      table: MESSAGE_LOG_TABLE_NAME,
      item: {
        mobile: dynamoItem.mobile,
        timestamp: dynamoItem.timestamp,
        type: dynamoItem.type,
        messageId: dynamoItem.messageId,
        direction: 'inbound'
      }
    }));
    
    // Save to DynamoDB (skip if in local test mode)
    if (!SKIP_AWS_CALLS) {
      const putCommand = new PutCommand({
        TableName: MESSAGE_LOG_TABLE_NAME,
        Item: dynamoItem
      });
      
      await dynamoClient.send(putCommand);
      console.log(JSON.stringify({
        message: '✅ Message saved to DynamoDB successfully',
        requestId: requestId,
        table: MESSAGE_LOG_TABLE_NAME,
        mobile: dynamoItem.mobile,
        timestamp: dynamoItem.timestamp
      }));
    } else {
      console.log(JSON.stringify({
        message: '⚠️ Skipping DynamoDB call (local test mode)',
        requestId: requestId,
        item: dynamoItem
      }));
    }
    
    // Send to SQS (skip if in local test mode)
    console.log(JSON.stringify({
      message: '📤 Preparing SQS message',
      requestId: requestId,
      queueUrl: INBOUND_QUEUE_URL,
      messageSize: JSON.stringify(parsedPayload).length
    }));
    
    if (!SKIP_AWS_CALLS) {
      const sqsCommand = new SendMessageCommand({
        QueueUrl: INBOUND_QUEUE_URL,
        MessageBody: JSON.stringify(parsedPayload)
      });
      
      const sqsResponse = await sqsClient.send(sqsCommand);
      console.log(JSON.stringify({
        message: '✅ Message sent to SQS successfully',
        requestId: requestId,
        queue: INBOUND_QUEUE_URL,
        messageId: sqsResponse.MessageId,
        mobile: parsedPayload.mobile,
        type: parsedPayload.type
      }));
    } else {
      console.log(JSON.stringify({
        message: '⚠️ Skipping SQS call (local test mode)',
        requestId: requestId,
        messageBody: JSON.stringify(parsedPayload)
      }));
    }
    
    const processingTime = Date.now() - startTime;
    
    // Return success response
    // Gupshup requires HTTP_SUCCESS (2xx) with empty response body
    console.log(JSON.stringify({
      message: '✅ === WEBHOOK PROCESSING COMPLETE ===',
      requestId: requestId,
      status: 'success',
      statusCode: 200,
      processingTimeMs: processingTime,
      mobile: parsedPayload.mobile,
      messageType: parsedPayload.type,
      messageText: parsedPayload.messageText?.substring(0, 50)
    }));
    
    return {
      statusCode: 200,
      body: '',
      headers: {
        'Content-Type': 'text/plain'
      }
    };
    
  } catch (error) {
    const processingTime = Date.now() - startTime;
    
    // Log structured error with full context
    console.error(JSON.stringify({
      message: '❌ === WEBHOOK PROCESSING ERROR ===',
      requestId: requestId,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      processingTimeMs: processingTime,
      timestamp: new Date().toISOString()
    }));
    
    // Return error response (empty body as per Gupshup requirements)
    // Gupshup will retry if we return non-2xx status
    return {
      statusCode: 500,
      body: '',
      headers: {
        'Content-Type': 'text/plain'
      }
    };
  }
};

