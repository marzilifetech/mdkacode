const https = require('https');
const querystring = require('querystring');

// Environment variables for template configuration
const WHATSAPP_TEMPLATE_ID = process.env.WHATSAPP_TEMPLATE_ID || '';
const WHATSAPP_TEMPLATE_HAS_HEADER = process.env.WHATSAPP_TEMPLATE_HAS_HEADER === 'true';
const WHATSAPP_TEMPLATE_HAS_FOOTER = process.env.WHATSAPP_TEMPLATE_HAS_FOOTER === 'true';
const WHATSAPP_TEMPLATE_IS_INTERACTIVE = process.env.WHATSAPP_TEMPLATE_IS_INTERACTIVE === 'true';

/**
 * Extract template variables from message text
 * If message contains placeholders like {{1}}, {{2}}, etc., extract them
 * Otherwise, treat entire message as var1
 * @param {string} message - Message text
 * @returns {object} Object with variables array and remaining message
 */
/**
 * Check if message contains emojis or special Unicode characters
 * @param {string} message - Message text
 * @returns {boolean} True if message contains emojis or special Unicode
 */
function containsUnicode(message) {
  if (!message || typeof message !== 'string') return false;
  
  // Check for emojis (Unicode ranges for emojis)
  const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{200D}]|[\u{203C}-\u{3299}]|[\u{FE00}-\u{FE0F}]/u;
  
  // Check for special characters beyond basic ASCII
  const hasNonASCII = /[^\x00-\x7F]/.test(message);
  
  return emojiRegex.test(message) || hasNonASCII;
}

