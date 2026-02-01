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
const { verifyAccess } = require('./utils/jwt');
const {
  createOrder,
  getRazorpay,
  fetchPayment,
  verifyPaymentSignature,
  verifyWebhookSignature
} = require('./utils/razorpay');
const { sendAntakshariConfirmationTemplate } = require('./utils/gupshup');

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_BUSINESS_NAME = process.env.RAZORPAY_BUSINESS_NAME || 'Merchant';
const RAZORPAY_TEST_MODE = process.env.RAZORPAY_TEST_MODE === 'true' || process.env.RAZORPAY_TEST_MODE === '1';

/** When true, use in-memory store (no DynamoDB/Razorpay) for local testing. */
const LOCAL_MOCK_PAYMENT = process.env.LOCAL_MOCK_PAYMENT === 'true' || process.env.LOCAL_MOCK_PAYMENT === '1';
const mockProducts = new Map();
const mockOrders = new Map();
let mockConfig = {};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS'
};

/**
 * Parse JSON body from API Gateway event.
 */
function parseBody(event) {
  try {
    const body = event.body;
    if (!body) return {};
    return typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return {};
  }
}

/**
 * Respond with JSON and status.
 */
function respond(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  };
}

/**
 * Extract mobile from Authorization Bearer (access token). Returns null if missing/invalid.
 */
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

/**
 * Compute total amount in paise from base price (INR) and GST percentage.
 */
function computeTotalPaise(amountRupees, gstPercent) {
  const totalRupees = amountRupees * (1 + (gstPercent || 0) / 100);
  return Math.round(totalRupees * 100);
}

// --- Handlers ---

/**
 * POST /payment/products — Register product (name, amount, gstPercent).
 */
async function handleRegisterProduct(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  const body = parseBody(event);
  const name = body.name != null ? String(body.name).trim() : '';
  const amountRupees = parseFloat(body.amount);
  const gstPercent = body.gstPercent != null ? parseFloat(body.gstPercent) : 0;

  if (!name || isNaN(amountRupees) || amountRupees < 0) {
    return respond(400, { success: false, error: 'name and amount (non-negative number) are required' });
  }
  if (isNaN(gstPercent) || gstPercent < 0) {
    return respond(400, { success: false, error: 'gstPercent must be a non-negative number' });
  }

  const productId = uuidv4();
  const totalPaise = computeTotalPaise(amountRupees, gstPercent);
  const now = Date.now();
  const item = {
    productId,
    name,
    amountRupees,
    gstPercent,
    totalPaise,
    entity: 'product',
    createdAt: now,
    updatedAt: now,
    ...(body.paymentMethods && Array.isArray(body.paymentMethods) ? { paymentMethods: body.paymentMethods } : {})
  };

  if (LOCAL_MOCK_PAYMENT) {
    mockProducts.set(productId, item);
    return respond(200, {
      success: true,
      product: {
        productId: item.productId,
        name: item.name,
        amountRupees: item.amountRupees,
        gstPercent: item.gstPercent,
        totalPaise: item.totalPaise,
        totalRupees: (item.totalPaise / 100).toFixed(2)
      }
    });
  }

  await putProduct(item);
  return respond(200, {
    success: true,
    product: {
      productId: item.productId,
      name: item.name,
      amountRupees: item.amountRupees,
      gstPercent: item.gstPercent,
      totalPaise: item.totalPaise,
      totalRupees: (item.totalPaise / 100).toFixed(2)
    }
  });
}

/**
 * GET /payment/products — List registered products.
 */
async function handleListProducts(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  if (LOCAL_MOCK_PAYMENT) {
    const items = Array.from(mockProducts.values());
    const products = items.map((p) => ({
      productId: p.productId,
      name: p.name,
      amountRupees: p.amountRupees,
      gstPercent: p.gstPercent,
      totalPaise: p.totalPaise,
      totalRupees: (p.totalPaise / 100).toFixed(2),
      createdAt: p.createdAt
    }));
    return respond(200, { success: true, products });
  }

  const limit = Math.min(parseInt(event.queryStringParameters?.limit, 10) || 100, 100);
  const items = await listProducts(limit);
  const products = items.map((p) => ({
    productId: p.productId,
    name: p.name,
    amountRupees: p.amountRupees,
    gstPercent: p.gstPercent,
    totalPaise: p.totalPaise,
    totalRupees: (p.totalPaise / 100).toFixed(2),
    createdAt: p.createdAt
  }));
  return respond(200, { success: true, products });
}

