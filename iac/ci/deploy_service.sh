#!/usr/bin/env bash
set -euo pipefail
source "./modec/ci/shared/_load_env.sh"

INSTANCE=${1:-}
if [[ -z "${INSTANCE}" ]]; then
  echo "Instance name must be provided. E.g ./modec/ci/deploy_service.sh dev"
  exit 1
fi

./modec/ci/deploy.sh service "${INSTANCE}"
