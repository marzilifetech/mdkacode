const { processConversationFlow } = require('./conversationFlow');
const { saveMessageLog } = require('./utils/dynamodb');
const { sendMessage } = require('./utils/gupshup');
const { extractMessageText } = require('./utils/helpers');

// Environment variables
const MESSAGE_LOG_TABLE = process.env.MESSAGE_LOG_TABLE_NAME;
const GUPSHUP_USER_ID = process.env.GUPSHUP_USER_ID || '';
const GUPSHUP_PASSWORD = process.env.GUPSHUP_PASSWORD || '';

/**
 * Lambda handler for processing conversation flow
 * Triggered by SQS messages from InboundMessageQueue
 * @param {object} event - SQS event
 * @returns {Promise<object>} Processing result
 */
exports.handler = async (event) => {
  console.log(JSON.stringify({
    message: 'Conversation processor triggered',
    recordCount: event.Records?.length || 0
  }));

  const results = [];

  for (const record of event.Records || []) {
    try {
      // Parse SQS message body
      const messageBody = JSON.parse(record.body);
      const messageData = parseMessageData(messageBody);
      
      console.log(JSON.stringify({
        message: 'Processing message',
        mobile: messageData.mobile,
        messageText: messageData.messageText
      }));

      // Process conversation flow
      const flowResult = await processConversationFlow(messageData);
      
      // Send response via Gupshup
      let sendResult = null;
      if (flowResult.responseMessage) {
        try {
          sendResult = await sendMessage(
            GUPSHUP_USER_ID,
            GUPSHUP_PASSWORD,
            messageData.mobile,
            flowResult.responseMessage
          );
          
          console.log(JSON.stringify({
            message: 'Response sent via Gupshup',
            mobile: messageData.mobile,
            success: sendResult.success
          }));
        } catch (error) {
          console.error(JSON.stringify({
            message: 'Error sending message via Gupshup',
            mobile: messageData.mobile,
            error: error.message
          }));
          // Continue even if send fails - message is logged
        }
      }

      // Save message log
      const messageLogData = {
        mobile: messageData.mobile,
        timestamp: messageData.timestamp,
        waNumber: messageData.waNumber,
        type: messageData.type || 'text',
        direction: 'inbound',
        messageText: messageData.messageText,
        conversationId: flowResult.conversationState.conversationId,
        step: flowResult.conversationState.currentStep,
        responseSent: flowResult.responseMessage || null
      };
      
      // Add optional fields only if they exist
      if (messageData.messageId) messageLogData.messageId = messageData.messageId;
      if (messageData.replyId) messageLogData.replyId = messageData.replyId;
      
      // Build metadata object
      const metadata = {};
      if (flowResult.conversationState.userProfile.name) {
        metadata.name = flowResult.conversationState.userProfile.name;
      }
      if (messageData.image) metadata.image = messageData.image;
      if (messageData.sticker) metadata.sticker = messageData.sticker;
      
      if (Object.keys(metadata).length > 0) {
        messageLogData.metadata = metadata;
      }
      
      await saveMessageLog(MESSAGE_LOG_TABLE, messageLogData);

      results.push({
        success: true,
        mobile: messageData.mobile,
        conversationId: flowResult.conversationState.conversationId,
        step: flowResult.conversationState.currentStep,
        escalationId: flowResult.escalationId
      });

    } catch (error) {
      console.error(JSON.stringify({
        message: 'Error processing message',
        error: error.message,
        stack: error.stack,
        record: record.messageId
      }));

      results.push({
        success: false,
        error: error.message,
        recordId: record.messageId
      });
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Processing complete',
      processed: results.length,
      results
    })
  };
};

/**
 * Parse message data from SQS message body
 * @param {object} messageBody - Raw message body from SQS
 * @returns {object} Parsed message data
 */
function parseMessageData(messageBody) {
  const messageText = extractMessageText(messageBody);
  const timestamp = Number(messageBody.timestamp) || Date.now();
  
  return {
    mobile: messageBody.mobile || '',
    waNumber: messageBody.waNumber || '',
    messageId: messageBody.messageId || null,
    replyId: messageBody.replyId || null,
    timestamp,
    type: messageBody.type || 'text',
    messageText,
    name: messageBody.name || null,
    image: messageBody.image || null,
    sticker: messageBody.sticker || null
  };
}

