/**
 * Manual test script to send a WhatsApp message via Gupshup API
 * Run: node test-manual-send.js
 */

const https = require('https');
const querystring = require('querystring');

// Gupshup credentials
const GUPSHUP_USER_ID = '2000262614';
const GUPSHUP_PASSWORD = 'xk5sAZhq';
const MOBILE = '919936142128'; // Replace with your test number
const MESSAGE = 'Hello! This is a test message from Marzi Bot.';

// API endpoint
const url = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';

// Prepare form data for conversational message
const formDataParams = {
  userid: GUPSHUP_USER_ID,
  password: GUPSHUP_PASSWORD,
  method: 'SendMessage',
  auth_scheme: 'plain',
  v: '1.1',
  send_to: MOBILE,
  format: 'json',
  msg: MESSAGE,
  isHSM: 'true',
  msg_type: 'TEXT'
};

const formData = querystring.stringify(formDataParams);

console.log('📤 Sending manual test message...');
console.log('Mobile:', MOBILE);
console.log('Message:', MESSAGE);
console.log('Form Data:', JSON.stringify(formDataParams, null, 2));

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
    console.log('\n📥 Response Status:', res.statusCode);
    console.log('📥 Response Headers:', JSON.stringify(res.headers, null, 2));
    console.log('📥 Response Body:', responseData);
    
    try {
      const parsed = JSON.parse(responseData);
      console.log('\n✅ Parsed Response:', JSON.stringify(parsed, null, 2));
      
      if (parsed.response && parsed.response.status === 'success') {
        console.log('\n✅ SUCCESS! Message ID:', parsed.response.id);
      } else if (parsed.error) {
        console.log('\n❌ ERROR:', parsed.error);
      } else {
        console.log('\n⚠️ Unexpected response format');
      }
    } catch (error) {
      console.log('\n⚠️ Response is not JSON:', error.message);
    }
  });
});

req.on('error', (error) => {
  console.error('\n❌ Request Error:', error.message);
  console.error('Stack:', error.stack);
});

req.write(formData);
req.end();
