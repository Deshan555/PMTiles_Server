#!/usr/bin/env bash

set -Eeuo pipefail

FILE_ID="${FILE_ID:-YOUR_GOOGLE_DRIVE_FILE_ID}"
OUTPUT="${OUTPUT:-data/map.pmtiles}"
MIN_SIZE_BYTES="${MIN_SIZE_BYTES:-1024}"

COOKIE_FILE="/tmp/gdrive_cookie_$$"
TEMP_OUTPUT="${OUTPUT}.part"

echo "Google Drive PMTiles Downloader"
echo "--------------------------------"

# --------------------------------------------------
# 1. Validate FILE_ID
# --------------------------------------------------
if [[ -z "$FILE_ID" || "$FILE_ID" == "YOUR_GOOGLE_DRIVE_FILE_ID" ]]; then
  echo "ERROR: Please set your Google Drive FILE_ID."
  echo ""
  echo "Example:"
  echo "FILE_ID=\"1AbCdEfGhIjKlMnOpQr\""
  exit 1
fi

# --------------------------------------------------
# 2. Check required commands
# --------------------------------------------------
REQUIRED_COMMANDS=(
  curl
  grep
  sed
  awk
  wc
  head
  mkdir
  rm
  ls
)

echo "Checking required packages..."

MISSING_COMMANDS=()

for cmd in "${REQUIRED_COMMANDS[@]}"; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    MISSING_COMMANDS+=("$cmd")
  fi
done

if [[ ${#MISSING_COMMANDS[@]} -gt 0 ]]; then
  echo "ERROR: Missing required commands:"
  printf ' - %s\n' "${MISSING_COMMANDS[@]}"
  echo ""
  echo "Please install them manually in your VM, then run this script again."
  exit 1
fi

echo "All required commands are available."

# --------------------------------------------------
# 3. Check output directory
# --------------------------------------------------
OUTPUT_DIR="$(dirname "$OUTPUT")"

echo "Checking output directory: $OUTPUT_DIR"

if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "Directory does not exist. Creating: $OUTPUT_DIR"
  mkdir -p "$OUTPUT_DIR"
fi

if [[ ! -w "$OUTPUT_DIR" ]]; then
  echo "ERROR: Output directory is not writable: $OUTPUT_DIR"
  exit 1
fi

echo "Output directory is ready."

# --------------------------------------------------
# 4. Clean old partial file
# --------------------------------------------------
if [[ -f "$TEMP_OUTPUT" ]]; then
  echo "Removing old partial download: $TEMP_OUTPUT"
  rm -f "$TEMP_OUTPUT"
fi

# --------------------------------------------------
# 5. Get Google Drive confirmation token
# --------------------------------------------------
echo "Preparing Google Drive download..."

CONFIRM="$(
  curl -s -L -c "$COOKIE_FILE" \
    "https://drive.google.com/uc?export=download&id=${FILE_ID}" \
    | grep -o 'confirm=[^&]*' \
    | head -n 1 \
    | sed 's/confirm=//'
)"

# --------------------------------------------------
# 6. Download file
# --------------------------------------------------
echo "Downloading file..."

if [[ -n "$CONFIRM" ]]; then
  curl -L -b "$COOKIE_FILE" \
    "https://drive.google.com/uc?export=download&confirm=${CONFIRM}&id=${FILE_ID}" \
    -o "$TEMP_OUTPUT"
else
  curl -L -b "$COOKIE_FILE" \
    "https://drive.google.com/uc?export=download&id=${FILE_ID}" \
    -o "$TEMP_OUTPUT"
fi

rm -f "$COOKIE_FILE"

# --------------------------------------------------
# 7. Verify file exists
# --------------------------------------------------
if [[ ! -f "$TEMP_OUTPUT" ]]; then
  echo "ERROR: Download failed. File was not created."
  exit 1
fi

# --------------------------------------------------
# 8. Verify file size
# --------------------------------------------------
FILE_SIZE="$(wc -c < "$TEMP_OUTPUT" | awk '{print $1}')"

echo "Downloaded file size: ${FILE_SIZE} bytes"

if [[ "$FILE_SIZE" -lt "$MIN_SIZE_BYTES" ]]; then
  echo "ERROR: Downloaded file is too small."
  echo "This may be an HTML error page, permission issue, or invalid Google Drive file ID."
  echo ""
  echo "Preview:"
  head -n 20 "$TEMP_OUTPUT"
  rm -f "$TEMP_OUTPUT"
  exit 1
fi

# --------------------------------------------------
# 9. Verify PMTiles magic header
# --------------------------------------------------
MAGIC="$(head -c 7 "$TEMP_OUTPUT" || true)"

if [[ "$MAGIC" != "PMTiles" ]]; then
  echo "ERROR: Downloaded file does not look like a valid PMTiles file."
  echo "Expected file header: PMTiles"
  echo "Actual file header: $MAGIC"
  echo ""
  echo "This usually means Google Drive returned an HTML page instead of the real file."
  echo "Possible reasons:"
  echo " - File is not shared publicly"
  echo " - Wrong FILE_ID"
  echo " - Google Drive virus-scan confirmation was not handled"
  echo " - Download quota exceeded"
  echo ""
  echo "Preview:"
  head -n 20 "$TEMP_OUTPUT"
  rm -f "$TEMP_OUTPUT"
  exit 1
fi

# --------------------------------------------------
# 10. Replace final file safely
# --------------------------------------------------
mv "$TEMP_OUTPUT" "$OUTPUT"

echo ""
echo "Download completed successfully."
echo "File saved to: $OUTPUT"
ls -lh "$OUTPUT"

echo ""
echo "PMTiles verification passed."
echo "File size: ${FILE_SIZE} bytes"
echo "Header: ${MAGIC}"