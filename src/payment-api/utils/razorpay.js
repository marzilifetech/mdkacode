const crypto = require('crypto');
const Razorpay = require('razorpay');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';

let instance = null;

/**
 * Get Razorpay instance (test/live from env).
 * @returns {Razorpay|null}
 */
function getRazorpay() {
  if (!KEY_ID || !KEY_SECRET) return null;
  if (!instance) {
    instance = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });
  }
  return instance;
}

/**
 * Create Razorpay order. Amount in paise, currency INR.
 * @param {number} amountPaise - Amount in paise (e.g. 50000 = ₹500)
 * @param {string} receipt - Your receipt id (e.g. order_xxx)
 * @param {string} [currency='INR']
 * @returns {Promise<{ id, amount, currency, receipt, status }>}
 */
async function createOrder(amountPaise, receipt, currency = 'INR') {
  const rzp = getRazorpay();
  if (!rzp) throw new Error('Razorpay not configured');
  const order = await rzp.orders.create({
    amount: amountPaise,
    currency,
    receipt: String(receipt)
  });
  return order;
}

/**
 * Fetch payment by id from Razorpay.
 * @param {string} paymentId - Razorpay payment id (e.g. pay_xxx)
 * @returns {Promise<object>}
 */
async function fetchPayment(paymentId) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error('Razorpay not configured');
  const payment = await rzp.payments.fetch(paymentId);
  return payment;
}

/**
 * Fetch order by id from Razorpay.
 * @param {string} orderId - Razorpay order id (e.g. order_xxx)
 * @returns {Promise<object>}
 */
async function fetchOrder(orderId) {
  const rzp = getRazorpay();
  if (!rzp) throw new Error('Razorpay not configured');
  const order = await rzp.orders.fetch(orderId);
  return order;
}

/**
 * Verify payment signature returned by Checkout on success.
 * Per Razorpay docs: HMAC SHA256(order_id + "|" + razorpay_payment_id, key_secret).
 * @param {string} orderId - Razorpay order_id (from your server / Checkout response)
 * @param {string} paymentId - razorpay_payment_id from Checkout
 * @param {string} signature - razorpay_signature from Checkout
 * @returns {boolean}
 */
function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!KEY_SECRET || !orderId || !paymentId || !signature) return false;
  const payload = orderId + '|' + paymentId;
  const expected = crypto
    .createHmac('sha256', KEY_SECRET)
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * Verify Razorpay webhook signature.
 * @param {string} body - Raw request body (string)
 * @param {string} signature - X-Razorpay-Signature header
 * @returns {boolean}
 */
function verifyWebhookSignature(body, signature) {
  if (!WEBHOOK_SECRET || !signature || typeof body !== 'string') return false;
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) return false;
  try {
    return crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

module.exports = {
  getRazorpay,
  createOrder,
  fetchPayment,
  fetchOrder,
  verifyPaymentSignature,
  verifyWebhookSignature
};
