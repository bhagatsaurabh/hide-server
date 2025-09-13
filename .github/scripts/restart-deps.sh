#!/usr/bin/env bash
set -euo pipefail

DEP_FILE="dependencies.yaml"
CHANGED_SERVICES=$(cut -d/ -f4 images.txt | cut -d: -f1 | sort -u)

echo "Changed services: $CHANGED_SERVICES"

restart_service() {
  local svc=$1
  echo "Restarting $svc..."
  kubectl rollout restart deployment "$svc" || true

  # Find dependents recursively
  dependents=$(yq ".dependencies[\"$svc\"][]" "$DEP_FILE" 2>/dev/null || true)
  for dep in $dependents; do
    restart_service "$dep"
  done
}

for svc in $CHANGED_SERVICES; do
  restart_service "$svc"
done