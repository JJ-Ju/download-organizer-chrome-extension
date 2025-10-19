#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OUT_DIR="dist"
ARCHIVE_NAME="download-organizer.zip"
ARCHIVE_PATH="${OUT_DIR}/${ARCHIVE_NAME}"

mkdir -p "$OUT_DIR"
rm -f "$ARCHIVE_PATH"

ZIP_EXCLUDES=(
    ".git/*"
    "${OUT_DIR}/*"
    "package-extension.sh"
    "AGENTS.md"
)

zip -r -q "$ARCHIVE_PATH" . -x "${ZIP_EXCLUDES[@]}"

echo "Packaged extension at ${ARCHIVE_PATH}"
