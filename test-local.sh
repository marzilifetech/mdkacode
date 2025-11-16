#!/bin/bash


echo "Building SAM application..."
sam build

echo ""
echo "Testing Text Message..."
sam local invoke GupshupInboundWebhook --event events/test-text-message.json --env-vars env.json

echo ""
echo "Testing Image Message..."
sam local invoke GupshupInboundWebhook --event events/test-image-message.json --env-vars env.json

echo ""
echo "Testing Sticker Message..."
sam local invoke GupshupInboundWebhook --event events/test-sticker-message.json --env-vars env.json

echo ""
echo "Testing Invalid Payload (should return 400)..."
sam local invoke GupshupInboundWebhook --event events/test-invalid-payload.json --env-vars env.json

