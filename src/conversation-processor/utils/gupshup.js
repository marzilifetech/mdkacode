const https = require('https');
const querystring = require('querystring');

/**
 * Send message via Gupshup API
 * @param {string} userId - Gupshup user ID
 * @param {string} password - Gupshup password
 * @param {string} mobile - Recipient mobile number
 * @param {string} message - Message text
 * @returns {Promise<object>} API response
 */
async function sendMessage(userId, password, mobile, message) {
  return new Promise((resolve, reject) => {
    if (!userId || !password) {
      console.warn(JSON.stringify({
        message: 'Gupshup credentials not configured, skipping message send',
        mobile
      }));
      resolve({ success: false, message: 'Gupshup not configured' });
      return;
    }

    const url = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';
    
    // Prepare form data
    const formData = querystring.stringify({
      userid: userId,
      password: password,
      method: 'SendMessage',
      auth_scheme: 'plain',
      v: '1.1',
      send_to: mobile,
      msg: message,
      isHSM: 'false',
      msg_type: 'TEXT',
      format: 'json'
    });

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData)
      }
    };

    const req = https.request(url, options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          
          // Check for success in response
          if (res.statusCode === 200) {
            // Gupshup API returns response in different formats
            // Check if response indicates success
            if (parsed.response && parsed.response.status === 'success') {
              resolve({ 
                success: true, 
                data: parsed,
                messageId: parsed.response.id || null
              });
            } else if (parsed.error) {
              reject(new Error(`Gupshup API error: ${parsed.error}`));
            } else {
              // Some responses don't have explicit status, assume success if 200
              resolve({ 
                success: true, 
                data: parsed 
              });
            }
          } else {
            reject(new Error(`Gupshup API error: ${res.statusCode} - ${responseData}`));
          }
        } catch (error) {
          // If response is not JSON, log it but don't fail
          console.warn(JSON.stringify({
            message: 'Gupshup response not JSON',
            response: responseData,
            error: error.message
          }));
          
          // If status is 200, assume success even if response isn't JSON
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
        message: 'Gupshup API request failed',
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
  sendMessage
};

