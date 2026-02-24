const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

/** Same token source as Meta webhook: env META_PAGE_ACCESS_TOKEN (local) or SSM META_PAGE_ACCESS_TOKEN_SSM_NAME. */
const META_PAT_SSM_NAME = process.env.META_PAGE_ACCESS_TOKEN_SSM_NAME || '';
const META_PAT_ENV = process.env.META_PAGE_ACCESS_TOKEN || '';
const META_GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v25.0';
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID || '';

const ssmClient = new SSMClient({});
let metaPatCached = null;
let metaPatCacheTime = 0;
const META_PAT_CACHE_MS = 5 * 60 * 1000; // 5 min, same as meta-webhook

/** OTP template: "{{1}} is your verification code." with Copy code button (English) */
const OTP_TEMPLATE_NAME = 'otp_verifcation_code_prod';
const OTP_TEMPLATE_LANGUAGE = 'en';

function normalizeMobile(mobile) {
  const digits = String(mobile).replace(/\D/g, '');
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return digits.slice(-15);
}

/** Get Meta Page Access Token — same resolution as meta-webhook: env first, then SSM. */
async function getMetaPat() {
  if (META_PAT_ENV) return META_PAT_ENV;
  if (!META_PAT_SSM_NAME) return '';
  if (metaPatCached && Date.now() - metaPatCacheTime < META_PAT_CACHE_MS) return metaPatCached;
  try {
    const out = await ssmClient.send(new GetParameterCommand({
      Name: META_PAT_SSM_NAME,
      WithDecryption: true
    }));
    const value = out.Parameter?.Value || '';
    if (value) {
      metaPatCached = value;
      metaPatCacheTime = Date.now();
    }
    return value;
  } catch (err) {
    console.warn('getMetaPat failed:', err.message);
    return '';
  }
}

/**
 * Send OTP via Meta WhatsApp Cloud API using template otp_verification_code (ENG/US).
 * Template body: "{{1}} is your verification code. For your security, do not share this code."
 * @param {string} mobile - Recipient mobile (10 or 12 digit, E.164)
 * @param {string} code - 6-digit OTP code
 * @returns {Promise<{ success: boolean, metaMessageId?: string, error?: string }>}
 */
async function sendOtpTemplate(mobile, code) {
  const to = normalizeMobile(mobile);
  const pid = META_PHONE_NUMBER_ID;
  if (!pid || !to) {
    return { success: false, error: 'META_PHONE_NUMBER_ID or mobile missing' };
  }
  const token = await getMetaPat();
  if (!token) {
    return { success: false, error: 'Meta access token not configured (SSM)' };
  }
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${pid}/messages`;
  const codeStr = String(code).slice(0, 15);
  const toDigits = to.replace(/\D/g, '').slice(-15);
  // Per Meta/YCloud docs: OTP auth templates with Copy Code use button sub_type "url" (not COPY_CODE).
  // Body + button both need the code; button param substitutes into the OTP URL template.
  const components = [
    { type: 'body', parameters: [{ type: 'text', text: codeStr }] },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: codeStr }]
    }
  ];
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toDigits,
    type: 'template',
    template: {
      name: OTP_TEMPLATE_NAME,
      language: { code: OTP_TEMPLATE_LANGUAGE, policy: 'deterministic' },
      components
    }
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const errMsg = data.error?.message || res.statusText;
      const errCode = data.error?.code;
      const errSubcode = data.error?.error_subcode;
      console.warn(JSON.stringify({
        message: 'Meta OTP API error',
        mobile: toDigits,
        httpStatus: res.status,
        errorCode: errCode,
        errorSubcode: errSubcode,
        errorMessage: errMsg
      }));
      return { success: false, error: errMsg, metaMessageId: null };
    }
    return { success: true, metaMessageId: data.messages?.[0]?.id || null };
  } catch (err) {
    return { success: false, error: err.message, metaMessageId: null };
  }
}

module.exports = { sendOtpTemplate };
