#!/usr/bin/env bash
set -euo pipefail
source "./modec/ci/shared/_load_env.sh"

INSTANCE=${1:-}
if [[ -z "${INSTANCE}" ]]; then
  echo "Instance name must be provided. E.g ./modec/ci/deploy_app.sh dev"
  exit 1
fi

# App naming convention: ai-native-chat-<instance> for non-prod, ai-native-chat for prod
if [[ "${INSTANCE}" == "prod" ]]; then
  APP_NAME="ai-native-chat"
else
  APP_NAME="ai-native-chat-${INSTANCE}"
fi

fn_load_instance_env "${INSTANCE}"

# Build the NestJS application
echo "Building AINativeEnterpriseChatApp..."
yarn build

# Create output directory if it doesn't exist
mkdir -p output

# Create deployment package
echo "Creating deployment package..."
cd dist
zip -r ../output/app.zip .
cd ..

# Deploy to Azure Web App
echo "Deploying to Azure Web App: ${APP_NAME}..."
az webapp deploy --resource-group "${RESOURCE_GROUP_NAME}" \
  --name "${APP_NAME}" \
  --src-path "./output/app.zip"

echo "Deployment complete!"
echo "App URL: https://${APP_NAME}.azurewebsites.net"
