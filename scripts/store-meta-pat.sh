#!/usr/bin/env bash
# Store Meta Page Access Token (PAT) in AWS SSM Parameter Store (SecureString).
# Run once per environment. Usage: ./scripts/store-meta-pat.sh 'YOUR_META_PAT'
# Requires: AWS CLI configured with permissions for ssm:PutParameter.

set -e
NAME="/whatsapp-bot/meta-page-access-token"
if [ -z "$1" ]; then
  echo "Usage: $0 '<your-meta-page-access-token>'"
  echo "Stores the token in SSM at $NAME (SecureString)."
  exit 1
fi
aws ssm put-parameter \
  --name "$NAME" \
  --value "$1" \
  --type SecureString \
  --overwrite
echo "Stored Meta PAT in SSM: $NAME"
