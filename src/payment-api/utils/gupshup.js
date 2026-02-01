const https = require('https');

const GUPSHUP_USER_ID = process.env.GUPSHUP_USER_ID;
const GUPSHUP_PASSWORD = process.env.GUPSHUP_PASSWORD;
const GUPSHUP_URL = 'https://mediaapi.smsgupshup.com/GatewayAPI/rest';

function toSendTo(mobile) {
  const s = String(mobile).replace(/\D/g, '');
  if (s.length === 10) return '91' + s;
  if (s.length === 12 && s.startsWith('91')) return s;
  return s;
}

/**
 * Build form body for template with var1 and var2 (team name, amount confirmed).
 */
function buildFormBody(send_to, templateId, var1, var2) {
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
  if (var1 != null && var1 !== '') pairs.push(['var1', String(var1)]);
  if (var2 != null && var2 !== '') pairs.push(['var2', String(var2)]);
  return pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
}

/**
 * Send WhatsApp template (2 variables: team name, amount confirmed).
 * @param {string} mobile - Recipient mobile (E.164 or 10 digit)
 * @param {string} templateId - Template ID (e.g. f6c74b47-bdea-4f09-ac08-a99b486e6a5a)
 * @param {string} var1 - Team name
 * @param {string} var2 - Amount confirmed (e.g. "₹500")
 * @returns {Promise<object>} { success, messageId?, error? }
 */
function sendAntakshariConfirmationTemplate(mobile, templateId, var1, var2) {
  return new Promise((resolve, reject) => {
    const send_to = toSendTo(mobile);
    if (!GUPSHUP_USER_ID || !GUPSHUP_PASSWORD) {
      console.warn(JSON.stringify({ message: 'Gupshup credentials not configured, skipping WhatsApp send', mobile }));
      resolve({ success: false, message: 'Gupshup not configured' });
      return;
    }
    if (!mobile || !templateId) {
      reject(new Error('mobile and templateId are required'));
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

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => { responseData += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          const success =
            (parsed.response && parsed.response.status === 'success') ||
            parsed.status === 'success' ||
            parsed.status === 'submitted';
          if (!success) {
            console.warn(JSON.stringify({
              message: 'Gupshup Antakshari template failed',
              mobile,
              details: parsed.response?.details || parsed.details
            }));
          }
          resolve({
            success: !!success,
            messageId: parsed.response?.id || parsed.id || null,
            data: parsed
          });
        } catch (e) {
          if (res.statusCode === 200) resolve({ success: true, data: { raw: responseData } });
          else reject(new Error(`Gupshup response: ${responseData}`));
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

module.exports = { sendAntakshariConfirmationTemplate };
