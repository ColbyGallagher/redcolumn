#!/usr/bin/env bash
# Create a consistent backup of the redcolumn Postgres database and blob store.
#
# Usage:
#   ./backup.sh <output-directory>
#
# Example:
#   ./backup.sh /srv/backups/redcolumn-2026-11-28

set -euo pipefail

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "Usage: $0 <output-directory>" >&2
  exit 1
fi

OUT_DIR="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_IN_CONTAINER="/tmp/redcolumn-backup-$$"

if [[ -e "$OUT_DIR" && -n "$(ls -A "$OUT_DIR" 2>/dev/null || true)" ]]; then
  echo "Error: output directory '$OUT_DIR' already exists and is not empty." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

cleanup() {
  docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server rm -rf "$TMP_IN_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Running redcolumn-admin backup inside server container..."
docker compose -f "$SCRIPT_DIR/compose.yaml" exec -T server \
  redcolumn-admin backup --out "$TMP_IN_CONTAINER"

echo "Copying backup archive to $OUT_DIR..."
docker compose -f "$SCRIPT_DIR/compose.yaml" cp "server:$TMP_IN_CONTAINER/." "$OUT_DIR/"

echo "Backup complete: $OUT_DIR"
