#!/usr/bin/env bash
set -euo pipefail
source "./modec/ci/shared/_load_env.sh"

DEPLOYMENT=${1:-}
INSTANCE=${2:-}

if [[ -z "${DEPLOYMENT}" ]] || [[ -z "${INSTANCE}" ]]; then
  echo "Usage: ./modec/ci/deploy.sh <deployment> <instance>"
  echo "  deployment: service"
  echo "  instance: dev, exp, prod"
  exit 1
fi

fn_load_instance_env "${INSTANCE}"

cd "modec/infra/${DEPLOYMENT}"

TF_PLAN_FILENAME="${INSTANCE}.tfplan"

TF_WORKSPACE="${INSTANCE}" \
  terraform apply "${TF_PLAN_FILENAME}"
