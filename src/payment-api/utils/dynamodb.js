const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true }
});

const PRODUCT_TABLE = process.env.PAYMENT_PRODUCT_TABLE_NAME;
const ORDER_TABLE = process.env.PAYMENT_ORDER_TABLE_NAME;
const CONFIG_TABLE = process.env.PAYMENT_CONFIG_TABLE_NAME;

const GSI_ENTITY_CREATED = 'entity-createdAt-index';
const GSI_MOBILE_CREATED = 'mobile-createdAt-index';
const CONFIG_KEY_DEFAULT = 'default';

// --- Product ---

/**
 * Put product (create or update).
 * @param {object} item - { productId, name, amountRupees, gstPercent, totalPaise, entity, createdAt, updatedAt, ... }
 */
async function putProduct(item) {
  await dynamoClient.send(
    new PutCommand({
      TableName: PRODUCT_TABLE,
      Item: item
    })
  );
}

/**
 * Get product by productId.
 * @param {string} productId
 * @returns {Promise<object|null>}
 */
async function getProduct(productId) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: PRODUCT_TABLE,
      Key: { productId }
    })
  );
  return result.Item || null;
}

/**
 * List all products (by entity = 'product', sorted by createdAt desc).
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function listProducts(limit = 100) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: PRODUCT_TABLE,
      IndexName: GSI_ENTITY_CREATED,
      KeyConditionExpression: 'entity = :entity',
      ExpressionAttributeValues: { ':entity': 'product' },
      ScanIndexForward: false,
      Limit: limit
    })
  );
  return result.Items || [];
}

// --- PaymentOrder ---

/**
 * Put payment order (create or update); store each step.
 * @param {object} item - { orderId, productId, productName, mobile, amountPaise, status, createdAt, updatedAt, ... }
 */
async function putPaymentOrder(item) {
  await dynamoClient.send(
    new PutCommand({
      TableName: ORDER_TABLE,
      Item: item
    })
  );
}

/**
 * Get order by orderId (Razorpay order_id).
 * @param {string} orderId
 * @returns {Promise<object|null>}
 */
async function getPaymentOrder(orderId) {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: ORDER_TABLE,
      Key: { orderId }
    })
  );
  return result.Item || null;
}

/**
 * Update order status and optional paymentId, method, statusHistory.
 */
async function updatePaymentOrder(orderId, updates) {
  const now = Date.now();
  const setParts = ['#updatedAt = :updatedAt'];
  const names = { '#updatedAt': 'updatedAt' };
  const values = { ':updatedAt': now };

  if (updates.status != null) {
    setParts.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = updates.status;
  }
  if (updates.razorpayPaymentId != null) {
    setParts.push('razorpayPaymentId = :razorpayPaymentId');
    values[':razorpayPaymentId'] = updates.razorpayPaymentId;
  }
  if (updates.method != null) {
    setParts.push('#method = :method');
    names['#method'] = 'method';
    values[':method'] = updates.method;
  }
  if (updates.capturedAt != null) {
    setParts.push('capturedAt = :capturedAt');
    values[':capturedAt'] = updates.capturedAt;
  }
  if (updates.statusHistory != null) {
    setParts.push('statusHistory = :statusHistory');
    values[':statusHistory'] = updates.statusHistory;
  }
  if (updates.whatsappConfirmationSentAt != null) {
    setParts.push('whatsappConfirmationSentAt = :whatsappConfirmationSentAt');
    values[':whatsappConfirmationSentAt'] = updates.whatsappConfirmationSentAt;
  }

  await dynamoClient.send(
    new UpdateCommand({
      TableName: ORDER_TABLE,
      Key: { orderId },
      UpdateExpression: 'SET ' + setParts.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
}

/**
 * List payment orders for a mobile (user's payments).
 * @param {string} mobile - E.164
 * @param {number} limit
 * @returns {Promise<object[]>}
 */
async function listPaymentOrdersByMobile(mobile, limit = 50) {
  const result = await dynamoClient.send(
    new QueryCommand({
      TableName: ORDER_TABLE,
      IndexName: GSI_MOBILE_CREATED,
      KeyConditionExpression: 'mobile = :mobile',
      ExpressionAttributeValues: { ':mobile': mobile },
      ScanIndexForward: false,
      Limit: limit
    })
  );
  return result.Items || [];
}

// --- PaymentConfig ---

/**
 * Get payment config (enabled methods, notes). Keys from env.
 * @returns {Promise<object|null>}
 */
async function getPaymentConfig() {
  const result = await dynamoClient.send(
    new GetCommand({
      TableName: CONFIG_TABLE,
      Key: { configKey: CONFIG_KEY_DEFAULT }
    })
  );
  return result.Item || null;
}

/**
 * Update payment config (enabled methods, notes).
 */
async function putPaymentConfig(item) {
  const now = Date.now();
  await dynamoClient.send(
    new PutCommand({
      TableName: CONFIG_TABLE,
      Item: {
        configKey: CONFIG_KEY_DEFAULT,
        ...item,
        updatedAt: now
      }
    })
  );
}

module.exports = {
  putProduct,
  getProduct,
  listProducts,
  putPaymentOrder,
  getPaymentOrder,
  updatePaymentOrder,
  listPaymentOrdersByMobile,
  getPaymentConfig,
  putPaymentConfig
};