function extractTemplateVariables(message) {
  // Check if message contains template variable placeholders
  const placeholderRegex = /\{\{(\d+)\}\}/g;
  const matches = [...message.matchAll(placeholderRegex)];
  
  if (matches.length > 0) {
    // Extract variables in order
    const variables = {};
    let varIndex = 1;
    
    // Split message by placeholders and extract text between them
    let lastIndex = 0;
    for (const match of matches) {
      const placeholderIndex = parseInt(match[1]);
      const beforeText = message.substring(lastIndex, match.index).trim();
      
      if (beforeText) {
        variables[`var${varIndex}`] = beforeText;
        varIndex++;
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Get text after last placeholder
    const afterText = message.substring(lastIndex).trim();
    if (afterText) {
      variables[`var${varIndex}`] = afterText;
    }
    
    return variables;
  }
  
  // No placeholders found - treat entire message as single variable
  // Split by newlines or periods to create multiple variables if message is long
  if (message.length > 100) {
    // For long messages, split into chunks
    const chunks = message.split(/\n\n|\n|\. /).filter(chunk => chunk.trim().length > 0);
    const variables = {};
    chunks.forEach((chunk, index) => {
      if (index < 50) { // Max 50 variables per API
        variables[`var${index + 1}`] = chunk.trim();
      }
    });
    return variables;
  }
  
  // Single variable for short messages
  return { var1: message };
}

/**
 * Send message via Gupshup WhatsApp API
 * Supports both conversational messages (free text) and template-based messages
 * For conversational messages (user-initiated): Use free text without template
 * For template messages (business-initiated): Use template ID
 * @param {string} userId - Gupshup user ID (REQUIRED)
 * @param {string} password - Gupshup password (REQUIRED)
 * @param {string} mobile - Recipient mobile number in E.164 format (REQUIRED)
 * @param {string} message - Message text to send
 * @param {object} options - Optional parameters
 * @param {string} options.templateId - WhatsApp Template ID (for business-initiated messages)
 * @param {boolean} options.conversational - Force conversational mode (default: true if no template)
 * @param {string} options.header - Header text (if template has header)
 * @param {string} options.footer - Footer text (if template has footer)
 * @param {object} options.variables - Custom template variables (var1, var2, etc.)
 * @param {string} options.msgId - Custom message ID for tracking
 * @returns {Promise<object>} API response
 */
async function sendMessage(userId, password, mobile, message, options = {}) {
  return new Promise((resolve, reject) => {
    if (!userId || !password) {
      console.warn(JSON.stringify({
        message: 'Gupshup credentials not configured, skipping message send',
        mobile
      }));
      resolve({ success: false, message: 'Gupshup not configured' });
      return;
    }

    // Get template ID from options or environment variable
    const templateId = options.templateId || WHATSAPP_TEMPLATE_ID;
    
    // Determine if this is conversational (default: true if no template ID)
    const isConversational = options.conversational !== undefined 
      ? options.conversational 
      : !templateId;

    const url = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';
    
    // Prepare form data according to API documentation
    const formDataParams = {
      userid: userId,
      password: password,
      method: 'SendMessage',
      auth_scheme: 'plain',
      v: '1.1',
      send_to: mobile,
      format: 'json'
    };

    // CONVERSATIONAL MODE: Free text messages (user-initiated conversations)
    // No template required - WhatsApp allows free text in 2-way conversations
    // IMPORTANT: The provided API doc only covers template-based messaging
    // For conversational messages, we use minimal parameters
    // Message must be sent within 24 hours of user's last message
    if (isConversational && !templateId) {
      formDataParams.msg = message;
      formDataParams.isHSM = 'true';
      // Note: msg_type might not be needed for conversational messages
      // Some implementations work without it, but keeping it for compatibility
      formDataParams.msg_type = 'TEXT';
      
      // CRITICAL: Set data_encoding for emojis and special characters
      // According to Gupshup API: default is "text" (Plain English)
      // For emojis/special characters, must use "Unicode_text"
      if (containsUnicode(message)) {
        formDataParams.data_encoding = 'Unicode_text';
        console.log(JSON.stringify({
          message: 'Message contains emojis/Unicode - using Unicode_text encoding',
          mobile,
          hasEmojis: true
        }));
      } else {
        formDataParams.data_encoding = 'text';
      }
      
      // Explicitly ensure these are NOT set for conversational messages
      delete formDataParams.whatsAppTemplateId;
      delete formDataParams.isTemplate;
      
      console.log(JSON.stringify({
        message: 'Sending conversational message (free text, no template)',
        mobile,
        messageLength: message.length,
        dataEncoding: formDataParams.data_encoding,
        parameters: Object.keys(formDataParams),
        note: 'Message must be sent within 24 hours of user\'s last message. If not delivered, check Gupshup account configuration for conversational messaging.'
      }));
    }
    // TEMPLATE MODE: Template-based messaging (business-initiated notifications)
    else if (templateId) {
      formDataParams.whatsAppTemplateId = templateId;
      formDataParams.isHSM = 'true';
      formDataParams.msg_type = 'HSM'; // Recommended for template messages
      
      // Extract template variables from message
      const templateVars = options.variables || extractTemplateVariables(message);
      
      // Set isTemplate based on configuration or options
      if (options.isTemplate !== undefined) {
        formDataParams.isTemplate = options.isTemplate ? 'true' : 'false';
      } else if (WHATSAPP_TEMPLATE_IS_INTERACTIVE || WHATSAPP_TEMPLATE_HAS_HEADER || WHATSAPP_TEMPLATE_HAS_FOOTER) {
        formDataParams.isTemplate = 'true';
      } else {
        formDataParams.isTemplate = 'false';
      }
      
      // Add template variables (var1, var2, etc.)
      Object.keys(templateVars).forEach(key => {
        formDataParams[key] = templateVars[key];
      });
      
      // Add header if provided
      if (options.header) {
        formDataParams.header = options.header;
      }
      
      // Add footer if provided
      if (options.footer) {
        formDataParams.footer = options.footer;
      }
      
      // Add header variables (hvar1, hvar2, etc.) if provided
      if (options.headerVariables) {
        Object.keys(options.headerVariables).forEach(key => {
          formDataParams[key] = options.headerVariables[key];
        });
      }
      
      // Set data_encoding for emojis and special characters in template messages
      // Check message text and any variables for Unicode content
      const hasUnicodeInMessage = containsUnicode(message);
      const hasUnicodeInVars = Object.values(templateVars).some(val => 
        typeof val === 'string' && containsUnicode(val)
      );
      const hasUnicodeInHeader = options.header && containsUnicode(options.header);
      const hasUnicodeInFooter = options.footer && containsUnicode(options.footer);
      
      if (hasUnicodeInMessage || hasUnicodeInVars || hasUnicodeInHeader || hasUnicodeInFooter) {
        formDataParams.data_encoding = 'Unicode_text';
        console.log(JSON.stringify({
          message: 'Template message contains emojis/Unicode - using Unicode_text encoding',
          mobile,
          hasEmojis: true
        }));
      } else {
        formDataParams.data_encoding = 'text';
      }
      
      console.log(JSON.stringify({
        message: 'Sending template-based message',
        mobile,
        templateId,
        variableCount: Object.keys(templateVars).length,
        dataEncoding: formDataParams.data_encoding
      }));
    }
    // Fallback: conversational mode if template ID not provided
    else {
      formDataParams.msg = message;
      formDataParams.isHSM = 'true';
      formDataParams.msg_type = 'TEXT';
      
      console.log(JSON.stringify({
        message: 'Sending conversational message (no template ID provided)',
        mobile
      }));
    }
    
    // Add custom message ID for tracking
    if (options.msgId) {
      formDataParams.msg_id = options.msgId;
    }
    
    // Add link tracking if specified
    if (options.linkTrackingEnabled !== undefined) {
      formDataParams.linkTrackingEnabled = options.linkTrackingEnabled ? 'True' : 'False';
    }

    const formData = querystring.stringify(formDataParams);

    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData)
      }
    };

    const req = https.request(url, requestOptions, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        // Log full response for debugging
        console.log(JSON.stringify({
          message: '📥 Gupshup API Response Received',
          mobile: mobile,
          statusCode: res.statusCode,
          responseLength: responseData.length,
          responsePreview: responseData.substring(0, 500)
        }));
        
        try {
          const parsed = JSON.parse(responseData);
          
          // Log parsed response
          console.log(JSON.stringify({
            message: '📥 Gupshup API Response Parsed',
            mobile: mobile,
            parsedResponse: parsed
          }));
          
          // Check for success in response
          if (res.statusCode === 200) {
            // Gupshup API returns response in different formats
            // Check various success indicators
            if (parsed.response && parsed.response.status === 'success') {
              // Check details field for any warnings or additional info
              const details = parsed.response.details || '';
              const hasWarnings = details && details.toLowerCase().includes('warning');
              
              if (details && !hasWarnings) {
                console.log(JSON.stringify({
                  message: '✅ Gupshup API Success (response.status)',
                  mobile: mobile,
                  messageId: parsed.response.id || parsed.response.messageId,
                  details: details
                }));
              } else if (hasWarnings) {
                console.warn(JSON.stringify({
                  message: '⚠️ Gupshup API Success with Warnings',
                  mobile: mobile,
                  messageId: parsed.response.id || parsed.response.messageId,
                  details: details,
                  warning: 'Message accepted but may have delivery issues'
                }));
              } else {
                console.log(JSON.stringify({
                  message: '✅ Gupshup API Success (response.status)',
                  mobile: mobile,
                  messageId: parsed.response.id || parsed.response.messageId
                }));
              }
              
              resolve({ 
                success: true, 
                data: parsed,
                messageId: parsed.response.id || parsed.response.messageId || null,
                details: details
              });
            } else if (parsed.status === 'success' || parsed.status === 'submitted') {
              console.log(JSON.stringify({
                message: '✅ Gupshup API Success (status field)',
                mobile: mobile,
                messageId: parsed.id || parsed.messageId
              }));
              resolve({ 
                success: true, 
                data: parsed,
                messageId: parsed.id || parsed.messageId || null
              });
            } else if (parsed.error) {
              const errorMsg = typeof parsed.error === 'string' 
                ? parsed.error 
                : (parsed.error.message || JSON.stringify(parsed.error));
              console.error(JSON.stringify({
                message: '❌ Gupshup API Error',
                mobile: mobile,
                error: errorMsg,
                fullResponse: parsed
              }));
              reject(new Error(`Gupshup API error: ${errorMsg}`));
            } else if (parsed.response && parsed.response.error) {
              console.error(JSON.stringify({
                message: '❌ Gupshup API Error (response.error)',
                mobile: mobile,
                error: parsed.response.error,
                fullResponse: parsed
              }));
              reject(new Error(`Gupshup API error: ${parsed.response.error}`));
            } else if (parsed.response && parsed.response.details) {
              // Check if details field contains any warnings or errors
              const details = parsed.response.details;
              if (details && details.toLowerCase().includes('error')) {
                console.error(JSON.stringify({
                  message: '❌ Gupshup API Error in details',
                  mobile: mobile,
                  details: details,
                  fullResponse: parsed
                }));
                reject(new Error(`Gupshup API error: ${details}`));
              } else {
                // Details might contain warnings but message was accepted
                console.warn(JSON.stringify({
                  message: '⚠️ Gupshup API Response with details',
                  mobile: mobile,
                  details: details,
                  messageId: parsed.response.id,
                  status: parsed.response.status
                }));
                resolve({ 
                  success: true, 
                  data: parsed,
                  messageId: parsed.response.id || parsed.response.messageId || null
                });
              }
            } else {
              // Some responses don't have explicit status, assume success if 200
              console.log(JSON.stringify({
                message: '✅ Gupshup API Success (assumed from 200 status)',
                mobile: mobile,
                fullResponse: parsed
              }));
              resolve({ 
                success: true, 
                data: parsed,
                messageId: parsed.id || parsed.messageId || null
              });
            }
          } else {
            console.error(JSON.stringify({
              message: '❌ Gupshup API HTTP Error',
              mobile: mobile,
              statusCode: res.statusCode,
              response: responseData
            }));
            reject(new Error(`Gupshup API error: HTTP ${res.statusCode} - ${responseData}`));
          }
        } catch (error) {
          // If response is not JSON, log it but don't fail
          console.warn(JSON.stringify({
            message: 'Gupshup response not JSON',
            response: responseData,
            error: error.message,
            statusCode: res.statusCode
          }));
          
          // If status is 200, assume success even if response isn't JSON
          if (res.statusCode === 200) {
            resolve({ 
              success: true, 
              data: { raw: responseData },
              messageId: null
            });
          } else {
            reject(new Error(`Failed to parse Gupshup response: ${error.message}. Response: ${responseData}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error(JSON.stringify({
        message: 'Gupshup API request failed',
        mobile,
        error: error.message,
        stack: error.stack
      }));
      reject(new Error(`Gupshup API request failed: ${error.message}`));
    });

    // Log request details (without password) - show what we're sending
    const logData = {
      message: '📤 Sending message via Gupshup API',
      mobile,
      mode: isConversational && !templateId ? 'conversational' : 'template',
      hasTemplateId: !!templateId,
      method: 'POST',
      url: url,
      messageLength: message.length,
      messagePreview: message.substring(0, 100)
    };
    
    // Log form data parameters (without password)
    const safeFormData = { ...formDataParams };
    if (safeFormData.password) {
      safeFormData.password = '***HIDDEN***';
    }
    logData.formDataParams = safeFormData;
    
    // Only add variable count if in template mode
    if (templateId && options.variables) {
      logData.variableCount = Object.keys(options.variables).length;
    }
    
    console.log(JSON.stringify(logData));

    req.write(formData);
    req.end();
  });
}

/**
 * Send media message via Gupshup API
 * @param {string} userId - Gupshup user ID
 * @param {string} password - Gupshup password
 * @param {string} mobile - Recipient mobile number
 * @param {string} mediaUrl - Public URL of media file
 * @param {string} mediaType - Media type: IMAGE, VIDEO, or DOCUMENT
 * @param {object} options - Optional parameters
 * @param {string} options.templateId - WhatsApp Template ID
 * @param {string} options.caption - Caption text
 * @param {string} options.footer - Footer text
 * @returns {Promise<object>} API response
 */
async function sendMediaMessage(userId, password, mobile, mediaUrl, mediaType, options = {}) {
  return new Promise((resolve, reject) => {
    if (!userId || !password) {
      console.warn(JSON.stringify({
        message: 'Gupshup credentials not configured, skipping media send',
        mobile
      }));
      resolve({ success: false, message: 'Gupshup not configured' });
      return;
    }

    const templateId = options.templateId || WHATSAPP_TEMPLATE_ID;
    
    if (!templateId) {
      reject(new Error('WhatsApp Template ID is required for media messages'));
      return;
    }

    const url = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';
    
    const formDataParams = {
      userid: userId,
      password: password,
      method: 'SendMediaMessage',
      auth_scheme: 'plain',
      v: '1.1',
      send_to: mobile,
      msg_type: mediaType.toUpperCase(), // IMAGE, VIDEO, DOCUMENT
      media_url: mediaUrl,
      whatsAppTemplateId: templateId,
      isHSM: 'true',
      isTemplate: options.isTemplate !== undefined ? (options.isTemplate ? 'true' : 'false') : 'false',
      format: 'json'
    };

    // Add caption if provided
    if (options.caption) {
      formDataParams.msg = options.caption;
    }

    // Add footer if provided
    if (options.footer) {
      formDataParams.footer = options.footer;
    }

    // Add template variables if provided
    if (options.variables) {
      Object.keys(options.variables).forEach(key => {
        formDataParams[key] = options.variables[key];
      });
    }

    // Add filename for documents
    if (mediaType.toUpperCase() === 'DOCUMENT' && options.filename) {
      formDataParams.filename = options.filename;
    }

    const formData = querystring.stringify(formDataParams);

    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData)
      }
    };

    const req = https.request(url, requestOptions, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          
          if (res.statusCode === 200) {
            if (parsed.response && parsed.response.status === 'success') {
              resolve({ 
                success: true, 
                data: parsed,
                messageId: parsed.response.id || null
              });
            } else if (parsed.error) {
              reject(new Error(`Gupshup API error: ${parsed.error}`));
            } else {
              resolve({ 
                success: true, 
                data: parsed 
              });
            }
          } else {
            reject(new Error(`Gupshup API error: HTTP ${res.statusCode} - ${responseData}`));
          }
        } catch (error) {
          if (res.statusCode === 200) {
            resolve({ 
              success: true, 
              data: { raw: responseData } 
            });
          } else {
            reject(new Error(`Failed to parse Gupshup response: ${error.message}`));
          }
        }
      });
    });

    req.on('error', (error) => {
      console.error(JSON.stringify({
        message: 'Gupshup media API request failed',
        mobile,
        error: error.message
      }));
      reject(new Error(`Gupshup API request failed: ${error.message}`));
    });

    req.write(formData);
    req.end();
  });
}

module.exports = {
  sendMessage,
  sendMediaMessage
};

