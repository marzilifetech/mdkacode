#!/usr/bin/env node
/**
 * Seed the default flow (marzi-lead) to BotConfig via Dashboard API.
 * Run after deploy to store flow in DynamoDB so meta-webhook loads from DB.
 *
 * Usage:
 *   DASHBOARD_URL=https://xxx.execute-api.region.amazonaws.com/Prod node scripts/seed-flow-to-db.js
 *
 * For local: start the API (sam local start-api) then:
 *   DASHBOARD_URL=http://127.0.0.1:3000 node scripts/seed-flow-to-db.js
 */
const path = require('path');
const fs = require('fs').promises;
const https = require('https');
const http = require('http');

const FLOW_ID = process.env.FLOW_ID || 'marzi-lead';
const DASHBOARD_URL = process.env.DASHBOARD_URL || '';

async function main() {
  if (!DASHBOARD_URL) {
    console.error('DASHBOARD_URL is required. Example:');
    console.error('  DASHBOARD_URL=https://xxx.execute-api.region.amazonaws.com/Prod node scripts/seed-flow-to-db.js');
    process.exit(1);
  }

  const flowPath = path.join(__dirname, '..', 'src', 'meta-webhook', 'flows', `${FLOW_ID}.json`);
  let flow;
  try {
    const raw = await fs.readFile(flowPath, 'utf8');
    flow = JSON.parse(raw);
  } catch (err) {
    console.error('Failed to read flow:', err.message);
    process.exit(1);
  }
  if (!flow.nodes || typeof flow.nodes !== 'object') {
    console.error('Invalid flow: missing nodes');
    process.exit(1);
  }

  const url = new URL(`${DASHBOARD_URL.replace(/\/$/, '')}/api/flows/${FLOW_ID}`);
  const body = JSON.stringify(flow);
  const lib = url.protocol === 'https:' ? https : http;
  try {
    await new Promise((resolve, reject) => {
      const req = lib.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`Flow "${FLOW_ID}" seeded to DynamoDB via Dashboard API`);
            resolve();
          } else reject(new Error(`API ${res.statusCode}: ${data}`));
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  } catch (err) {
    console.error('Failed to seed flow:', err.message);
    process.exit(1);
  }
}

main();
