const https = require('https');

const GUPSHUP_USER_ID = process.env.GUPSHUP_USER_ID;
const GUPSHUP_PASSWORD = process.env.GUPSHUP_PASSWORD;
const GUPSHUP_URL = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';

/**
 * Normalize mobile to E.164 digits for send_to (match working CURL: 919936142128).
 */
function toSendTo(mobile) {
  const s = String(mobile).replace(/\D/g, '');
  if (s.length === 10) return '91' + s;
  if (s.length === 12 && s.startsWith('91')) return s;
  return s;
}

/**
 * Build form body in exact order of working CURL (all 14 params).
 * CURL order: send_to, msg_type, userid, auth_scheme, password, v, format, method, isHSM, isTemplate, linkTrackingEnabled, msg_id, whatsAppTemplateId, var1.
 */
function buildFormBodyAndPairs(send_to, templateId, variables) {
  const vars = variables || {};
  const var1 = (vars.var1 != null && vars.var1 !== '') ? String(vars.var1) : null;

  const pairs = [
    ['send_to', String(send_to)],
    ['msg_type', 'text'],
    ['userid', String(GUPSHUP_USER_ID)],
    ['auth_scheme', 'plain'],
    ['password', String(GUPSHUP_PASSWORD)],
    ['v', '1.1'],
    ['format', 'text'],
    ['method', 'SendMessage'],
    ['isHSM', 'true'],
    ['isTemplate', 'true'],
    ['linkTrackingEnabled', 'true'],
    ['msg_id', String(templateId)],
    ['whatsAppTemplateId', String(templateId)]
  ];

  if (var1 !== null) {
    pairs.push(['var1', var1]);
  }

  return pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/**
 * Send WhatsApp template via Gupshup — same params and order as working CURL.
 * @param {string} mobile - Recipient mobile (10 or 12 digit)
 * @param {string} templateId - META template ID (e.g. 1440838324490390)
 * @param {object} variables - { var1: otpCode }
 * @returns {Promise<object>} { success, messageId?, error? }
 */
function sendTemplateMessage(mobile, templateId, variables = {}) {
  return new Promise((resolve, reject) => {
    const send_to = toSendTo(mobile);

    if (!GUPSHUP_USER_ID || !GUPSHUP_PASSWORD) {
      console.error(JSON.stringify({ message: 'Gupshup credentials not configured' }));
      reject(new Error('Gupshup credentials not configured'));
      return;
    }
    if (!mobile || !templateId) {
      console.warn(JSON.stringify({ message: 'Gupshup missing mobile or templateId' }));
      reject(new Error('mobile and templateId are required'));
      return;
    }

    const formData = buildFormBodyAndPairs(send_to, templateId, variables);
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

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          if (res.statusCode === 200) {
            const success =
              (parsed.response && parsed.response.status === 'success') ||
              parsed.status === 'success' ||
              parsed.status === 'submitted';
            if (!success) {
              console.warn(JSON.stringify({
                message: 'Gupshup template failed',
                mobile,
                details: parsed.response?.details || parsed.details
              }));
            }
            resolve({
              success: !!success,
              messageId: parsed.response?.id || parsed.id || null,
              data: parsed
            });
          } else {
            console.error(JSON.stringify({
              message: 'Gupshup API non-200',
              mobile,
              statusCode: res.statusCode,
              responseData
            }));
            reject(new Error(`Gupshup HTTP ${res.statusCode}: ${responseData}`));
          }
        } catch (e) {
          if (res.statusCode !== 200) {
            console.warn(JSON.stringify({ message: 'Gupshup response parse error', mobile, error: e.message }));
          }
          if (res.statusCode === 200) {
            resolve({ success: true, data: { raw: responseData } });
          } else {
            reject(new Error(`Gupshup response: ${responseData}`));
          }
        }
      });
    });

    req.on('error', (err) => {
      console.error(JSON.stringify({ message: 'Gupshup request error', mobile, error: err.message }));
      reject(err);
    });
    req.write(formData);
    req.end();
  });
}

module.exports = { sendTemplateMessage };
