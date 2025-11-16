/**
 * Simple test script to test the Lambda handler locally
 * Usage: node test-handler.js
 */

const handler = require('./src/inbound-webhook/app.js').handler;

// Mock environment variables
process.env.MESSAGE_LOG_TABLE_NAME = 'WhatsAppMessageLog';
process.env.INBOUND_QUEUE_URL = 'https://sqs.ap-south-1.amazonaws.com/123456789012/InboundMessageQueue';

// Mock AWS SDK (for local testing without real AWS services)
// Note: This will fail on actual AWS calls, but you can test parsing/validation logic
const mockEvent = {
  body: 'waNumber=917834811114&mobile=919777777778&replyId=3914460380512464906&messageId=350465300787800379&timestamp=1564472864000&name=Sid+Smith&type=text&text=When+will+my+order+be+delivered'
};

async function runTest() {
  console.log('Testing Lambda Handler...\n');
  console.log('Event:', JSON.stringify(mockEvent, null, 2));
  console.log('\n--- Handler Response ---\n');
  
  try {
    const response = await handler(mockEvent);
    console.log('Status Code:', response.statusCode);
    console.log('Body:', response.body);
    console.log('Headers:', JSON.stringify(response.headers, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

runTest();

