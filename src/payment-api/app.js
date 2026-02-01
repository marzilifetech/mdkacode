const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const {
  putProduct,
  getProduct,
  listProducts,
  putPaymentOrder,
  getPaymentOrder,
  updatePaymentOrder,
  listPaymentOrdersByMobile,
  getPaymentConfig,
  putPaymentConfig
} = require('./utils/dynamodb');
const { getRazorpay, createOrder, verifyPaymentSignature, verifyWebhookSignature } = require('./utils/razorpay');
const { verifyAccess } = require('./utils/jwt');

let gupshupModule = null;
try {
  gupshupModule = require('./utils/gupshup');
} catch (_) {}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS'
};

const TEMPLATE_ID = process.env.ANTAKSHARI_CONFIRMATION_TEMPLATE_ID || '';

function log(level, event, data) {
  const payload = { level, event, ...data, timestamp: new Date().toISOString() };
  if (level === 'error') console.error(JSON.stringify(payload));
  else console.log(JSON.stringify(payload));
}

function parseBody(event) {
  try {
    const body = event.body;
    if (!body) return {};
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch (e) {
    return {};
  }
}

function respond(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
}

function getPath(event) {
  return event.path || event.requestContext?.http?.path || '';
}

function getMethod(event) {
  return (event.httpMethod || event.requestContext?.http?.method || 'GET').toUpperCase();
}

function getMobileFromAuth(event) {
  const auth = event.headers?.Authorization || event.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const decoded = verifyAccess(token);
    return decoded.sub || null;
  } catch {
    return null;
  }
}

// --- Handlers ---

async function handleGetProducts(event) {
  log('info', 'payment_api', { path: '/payment/products', method: 'GET', action: 'list_products' });
  const products = await listProducts(100);
  log('info', 'payment_api', { action: 'list_products_result', count: products.length });
  return respond(200, { success: true, products });
}

async function handlePostProduct(event) {
  const body = parseBody(event);
  log('info', 'payment_api', { path: '/payment/products', method: 'POST', bodyKeys: Object.keys(body) });
  const { name, amountRupees, gstPercent } = body;
  if (!name || amountRupees == null) {
    log('warn', 'payment_api', { action: 'post_product_validation_failed', body: body });
    return respond(400, { success: false, error: 'name and amountRupees are required' });
  }
  const productId = body.productId || 'prod_' + uuidv4().slice(0, 8);
  const gst = Number(gstPercent) || 0;
  const amount = Number(amountRupees) * 100;
  const totalPaise = Math.round(amount * (1 + gst / 100));
  const now = Date.now();
  const item = {
    productId,
    name: String(name).trim(),
    amountRupees: Number(amountRupees),
    gstPercent: gst,
    totalPaise,
    entity: 'product',
    createdAt: now,
    updatedAt: now
  };
  await putProduct(item);
  log('info', 'payment_api', { action: 'post_product_created', productId });
  return respond(200, { success: true, product: item });
}

async function handlePatchProduct(event, productId) {
  log('info', 'payment_api', { path: '/payment/products/:productId', method: 'PATCH', productId });
  const existing = await getProduct(productId);
  if (!existing) {
    log('warn', 'payment_api', { action: 'patch_product_not_found', productId });
    return respond(404, { success: false, error: 'Product not found' });
  }
  const body = parseBody(event);
  const updates = { ...existing };
  if (body.name != null) updates.name = String(body.name).trim();
  if (body.amountRupees != null) updates.amountRupees = Number(body.amountRupees);
  if (body.gstPercent != null) updates.gstPercent = Number(body.gstPercent);
  if (updates.amountRupees != null) {
    const gst = updates.gstPercent || 0;
    updates.totalPaise = Math.round(updates.amountRupees * 100 * (1 + gst / 100));
  }
  updates.updatedAt = Date.now();
  await putProduct(updates);
  log('info', 'payment_api', { action: 'patch_product_updated', productId });
  return respond(200, { success: true, product: updates });
}

async function handleGetConfig(event) {
  log('info', 'payment_api', { path: '/payment/config', method: 'GET' });
  const config = await getPaymentConfig();
  log('info', 'payment_api', { action: 'get_config_result', hasConfig: !!config });
  return respond(200, { success: true, config: config || {} });
}

async function handlePatchConfig(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('warn', 'payment_api', { path: '/payment/config', action: 'unauthorized' });
    return respond(401, { success: false, error: 'Unauthorized' });
  }
  const body = parseBody(event);
  log('info', 'payment_api', { path: '/payment/config', method: 'PATCH', bodyKeys: Object.keys(body) });
  const config = (await getPaymentConfig()) || {};
  if (body.enabledMethods != null) config.enabledMethods = body.enabledMethods;
  if (body.notes != null) config.notes = body.notes;
  await putPaymentConfig(config);
  log('info', 'payment_api', { action: 'patch_config_updated' });
  return respond(200, { success: true, config });
}

