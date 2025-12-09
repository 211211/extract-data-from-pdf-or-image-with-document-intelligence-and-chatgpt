# shellcheck shell=bash

function fn_load_instance_env() {
  INSTANCE=${1}
  env_file="./modec/config/${INSTANCE}/config.env"

  if [[ -f ${env_file} ]]; then
    echo "Loading ${env_file}..."
    set -o allexport
    # shellcheck disable=SC1090
    source "${env_file}"
    set +o allexport
  fi
}
