#!/usr/bin/env bash
set -euo pipefail
source "./modec/ci/shared/_load_env.sh"

DEPLOYMENT=${1:-}
INSTANCE=${2:-}

if [[ -z "${DEPLOYMENT}" ]] || [[ -z "${INSTANCE}" ]]; then
  echo "Usage: ./modec/ci/plan.sh <deployment> <instance>"
  echo "  deployment: service"
  echo "  instance: dev, exp, prod"
  exit 1
fi

fn_load_instance_env "${INSTANCE}"

cd "modec/infra/${DEPLOYMENT}"

TF_WORKSPACE_NAME="${INSTANCE}"
TF_PLAN_FILENAME="${TF_WORKSPACE_NAME}.tfplan"

TF_WORKSPACE="${TF_WORKSPACE_NAME}" \
  terraform init

TF_WORKSPACE="${INSTANCE}" \
  terraform plan --out "${TF_PLAN_FILENAME}"