async function handlePostOrders(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('warn', 'payment_api', { path: '/payment/orders', action: 'unauthorized' });
    return respond(401, { success: false, error: 'Unauthorized' });
  }
  const body = parseBody(event);
  log('info', 'payment_api', { path: '/payment/orders', method: 'POST', mobile: mobile.replace(/\d{4}$/, '****'), bodyKeys: Object.keys(body) });
  const productId = body.productId || body.productName;
  if (!productId) {
    log('warn', 'payment_api', { action: 'post_orders_validation_failed', body });
    return respond(400, { success: false, error: 'productId or productName is required' });
  }
  let product = await getProduct(productId);
  if (!product) product = (await listProducts(10)).find(p => p.name === productId);
  if (!product) {
    log('warn', 'payment_api', { action: 'post_orders_product_not_found', productId });
    return respond(404, { success: false, error: 'Product not found' });
  }
  const amountPaise = product.totalPaise || product.amountRupees * 100;
  const receipt = 'rcpt_' + Date.now();
  const rzpOrder = await createOrder(amountPaise, receipt);
  const orderId = rzpOrder.id;
  const now = Date.now();
  await putPaymentOrder({
    orderId,
    productId: product.productId,
    productName: product.name,
    mobile,
    amountPaise,
    status: 'created',
    createdAt: now,
    updatedAt: now
  });
  log('info', 'payment_api', { action: 'post_orders_created', orderId, amountPaise });
  return respond(200, { success: true, order: { order_id: orderId, amount: amountPaise, currency: rzpOrder.currency || 'INR' }, key_id: process.env.RAZORPAY_KEY_ID });
}

async function handlePostVerify(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('warn', 'payment_api', { path: '/payment/verify', action: 'unauthorized' });
    return respond(401, { success: false, error: 'Unauthorized' });
  }
  const body = parseBody(event);
  log('info', 'payment_api', { path: '/payment/verify', method: 'POST', mobile: mobile.replace(/\d{4}$/, '****'), bodyKeys: Object.keys(body) });
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = body;
  if (!orderId || !paymentId || !signature) {
    log('warn', 'payment_api', { action: 'verify_validation_failed', body });
    return respond(400, { success: false, error: 'razorpay_order_id, razorpay_payment_id, razorpay_signature are required' });
  }
  const valid = verifyPaymentSignature(orderId, paymentId, signature);
  if (!valid) {
    log('warn', 'payment_api', { action: 'verify_signature_invalid', orderId });
    return respond(400, { success: false, error: 'Invalid signature' });
  }
  const orderRecord = await getPaymentOrder(orderId);
  if (!orderRecord) {
    log('warn', 'payment_api', { action: 'verify_order_not_found', orderId });
    return respond(404, { success: false, error: 'Order not found' });
  }
  if (orderRecord.mobile !== mobile) {
    log('warn', 'payment_api', { action: 'verify_order_mismatch', orderId });
    return respond(403, { success: false, error: 'Order does not belong to you' });
  }
  const now = Date.now();
  await updatePaymentOrder(orderId, {
    status: 'captured',
    razorpayPaymentId: paymentId,
    method: body.method || 'upi',
    capturedAt: now,
    statusHistory: [...(orderRecord.statusHistory || []), { status: 'captured', at: now }]
  });
  log('info', 'payment_api', { action: 'verify_success', orderId, paymentId });
  return respond(200, { success: true, message: 'Payment verified' });
}

async function handleGetPayments(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) {
    log('warn', 'payment_api', { path: '/payment/payments', action: 'unauthorized' });
    return respond(401, { success: false, error: 'Unauthorized' });
  }
  const limit = Math.min(parseInt(event.queryStringParameters?.limit) || 50, 100);
  log('info', 'payment_api', { path: '/payment/payments', method: 'GET', mobile: mobile.replace(/\d{4}$/, '****'), limit });
  const orders = await listPaymentOrdersByMobile(mobile, limit);
  log('info', 'payment_api', { action: 'get_payments_result', count: orders.length });
  return respond(200, { success: true, payments: orders });
}

