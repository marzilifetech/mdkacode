#!/usr/bin/env node
/**
 * Delete all data from tables EXCEPT BotConfig (configs) and Payment* (payment).
 *
 * Usage (from project root):
 *   NODE_PATH=./src/dashboard-api/node_modules AWS_REGION=ap-south-1 node scripts/delete-all-users-and-chats.js
 *
 * Requires AWS credentials. Deletes: UserProfile, UserConversationState, WhatsAppMessageLog,
 * HumanEscalation, AuthUser, OTPAttempt, MetaWebhookEventLog, AntakshariTeam, AntakshariMember.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const region = process.env.AWS_REGION || 'ap-south-1';
const client = new DynamoDBClient({ region });
const docClient = DynamoDBDocumentClient.from(client);

const TABLES = [
  { name: 'UserProfile', pk: 'mobile', sk: 'profileType' },
  { name: 'UserConversationState', pk: 'mobile', sk: 'conversationId' },
  { name: 'WhatsAppMessageLog', pk: 'mobile', sk: 'timestamp' },
  { name: 'HumanEscalation', pk: 'escalationId', sk: 'timestamp' },
  { name: 'AuthUser', pk: 'mobile', sk: null },
  { name: 'OTPAttempt', pk: 'attemptId', sk: null },
  { name: 'MetaWebhookEventLog', pk: 'eventId', sk: null },
  { name: 'AntakshariTeam', pk: 'teamId', sk: null },
  { name: 'AntakshariMember', pk: 'teamId', sk: 'memberIndex' }
];

function buildKey(item, tableConfig) {
  const { pk, sk } = tableConfig;
  const key = { [pk]: item[pk] };
  if (sk && item[sk] !== undefined) key[sk] = item[sk];
  return key;
}

async function deleteAllFromTable(tableConfig) {
  const { name, pk, sk } = tableConfig;
  let deleted = 0;
  let lastKey = null;

  do {
    const scanParams = {
      TableName: name,
      ...(lastKey && { ExclusiveStartKey: lastKey })
    };
    const scanResult = await docClient.send(new ScanCommand(scanParams));
    const items = scanResult.Items || [];

    if (items.length === 0 && !lastKey) break;

    const deleteRequests = items.map((item) => ({
      DeleteRequest: { Key: buildKey(item, tableConfig) }
    }));

    if (deleteRequests.length > 0) {
      const batchSize = 25;
      for (let i = 0; i < deleteRequests.length; i += batchSize) {
        const batch = deleteRequests.slice(i, i + batchSize);
        await docClient.send(new BatchWriteCommand({
          RequestItems: { [name]: batch }
        }));
        deleted += batch.length;
      }
    }

    lastKey = scanResult.LastEvaluatedKey || null;
  } while (lastKey);

  return deleted;
}

async function main() {
  console.log(`Region: ${region}`);
  console.log('Deleting all tables (except BotConfig, PaymentProduct, PaymentOrder, PaymentConfig)...\n');

  for (const table of TABLES) {
    try {
      const count = await deleteAllFromTable(table);
      console.log(`${table.name}: deleted ${count} items`);
    } catch (err) {
      console.error(`${table.name}: ERROR`, err.message);
    }
  }

  console.log('\nDone.');
}

main().catch(console.error);
