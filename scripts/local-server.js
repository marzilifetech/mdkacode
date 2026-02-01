#!/usr/bin/env node
/**
 * Local API server on port 3001 — runs Lambda handlers in Node (no Docker).
 * Use when "sam local start-api" fails with ContainersInitializationException.
 *
 * Usage: from project root, run: node scripts/local-server.js
 * Or: npm run local:server
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3001;
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load env.json and merge all function env into process.env
function loadEnv() {
  const envPath = path.join(PROJECT_ROOT, 'env.json');
  if (!fs.existsSync(envPath)) {
    console.warn('env.json not found, using process.env only');
    return;
  }
  const envJson = JSON.parse(fs.readFileSync(envPath, 'utf8'));
  for (const key of Object.keys(envJson)) {
    const obj = envJson[key];
    if (obj && typeof obj === 'object') {
      for (const k of Object.keys(obj)) {
        if (obj[k] != null) process.env[k] = String(obj[k]);
      }
    }
  }
}

loadEnv();

// Lazy-load handlers so env is set first
let authHandler;
let paymentHandler;
let dashboardHandler;
let webhookHandler;
let antakshariHandler;

function getAuthHandler() {
  if (!authHandler) authHandler = require(path.join(PROJECT_ROOT, 'src/auth-api/app.js')).handler;
  return authHandler;
}
function getPaymentHandler() {
  if (!paymentHandler) paymentHandler = require(path.join(PROJECT_ROOT, 'src/payment-api/app.js')).handler;
  return paymentHandler;
}
function getDashboardHandler() {
  if (!dashboardHandler) dashboardHandler = require(path.join(PROJECT_ROOT, 'src/dashboard-api/app.js')).handler;
  return dashboardHandler;
}
function getWebhookHandler() {
  if (!webhookHandler) webhookHandler = require(path.join(PROJECT_ROOT, 'src/inbound-webhook/app.js')).handler;
  return webhookHandler;
}
function getAntakshariHandler() {
  if (!antakshariHandler) antakshariHandler = require(path.join(PROJECT_ROOT, 'src/antakshari-api/app.js')).handler;
  return antakshariHandler;
}

function parseQuery(urlStr) {
  const u = new URL(urlStr || '', 'http://localhost');
  const q = {};
  u.searchParams.forEach((v, k) => { q[k] = v; });
  return q;
}

function toApiGatewayEvent(req, pathname, bodyRaw, query) {
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    headers[k.toLowerCase()] = v;
  }
  return {
    body: bodyRaw,
    path: pathname,
    httpMethod: req.method,
    headers,
    requestContext: {
      http: {
        path: pathname,
        method: req.method
      }
    },
    queryStringParameters: Object.keys(query).length ? query : undefined
  };
}

function route(pathname, method) {
  if (pathname.startsWith('/auth')) return 'auth';
  if (pathname.startsWith('/payment')) return 'payment';
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/antakshari')) return 'antakshari';
  if (pathname === '/webhook/inbound') return 'webhook';
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const pathname = new URL(url, 'http://localhost').pathname;
  const query = parseQuery(url);
  const method = (req.method || 'GET').toUpperCase();

  let bodyRaw = '';
  for await (const chunk of req) bodyRaw += chunk;

  const event = toApiGatewayEvent(req, pathname, bodyRaw || undefined, query);
  const routeType = route(pathname, method);

  try {
    let result;
    if (routeType === 'auth') result = await getAuthHandler()(event);
    else if (routeType === 'payment') result = await getPaymentHandler()(event);
    else if (routeType === 'dashboard') result = await getDashboardHandler()(event);
    else if (routeType === 'antakshari') result = await getAntakshariHandler()(event);
    else if (routeType === 'webhook') result = await getWebhookHandler()(event);
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Not found' }));
      return;
    }

    const statusCode = result.statusCode || 200;
    const headers = result.headers || {};
    const body = typeof result.body === 'string' ? result.body : JSON.stringify(result.body || {});
    res.writeHead(statusCode, { ...headers, 'Content-Type': headers['content-type'] || 'application/json' });
    res.end(body);
  } catch (err) {
    console.error(pathname, err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }));
  }
});

server.listen(PORT, () => {
  console.log('');
  console.log('Local API server (no Docker)');
  console.log('Base URL: http://localhost:' + PORT);
  console.log('Auth:       http://localhost:' + PORT + '/auth/otp/request');
  console.log('Payment:    http://localhost:' + PORT + '/payment/orders');
  console.log('Antakshari: http://localhost:' + PORT + '/antakshari/team');
  console.log('Webhook:    http://localhost:' + PORT + '/webhook/inbound');
  console.log('');
  console.log('Press Ctrl+C to stop');
  console.log('');
});
