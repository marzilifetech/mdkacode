const https = require('https');

// Same credentials and URL as auth-api (OTP) — mediaapi.smsgupshup.com GatewayAPI/rest
const GUPSHUP_USER_ID = process.env.GUPSHUP_USER_ID || '';
const GUPSHUP_PASSWORD = process.env.GUPSHUP_PASSWORD || '';
const GUPSHUP_URL = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';

function toSendTo(mobile) {
  const s = String(mobile).replace(/\D/g, '');
  if (s.length === 10) return '91' + s;
  if (s.length === 12 && s.startsWith('91')) return s;
  return s;
}

/**
 * Build form body — matches working curl (no isTemplate, no linkTrackingEnabled).
 * Order: send_to, msg_type, userid, auth_scheme, password, v, format, method, isHSM, msg_id, whatsAppTemplateId, var1, var2.
 */
function buildFormBody(send_to, templateId, var1, var2) {
  const pairs = [
    ['send_to', String(send_to)],
    ['msg_type', 'text'],
    ['userid', String(GUPSHUP_USER_ID)],
    ['auth_scheme', 'plain'],
    ['password', String(GUPSHUP_PASSWORD)],
    ['v', '1.1'],
    ['format', 'json'],
    ['method', 'SendMessage'],
    ['isHSM', 'true'],
    ['msg_id', String(templateId)],
    ['whatsAppTemplateId', String(templateId)],
    ['var1', var1 != null && var1 !== '' ? String(var1) : ''],
    ['var2', var2 != null && var2 !== '' ? String(var2) : '']
  ];
  return pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/**
 * Send WhatsApp template (2 variables: team name, amount confirmed).
 * @param {string} mobile - Recipient mobile (E.164 or 10 digit)
 * @param {string} templateId - Template ID (e.g. ANTAKSHARI_CONFIRMATION_TEMPLATE_ID)
 * @param {string} var1 - Team name
 * @param {string} var2 - Amount confirmed (e.g. "₹500")
 * @returns {Promise<object>} { success, messageId?, data? }
 */
function sendAntakshariConfirmationTemplate(mobile, templateId, var1, var2) {
  return new Promise((resolve, reject) => {
    const send_to = toSendTo(mobile);
    if (!mobile || !templateId) {
      reject(new Error('mobile and templateId are required'));
      return;
    }
    if (!GUPSHUP_USER_ID || !GUPSHUP_PASSWORD) {
      resolve({ success: false, messageId: null, data: { error: 'Gupshup not configured' } });
      return;
    }

    const formData = buildFormBody(send_to, templateId, var1, var2);
    const url = new URL(GUPSHUP_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(formData)
      }
    };

    const requestPayload = {
      url: GUPSHUP_URL,
      httpMethod: 'POST',
      send_to,
      msg_type: 'text',
      userid: GUPSHUP_USER_ID,
      auth_scheme: 'plain',
      password: GUPSHUP_PASSWORD ? '***' : '',
      v: '1.1',
      format: 'json',
      method: 'SendMessage',
      isHSM: 'true',
      msg_id: templateId,
      whatsAppTemplateId: templateId,
      var1: var1 != null && var1 !== '' ? String(var1) : '',
      var2: var2 != null && var2 !== '' ? String(var2) : ''
    };
    console.log(JSON.stringify({ event: 'gupshup_request', requestPayload }));

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = typeof responseData === 'string' && responseData.trim().startsWith('{')
            ? JSON.parse(responseData)
            : { raw: responseData };
        } catch (e) {
          parsed = { raw: responseData };
        }
        const status = parsed.response?.status ?? parsed.status;
        const messageId = parsed.response?.id ?? parsed.response?.messageId ?? parsed.id ?? parsed.messageId;
        const details = parsed.response?.details ?? parsed.details ?? parsed.message ?? parsed.error;
        const success =
          res.statusCode === 200 &&
          (status === 'success' ||
            status === 'submitted' ||
            (messageId && status !== 'error' && status !== 'failed'));
        const responsePayload = {
          statusCode: res.statusCode,
          responseBody: responseData,
          parsed,
          responseStatus: status,
          details,
          messageId: messageId || null,
          success: !!success
        };
        console.log(JSON.stringify({ event: 'gupshup_response', responsePayload }));
        if (!success) {
          console.warn(JSON.stringify({
            event: 'gupshup_template_failed',
            mobile: send_to,
            templateId,
            statusCode: res.statusCode,
            responseBody: responseData,
            responseStatus: status,
            details,
            messageId: messageId || null
          }));
        }
        resolve({
          success: !!success,
          messageId: messageId || null,
          data: parsed
        });
      });
    });
    req.on('error', (err) => reject(err));
    req.write(formData);
    req.end();
  });
}

module.exports = { sendAntakshariConfirmationTemplate };