async function handlePostWebhook(event) {
  const path = getPath(event);
  let rawBody;
  if (event.isBase64Encoded && event.body) {
    rawBody = Buffer.from(event.body, 'base64').toString('utf8');
  } else if (typeof event.body === 'string') {
    rawBody = event.body;
  } else if (event.body) {
    rawBody = JSON.stringify(event.body);
  } else {
    rawBody = '';
  }
  const signature = event.headers?.['x-razorpay-signature'] || event.headers?.['X-Razorpay-Signature'] || '';

  log('info', 'payment_api', {
    path,
    method: 'POST',
    event: 'webhook_received',
    bodyLength: rawBody.length,
    isBase64Encoded: !!event.isBase64Encoded,
    hasSignature: !!signature,
    signatureLength: signature.length
  });

  let valid = verifyWebhookSignature(rawBody, signature);
  if (!valid && rawBody) {
    try {
      const canonicalBody = JSON.stringify(JSON.parse(rawBody));
      if (canonicalBody !== rawBody) {
        valid = verifyWebhookSignature(canonicalBody, signature);
        if (valid) log('info', 'payment_api', { event: 'webhook_signature_valid_canonical', bodyLength: rawBody.length });
      }
    } catch (_) {}
  }
  if (!valid) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    const expectedSig = secret
      ? crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
      : '(secret not set)';
    log('warn', 'payment_api', {
      event: 'webhook_signature_invalid',
      bodyLength: rawBody.length,
      bodyPreview: rawBody.slice(0, 120),
      receivedSignature: signature,
      expectedSignature: expectedSig,
      secretLength: secret ? secret.length : 0
    });
    return respond(403, { success: false, error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch (e) {
    log('error', 'payment_api', { event: 'webhook_parse_error', error: e.message });
    return respond(400, { success: false, error: 'Invalid JSON body' });
  }

  const eventType = payload.event;
  log('info', 'payment_api', { event: 'webhook_parsed', eventType });

  if (eventType !== 'payment.captured') {
    log('info', 'payment_api', { event: 'webhook_ignored', eventType, action: 'not_payment_captured' });
    return respond(200, { success: true });
  }

  const entity = payload.payload?.payment?.entity;
  if (!entity || !entity.order_id) {
    log('warn', 'payment_api', { event: 'webhook_entity_missing', payloadKeys: Object.keys(payload.payload || {}) });
    return respond(200, { success: true });
  }

  const orderId = entity.order_id;
  const paymentId = entity.id;
  const method = entity.method || 'upi';

  log('info', 'payment_api', { event: 'webhook_payment_captured', orderId, paymentId, method });

  const order = await getPaymentOrder(orderId);
  if (!order) {
    log('warn', 'payment_api', { event: 'webhook_order_not_found', orderId });
    return respond(200, { success: true });
  }

  const now = Date.now();
  await updatePaymentOrder(orderId, {
    status: 'captured',
    razorpayPaymentId: paymentId,
    method,
    capturedAt: now,
    statusHistory: [...(order.statusHistory || []), { status: 'captured', at: now }]
  });
  log('info', 'payment_api', { event: 'webhook_order_updated', orderId });

  const teamName = order.antakshariTeamName || order.productName || 'Participant';
  const alreadySent = !!order.whatsappConfirmationSentAt;
  const mobile = order.mobile;

  if (alreadySent) {
    log('info', 'payment_api', { event: 'webhook_whatsapp_skipped', orderId, reason: 'already_sent' });
    return respond(200, { success: true });
  }

  if (gupshupModule && mobile && TEMPLATE_ID) {
    const amountNum = order.amountPaise != null ? order.amountPaise / 100 : 0;
    const amountStr = '₹' + (Number(amountNum).toLocaleString('en-IN'));
    try {
      const result = await gupshupModule.sendAntakshariConfirmationTemplate(mobile, TEMPLATE_ID, teamName, amountStr);
      log('info', 'payment_api', { event: 'webhook_whatsapp_sent', orderId, mobile: mobile.replace(/\d{4}$/, '****'), success: result.success, messageId: result.messageId, teamName });
      if (result.success && result.messageId) {
        await updatePaymentOrder(orderId, { whatsappConfirmationSentAt: now });
      } else if (result.success && !result.messageId) {
        log('warn', 'payment_api', { event: 'webhook_whatsapp_no_message_id', orderId, message: 'Gupshup returned success but no messageId; not marking as sent' });
      }
    } catch (e) {
      log('error', 'payment_api', { event: 'webhook_whatsapp_error', orderId, error: e.message });
    }
  } else {
    log('info', 'payment_api', { event: 'webhook_whatsapp_skipped', orderId, reason: !gupshupModule ? 'no_gupshup' : !mobile ? 'no_mobile' : 'no_template_id' });
  }

  return respond(200, { success: true });
}

exports.handler = async (event) => {
  const path = getPath(event);
  const method = getMethod(event);
  const pathParams = event.pathParameters || {};

  log('info', 'payment_api', { message: 'request_start', path, method, pathParameters: pathParams });

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    if (path === '/payment/products' && method === 'GET') return await handleGetProducts(event);
    if (path === '/payment/products' && method === 'POST') return await handlePostProduct(event);
    if (path === '/payment/config' && method === 'GET') return await handleGetConfig(event);
    if (path === '/payment/config' && method === 'PATCH') return await handlePatchConfig(event);
    if (path === '/payment/orders' && method === 'POST') return await handlePostOrders(event);
    if (path === '/payment/verify' && method === 'POST') return await handlePostVerify(event);
    if (path === '/payment/payments' && method === 'GET') return await handleGetPayments(event);
    if (path === '/payment/webhook' && method === 'POST') return await handlePostWebhook(event);

    const productId = pathParams.productId;
    if (productId && path === '/payment/products/' + productId && method === 'PATCH') {
      return await handlePatchProduct(event, productId);
    }

    log('warn', 'payment_api', { message: 'not_found', path, method });
    return respond(404, { success: false, error: 'Not found' });
  } catch (err) {
    log('error', 'payment_api', { message: 'handler_error', path, method, error: err.message, stack: err.stack });
    return respond(500, { success: false, error: 'Internal server error' });
  }
};