/**
 * PATCH /payment/products/{productId} — Update product.
 */
async function handleUpdateProduct(event, productId) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });
  if (!productId) return respond(400, { success: false, error: 'productId required' });

  if (LOCAL_MOCK_PAYMENT) {
    const existing = mockProducts.get(productId);
    if (!existing) return respond(404, { success: false, error: 'Product not found' });
    const body = parseBody(event);
    const name = body.name != null ? String(body.name).trim() : existing.name;
    let amountRupees = body.amount != null ? parseFloat(body.amount) : existing.amountRupees;
    let gstPercent = body.gstPercent != null ? parseFloat(body.gstPercent) : existing.gstPercent;
    if (isNaN(amountRupees) || amountRupees < 0) amountRupees = existing.amountRupees;
    if (isNaN(gstPercent) || gstPercent < 0) gstPercent = existing.gstPercent;
    const totalPaise = computeTotalPaise(amountRupees, gstPercent);
    const now = Date.now();
    const item = { ...existing, name, amountRupees, gstPercent, totalPaise, updatedAt: now };
    mockProducts.set(productId, item);
    return respond(200, {
      success: true,
      product: {
        productId: item.productId,
        name: item.name,
        amountRupees: item.amountRupees,
        gstPercent: item.gstPercent,
        totalPaise: item.totalPaise,
        totalRupees: (item.totalPaise / 100).toFixed(2)
      }
    });
  }

  const existing = await getProduct(productId);
  if (!existing) return respond(404, { success: false, error: 'Product not found' });

  const body = parseBody(event);
  const name = body.name != null ? String(body.name).trim() : existing.name;
  let amountRupees = body.amount != null ? parseFloat(body.amount) : existing.amountRupees;
  let gstPercent = body.gstPercent != null ? parseFloat(body.gstPercent) : existing.gstPercent;

  if (isNaN(amountRupees) || amountRupees < 0) amountRupees = existing.amountRupees;
  if (isNaN(gstPercent) || gstPercent < 0) gstPercent = existing.gstPercent;

  const totalPaise = computeTotalPaise(amountRupees, gstPercent);
  const now = Date.now();
  const item = {
    ...existing,
    name,
    amountRupees,
    gstPercent,
    totalPaise,
    updatedAt: now,
    ...(body.paymentMethods && Array.isArray(body.paymentMethods) ? { paymentMethods: body.paymentMethods } : {})
  };
  await putProduct(item);
  return respond(200, {
    success: true,
    product: {
      productId: item.productId,
      name: item.name,
      amountRupees: item.amountRupees,
      gstPercent: item.gstPercent,
      totalPaise: item.totalPaise,
      totalRupees: (item.totalPaise / 100).toFixed(2)
    }
  });
}

/**
 * GET /payment/config — Get payment config.
 */
async function handleGetConfig(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  if (LOCAL_MOCK_PAYMENT) {
    return respond(200, { success: true, config: mockConfig || {} });
  }

  const config = await getPaymentConfig();
  const payload = config
    ? { success: true, config: { enabledMethods: config.enabledMethods, notes: config.notes, updatedAt: config.updatedAt } }
    : { success: true, config: {} };
  return respond(200, payload);
}

/**
 * PATCH /payment/config — Update payment config.
 */
async function handleUpdateConfig(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  const body = parseBody(event);
  const item = {};
  if (body.enabledMethods != null && Array.isArray(body.enabledMethods)) item.enabledMethods = body.enabledMethods;
  if (body.notes != null) item.notes = String(body.notes);

  if (LOCAL_MOCK_PAYMENT) {
    mockConfig = { ...mockConfig, ...item, updatedAt: Date.now() };
    return respond(200, { success: true, config: mockConfig });
  }

  await putPaymentConfig(item);
  const config = await getPaymentConfig();
  return respond(200, {
    success: true,
    config: config ? { enabledMethods: config.enabledMethods, notes: config.notes, updatedAt: config.updatedAt } : {}
  });
}

