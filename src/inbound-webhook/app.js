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
const SKIP_AWS_CALLS = process.env.SKIP_AWS_CALLS === 'true' || process.env.AWS_SAM_LOCAL === 'true';

/**
 * Parse URL-encoded body and handle nested JSON strings
 * @param {string} body - URL-encoded string
 * @returns {object} Parsed payload object
 */
function parsePayload(body) {
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
  
  return parsed;
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
  try {
    // Parse the URL-encoded body
    const parsedPayload = parsePayload(event.body);
    
    // Log the parsed payload
    console.log(JSON.stringify({
      message: 'Parsed inbound payload',
      payload: parsedPayload
    }));
    
    // Validate required fields
    if (!validatePayload(parsedPayload)) {
      console.error(JSON.stringify({
        message: 'Validation failed: missing required fields',
        payload: parsedPayload
      }));
      
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Bad Request',
          message: 'Missing required fields: waNumber, mobile, timestamp, or type'
        }),
        headers: {
          'Content-Type': 'application/json'
        }
      };
    }
    
    // Prepare DynamoDB item
    // Convert timestamp to Number for the Sort Key
    const dynamoItem = {
      ...parsedPayload,
      timestamp: Number(parsedPayload.timestamp)
    };
    
    // Save to DynamoDB (skip if in local test mode)
    if (!SKIP_AWS_CALLS) {
      const putCommand = new PutCommand({
        TableName: MESSAGE_LOG_TABLE_NAME,
        Item: dynamoItem
      });
      
      await dynamoClient.send(putCommand);
      console.log(JSON.stringify({
        message: 'Message saved to DynamoDB',
        table: MESSAGE_LOG_TABLE_NAME
      }));
    } else {
      console.log(JSON.stringify({
        message: 'Skipping DynamoDB call (local test mode)',
        item: dynamoItem
      }));
    }
    
    // Send to SQS (skip if in local test mode)
    if (!SKIP_AWS_CALLS) {
      const sqsCommand = new SendMessageCommand({
        QueueUrl: INBOUND_QUEUE_URL,
        MessageBody: JSON.stringify(parsedPayload)
      });
      
      await sqsClient.send(sqsCommand);
      console.log(JSON.stringify({
        message: 'Message sent to SQS',
        queue: INBOUND_QUEUE_URL
      }));
    } else {
      console.log(JSON.stringify({
        message: 'Skipping SQS call (local test mode)',
        messageBody: JSON.stringify(parsedPayload)
      }));
    }
    
    // Return success response
    return {
      statusCode: 200,
      body: 'Message received',
      headers: {
        'Content-Type': 'text/plain'
      }
    };
    
  } catch (error) {
    // Log structured error
    console.error(JSON.stringify({
      message: 'Error processing inbound webhook',
      error: error.message,
      stack: error.stack
    }));
    
    // Return error response
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal Server Error',
        message: 'Failed to process message'
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }
};

