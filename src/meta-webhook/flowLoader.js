/**
 * Flow loader: load flow definition from DynamoDB (BotConfig) first, then filesystem fallback.
 * Schema: { id, start, nodes: { nodeId: { type, next?, messageKey?, conditions?, options?, ... } }, messages?: { key: "template {{var}}" } }
 * Cache TTL 60s so PM updates (via API) can take effect without redeploy.
 */
const path = require('path');
const fs = require('fs').promises;
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
const BOT_CONFIG_TABLE = process.env.BOT_CONFIG_TABLE_NAME || '';
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

/**
 * Load flow by id. Tries DynamoDB (BotConfig flow_${flowId}) first, then ./flows/{flowId}.json.
 * @param {string} flowId - e.g. 'marzi-lead'
 * @returns {Promise<object|null>} Flow definition or null
 */
async function loadFlow(flowId) {
  if (!flowId || typeof flowId !== 'string') return null;
  const key = flowId.trim();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.flow;

  let flow = null;

  if (BOT_CONFIG_TABLE) {
    try {
      const res = await dynamoClient.send(new GetCommand({
        TableName: BOT_CONFIG_TABLE,
        Key: { configKey: `flow_${key}` }
      }));
      const item = res.Item;
      if (item && item.flow != null) {
        flow = typeof item.flow === 'string' ? JSON.parse(item.flow) : item.flow;
      }
    } catch (err) {
      console.warn(JSON.stringify({ message: 'flow_load_db_error', flowId: key, error: err.message }));
    }
  }

  if (!flow) {
    const baseDir = path.resolve(__dirname);
    const filePath = path.join(baseDir, 'flows', `${key}.json`);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      flow = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.warn(JSON.stringify({ message: 'flow_not_found', flowId: key }));
      } else {
        console.error(JSON.stringify({ message: 'flow_parse_error', flowId: key, error: err.message }));
      }
      return null;
    }
  }

  if (!flow || !flow.nodes || typeof flow.nodes !== 'object') {
    console.warn(JSON.stringify({ message: 'flow_invalid_no_nodes', flowId: key }));
    return null;
  }
  flow.start = flow.start || 'start';
  cache.set(key, { flow, at: Date.now() });
  return flow;
}

/**
 * Invalidate cache for a flow (call after API updates flow).
 * @param {string} [flowId] - If provided, clear only this id; else clear all.
 */
function invalidateFlowCache(flowId) {
  if (flowId) cache.delete(flowId.trim());
  else cache.clear();
}

module.exports = { loadFlow, invalidateFlowCache };