/**
 * POST /payment/orders — Initiate payment (productId or productName). Create Razorpay order; store with status=created.
 */
async function handleCreateOrder(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  const body = parseBody(event);
  const productId = body.productId != null ? String(body.productId).trim() : '';
  const productName = body.productName != null ? String(body.productName).trim() : '';

  let product = null;
  if (LOCAL_MOCK_PAYMENT) {
    if (productId) product = mockProducts.get(productId) || null;
    if (!product && productName) {
      product = Array.from(mockProducts.values()).find((p) => p.name.toLowerCase() === productName.toLowerCase()) || null;
    }
    if (!product) return respond(400, { success: false, error: 'Product not found (provide productId or productName)' });
    const amountPaise = product.totalPaise;
    if (!amountPaise || amountPaise < 100) return respond(400, { success: false, error: 'Product total amount must be at least 1 INR (100 paise)' });
    const orderId = 'order_mock_' + uuidv4().slice(0, 8);
    const now = Date.now();
    const orderRecord = { orderId, productId: product.productId, productName: product.name, mobile, amountPaise, status: 'created', createdAt: now, updatedAt: now };
    mockOrders.set(orderId, orderRecord);
    return respond(200, {
      success: true,
      order: {
        order_id: orderId,
        orderId,
        amount: amountPaise,
        currency: 'INR',
        key: RAZORPAY_KEY_ID,
        key_id: RAZORPAY_KEY_ID,
        name: RAZORPAY_BUSINESS_NAME,
        description: product.name,
        productName: product.name,
        test_mode: true
      }
    });
  }

  if (productId) {
    product = await getProduct(productId);
  }
  if (!product && productName) {
    const all = await listProducts(500);
    product = all.find((p) => p.name.toLowerCase() === productName.toLowerCase());
  }
  if (!product) {
    return respond(400, { success: false, error: 'Product not found (provide productId or productName)' });
  }

  const amountPaise = product.totalPaise;
  if (!amountPaise || amountPaise < 100) {
    return respond(400, { success: false, error: 'Product total amount must be at least 1 INR (100 paise)' });
  }

  if (!getRazorpay()) {
    return respond(503, { success: false, error: 'Razorpay not configured' });
  }

  let rzpOrder;
  try {
    const receipt = `rcpt_${Date.now()}_${mobile.slice(-4)}`;
    rzpOrder = await createOrder(amountPaise, receipt);
  } catch (err) {
    const errDetail = {
      message: 'Razorpay createOrder failed',
      error: err.message,
      ...(err.description && { description: err.description }),
      ...(err.statusCode != null && { statusCode: err.statusCode }),
      ...(err.code && { code: err.code })
    };
    console.error(JSON.stringify(errDetail));
    const msg = (err.message || err.description || '').toLowerCase();
    const hint =
      msg.includes('key') || msg.includes('invalid') || msg.includes('authentication') || msg.includes('credentials')
        ? ' Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET (Razorpay Dashboard → API Keys).'
        : '';
    return respond(502, {
      success: false,
      error: 'Failed to create order with payment provider.' + hint
    });
  }

  const orderId = rzpOrder.id;
  const now = Date.now();
  const statusHistory = [{ status: 'created', at: now }];
  await putPaymentOrder({
    orderId,
    productId: product.productId,
    productName: product.name,
    mobile,
    amountPaise,
    status: 'created',
    statusHistory,
    createdAt: now,
    updatedAt: now
  });

  return respond(200, {
    success: true,
    order: {
      order_id: orderId,
      orderId,
      amount: amountPaise,
      currency: 'INR',
      key: RAZORPAY_KEY_ID,
      key_id: RAZORPAY_KEY_ID,
      name: RAZORPAY_BUSINESS_NAME,
      description: product.name,
      productName: product.name,
      test_mode: RAZORPAY_TEST_MODE
    }
  });
}

