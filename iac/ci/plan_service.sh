#!/usr/bin/env bash
set -euo pipefail
source "./modec/ci/shared/_load_env.sh"

INSTANCE=${1:-}
if [[ -z "${INSTANCE}" ]]; then
  echo "Instance name must be provided. E.g ./modec/ci/plan_service.sh dev"
  exit 1
fi

./modec/ci/plan.sh service "${INSTANCE}"
