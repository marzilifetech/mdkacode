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
      
      // Log raw message body for debugging
      console.log(JSON.stringify({
        message: '📨 SQS Message Received',
        rawBody: messageBody,
        hasMessageText: !!messageBody.messageText,
        hasText: !!messageBody.text,
        type: messageBody.type
      }));
      
      const messageData = parseMessageData(messageBody);
      
      console.log(JSON.stringify({
        message: '📝 Processing message',
        mobile: messageData.mobile,
        messageText: messageData.messageText,
        messageTextLength: messageData.messageText?.length || 0,
        type: messageData.type,
        waNumber: messageData.waNumber
      }));

      // Process conversation flow
      console.log(JSON.stringify({
        message: '🔄 Processing conversation flow',
        mobile: messageData.mobile,
        messageText: messageData.messageText
      }));
      
      const flowResult = await processConversationFlow(messageData);
      
      console.log(JSON.stringify({
        message: '✅ Conversation flow processed',
        mobile: messageData.mobile,
        hasResponseMessage: !!flowResult.responseMessage,
        responseMessage: flowResult.responseMessage?.substring(0, 100) || 'NO RESPONSE',
        currentStep: flowResult.conversationState?.currentStep,
        conversationId: flowResult.conversationState?.conversationId
      }));
      
      // Send response via Gupshup
      let sendResult = null;
      
      // Ensure we always have a response message
      let responseMessage = flowResult.responseMessage;
      if (!responseMessage) {
        // Fallback: send a default greeting if no response generated
        responseMessage = "Hi! I'm Marzi Support. How can I help you today?";
        console.warn(JSON.stringify({
          message: '⚠️ No response message generated, using fallback',
          mobile: messageData.mobile,
          currentStep: flowResult.conversationState?.currentStep
        }));
      }
      
      if (responseMessage) {
        try {
          console.log(JSON.stringify({
            message: '📤 Attempting to send message via Gupshup',
            mobile: messageData.mobile,
            messageLength: responseMessage.length,
            hasCredentials: !!(GUPSHUP_USER_ID && GUPSHUP_PASSWORD),
            messagePreview: responseMessage.substring(0, 100)
          }));
          
          sendResult = await sendMessage(
            GUPSHUP_USER_ID,
            GUPSHUP_PASSWORD,
            messageData.mobile,
            responseMessage,
            { conversational: true } // Explicitly set conversational mode
          );
          
          console.log(JSON.stringify({
            message: '✅ Response sent via Gupshup',
            mobile: messageData.mobile,
            success: sendResult.success,
            messageId: sendResult.messageId,
            responseData: sendResult.data
          }));
        } catch (error) {
          console.error(JSON.stringify({
            message: '❌ Error sending message via Gupshup',
            mobile: messageData.mobile,
            error: error.message,
            stack: error.stack
          }));
          // Continue even if send fails - message is logged
        }
      } else {
        console.error(JSON.stringify({
          message: '❌ No response message to send',
          mobile: messageData.mobile
        }));
      }

      // Save message log with all fields
      const messageLogData = {
        mobile: messageData.mobile,
        timestamp: messageData.timestamp,
        waNumber: messageData.waNumber || messageData.mobile,
        type: messageData.type || 'text',
        direction: 'inbound',
        messageText: messageData.messageText || '',
        conversationId: flowResult.conversationState.conversationId,
        step: flowResult.conversationState.currentStep,
        flowState: flowResult.conversationState.flowState,
        responseSent: responseMessage || null,
        sendSuccess: sendResult?.success || false,
        gupshupMessageId: sendResult?.messageId || null
      };
      
      // Add optional fields only if they exist
      if (messageData.messageId) messageLogData.messageId = messageData.messageId;
      if (messageData.replyId) messageLogData.replyId = messageData.replyId;
      if (messageData.name) messageLogData.senderName = messageData.name;
      
      // Build metadata object with user profile and message details
      const metadata = {};
      if (flowResult.conversationState.userProfile) {
        if (flowResult.conversationState.userProfile.name) {
          metadata.userName = flowResult.conversationState.userProfile.name;
        }
        if (flowResult.conversationState.userProfile.dob) {
          metadata.userDOB = flowResult.conversationState.userProfile.dob;
        }
        if (flowResult.conversationState.userProfile.city) {
          metadata.userCity = flowResult.conversationState.userProfile.city;
        }
        if (flowResult.conversationState.userProfile.age) {
          metadata.userAge = flowResult.conversationState.userProfile.age;
        }
      }
      if (messageData.image) metadata.image = messageData.image;
      if (messageData.sticker) metadata.sticker = messageData.sticker;
      if (flowResult.escalationId) metadata.escalationId = flowResult.escalationId;
      
      if (Object.keys(metadata).length > 0) {
        messageLogData.metadata = metadata;
      }
      
      console.log(JSON.stringify({
        message: '💾 Saving message log to database',
        mobile: messageData.mobile,
        table: MESSAGE_LOG_TABLE,
        dataKeys: Object.keys(messageLogData)
      }));
      
      await saveMessageLog(MESSAGE_LOG_TABLE, messageLogData);
      
      console.log(JSON.stringify({
        message: '✅ Message log saved successfully',
        mobile: messageData.mobile,
        conversationId: flowResult.conversationState.conversationId,
        step: flowResult.conversationState.currentStep
      }));

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

