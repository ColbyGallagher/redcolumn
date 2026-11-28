#!/usr/bin/env bash
# Restore a redcolumn backup (database + blobs) and verify integrity.
#
# WARNING: This overwrites the current database contents. Stop traffic or stop
# the caddy service before restoring on a live host.
#
# Usage:
#   ./restore.sh <backup-directory> --yes

set -euo pipefail

if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "Usage: $0 <backup-directory> --yes" >&2
  exit 1
fi

BACKUP_DIR="$1"
CONFIRM="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_IN_CONTAINER=""

if [[ "$CONFIRM" != "--yes" ]]; then
  echo "Error: restoring overwrites existing data. Re-run with --yes to confirm." >&2
  exit 1
fi

if [[ ! -f "$BACKUP_DIR/manifest.json" || ! -f "$BACKUP_DIR/database.dump" ]]; then
  echo "Error: '$BACKUP_DIR' does not look like a redcolumn backup (missing manifest.json or database.dump)." >&2
  exit 1
fi

cleanup() {
  if [[ -n "$TMP_IN_CONTAINER" ]]; then
    docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server rm -rf "$TMP_IN_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Copying backup into server container..."
TMP_IN_CONTAINER="$(docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server mktemp -d /tmp/redcolumn-restore.XXXXXX)"
tar -C "$BACKUP_DIR" -cf - . | docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server tar -xf - -C "$TMP_IN_CONTAINER"

echo "Running redcolumn-admin restore..."
docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server \
  redcolumn-admin restore --from "$TMP_IN_CONTAINER" --yes

echo "Running redcolumn-admin verify..."
docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server \
  redcolumn-admin verify

echo "Restore and verification complete."