/**
 * POST /payment/verify — Verify payment signature after Checkout success.
 * Per Razorpay docs: client sends razorpay_payment_id, razorpay_order_id, razorpay_signature;
 * server verifies HMAC SHA256(order_id + "|" + razorpay_payment_id, key_secret).
 */
async function handleVerifyPayment(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  const body = parseBody(event);
  const razorpayOrderId = body.razorpay_order_id || body.order_id || '';
  const razorpayPaymentId = body.razorpay_payment_id || body.payment_id || '';
  const razorpaySignature = body.razorpay_signature || body.signature || '';

  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return respond(400, {
      success: false,
      error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required'
    });
  }

  if (LOCAL_MOCK_PAYMENT) {
    const order = mockOrders.get(razorpayOrderId);
    if (!order) return respond(404, { success: false, error: 'Order not found' });
    if (order.mobile !== mobile) return respond(403, { success: false, error: 'Order does not belong to you' });
    if (order.status === 'captured') return respond(200, { success: true, message: 'Payment already verified', orderId: razorpayOrderId });
    order.status = 'captured';
    order.razorpayPaymentId = razorpayPaymentId;
    order.capturedAt = Date.now();
    mockOrders.set(razorpayOrderId, order);
    return respond(200, { success: true, message: 'Payment verified', orderId: razorpayOrderId, razorpayPaymentId });
  }

  if (!verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    return respond(400, { success: false, error: 'Invalid payment signature' });
  }

  const order = await getPaymentOrder(razorpayOrderId);
  if (!order) return respond(404, { success: false, error: 'Order not found' });
  if (order.mobile !== mobile) return respond(403, { success: false, error: 'Order does not belong to you' });
  if (order.status === 'captured') {
    return respond(200, { success: true, message: 'Payment already verified', orderId: razorpayOrderId });
  }

  let method = null;
  try {
    const payment = await fetchPayment(razorpayPaymentId);
    method = payment.method || null;
  } catch (err) {
    console.warn(JSON.stringify({ message: 'Razorpay fetchPayment failed', paymentId: razorpayPaymentId, error: err.message }));
  }

  const now = Date.now();
  const statusHistory = [...(order.statusHistory || []), { status: 'captured', at: now }];
  await updatePaymentOrder(razorpayOrderId, {
    status: 'captured',
    razorpayPaymentId,
    method,
    capturedAt: now,
    statusHistory
  });

  return respond(200, {
    success: true,
    message: 'Payment verified',
    orderId: razorpayOrderId,
    razorpayPaymentId
  });
}

/**
 * GET /payment/payments — List payments for authenticated user.
 */
async function handleListPayments(event) {
  const mobile = getMobileFromAuth(event);
  if (!mobile) return respond(401, { success: false, error: 'Unauthorized' });

  if (LOCAL_MOCK_PAYMENT) {
    const items = Array.from(mockOrders.values()).filter((p) => p.mobile === mobile);
    const payments = items.map((p) => ({
      orderId: p.orderId,
      productId: p.productId,
      productName: p.productName,
      amountPaise: p.amountPaise,
      status: p.status,
      method: p.method,
      razorpayPaymentId: p.razorpayPaymentId,
      createdAt: p.createdAt,
      capturedAt: p.capturedAt
    }));
    return respond(200, { success: true, payments });
  }

  const limit = Math.min(parseInt(event.queryStringParameters?.limit, 10) || 50, 50);
  const items = await listPaymentOrdersByMobile(mobile, limit);
  const payments = items.map((p) => ({
    orderId: p.orderId,
    productId: p.productId,
    productName: p.productName,
    amountPaise: p.amountPaise,
    status: p.status,
    method: p.method,
    razorpayPaymentId: p.razorpayPaymentId,
    createdAt: p.createdAt,
    capturedAt: p.capturedAt
  }));
  return respond(200, { success: true, payments });
}

/**
 * POST /payment/webhook — Razorpay webhook; verify signature; update order status.
 */
async function handleWebhook(event) {
  const rawBody = typeof event.body === 'string' ? event.body : JSON.stringify(event.body || {});
  const signature = event.headers?.['X-Razorpay-Signature'] || event.headers?.['x-razorpay-signature'] || '';
  if (!verifyWebhookSignature(rawBody, signature)) {
    return respond(400, { success: false, error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch {
    return respond(400, { success: false, error: 'Invalid JSON' });
  }

  const eventName = payload.event;

  if (eventName === 'payment.captured' && payload.payload?.payment?.entity) {
    const payment = payload.payload.payment.entity;
    const orderId = payment.order_id;
    const order = await getPaymentOrder(orderId);
    if (order) {
      const now = Date.now();
      const statusHistory = [...(order.statusHistory || []), { status: 'captured', at: now }];
      await updatePaymentOrder(orderId, {
        status: 'captured',
        razorpayPaymentId: payment.id,
        method: payment.method,
        capturedAt: now,
        statusHistory
      });

      // Send one WhatsApp confirmation for Antakshari (team name + amount confirmed)
      const templateId = process.env.ANTAKSHARI_CONFIRMATION_TEMPLATE_ID;
      if (
        templateId &&
        order.antakshariTeamName &&
        !order.whatsappConfirmationSentAt &&
        order.mobile
      ) {
        try {
          const amountStr = order.amountPaise != null ? `₹${(order.amountPaise / 100).toFixed(0)}` : '₹0';
          await sendAntakshariConfirmationTemplate(
            order.mobile,
            templateId,
            order.antakshariTeamName,
            amountStr
          );
          await updatePaymentOrder(orderId, { whatsappConfirmationSentAt: now });
        } catch (err) {
          console.error(JSON.stringify({
            message: 'WhatsApp Antakshari confirmation send failed',
            orderId,
            mobile: order.mobile,
            error: err.message
          }));
        }
      }
    }
  } else if (eventName === 'payment.failed' && payload.payload?.payment?.entity) {
    const payment = payload.payload.payment.entity;
    const orderId = payment.order_id;
    const order = await getPaymentOrder(orderId);
    if (order) {
      const now = Date.now();
      const statusHistory = [...(order.statusHistory || []), { status: 'failed', at: now }];
      await updatePaymentOrder(orderId, {
        status: 'failed',
        razorpayPaymentId: payment.id,
        method: payment.method || null,
        statusHistory
      });
    }
  }

  return respond(200, { success: true });
}

/**
 * Lambda handler — route by path and method.
 */
exports.handler = async (event) => {
  const path = event.path || event.requestContext?.http?.path || '';
  const method = (event.httpMethod || event.requestContext?.http?.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  try {
    // /payment/webhook — no JWT
    if (path === '/payment/webhook' && method === 'POST') {
      return await handleWebhook(event);
    }

    // /payment/products (POST, GET)
    if (path === '/payment/products' && method === 'POST') {
      return await handleRegisterProduct(event);
    }
    if (path === '/payment/products' && method === 'GET') {
      return await handleListProducts(event);
    }

    // /payment/products/{productId}
    const productPathMatch = path.match(/^\/payment\/products\/([^/]+)$/);
    if (productPathMatch && method === 'PATCH') {
      return await handleUpdateProduct(event, productPathMatch[1]);
    }

    // /payment/config
    if (path === '/payment/config' && method === 'GET') {
      return await handleGetConfig(event);
    }
    if (path === '/payment/config' && method === 'PATCH') {
      return await handleUpdateConfig(event);
    }

    // /payment/orders, /payment/verify, /payment/payments
    if (path === '/payment/orders' && method === 'POST') {
      return await handleCreateOrder(event);
    }
    if (path === '/payment/verify' && method === 'POST') {
      return await handleVerifyPayment(event);
    }
    if (path === '/payment/payments' && method === 'GET') {
      return await handleListPayments(event);
    }

    return respond(404, { success: false, error: 'Not found' });
  } catch (err) {
    console.error(JSON.stringify({ message: 'Payment API error', path, error: err.message }));
    return respond(500, { success: false, error: 'Internal server error' });
  }
};
