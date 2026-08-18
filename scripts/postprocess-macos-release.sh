#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:?usage: postprocess-macos-release.sh <version>}"
APP_NAME="Talkis"
APP_IDENTIFIER="com.trixter.talkis"
BUILD_ROOT="${BUILD_ROOT:-/tmp/talkis-target/release/bundle}"
APP_PATH="${BUILD_ROOT}/macos/${APP_NAME}.app"
UPDATER_ARCHIVE="${BUILD_ROOT}/macos/${APP_NAME}.app.tar.gz"
UPDATER_ARCHIVE_TMP="${UPDATER_ARCHIVE}.tmp"
UPDATER_SIGNATURE="${UPDATER_ARCHIVE}.sig"
DMG_PATH="${BUILD_ROOT}/dmg/${APP_NAME}_${VERSION}_aarch64.dmg"
STAGING_DIR="${BUILD_ROOT}/macos/dmg-staging"
DMG_DIR="$(dirname "${DMG_PATH}")"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "App bundle not found at ${APP_PATH}" >&2
  exit 1
fi

echo "Verifying Developer ID signature for ${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

SIGNATURE_INFO="$(codesign -dv --verbose=4 "${APP_PATH}" 2>&1)"
if ! grep -Fq "Identifier=${APP_IDENTIFIER}" <<<"${SIGNATURE_INFO}"; then
  echo "macOS app has an unexpected bundle signature identifier; expected ${APP_IDENTIFIER}" >&2
  exit 1
fi
if grep -Fq "Signature=adhoc" <<<"${SIGNATURE_INFO}" || \
  ! grep -Fq "Authority=Developer ID Application:" <<<"${SIGNATURE_INFO}"; then
  echo "A Developer ID Application signature is required for stable macOS Accessibility permissions across updates" >&2
  exit 1
fi
if grep -Fq "TeamIdentifier=not set" <<<"${SIGNATURE_INFO}"; then
  echo "The macOS app signature has no stable Apple team identifier" >&2
  exit 1
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  if [[ ! -f "${TAURI_SIGNING_PRIVATE_KEY_PATH}" ]]; then
    echo "TAURI_SIGNING_PRIVATE_KEY_PATH does not point to a file: ${TAURI_SIGNING_PRIVATE_KEY_PATH}" >&2
    exit 1
  fi
  export TAURI_SIGNING_PRIVATE_KEY="$(<"${TAURI_SIGNING_PRIVATE_KEY_PATH}")"
  unset TAURI_SIGNING_PRIVATE_KEY_PATH
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  echo "TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is required to rebuild the signed updater archive" >&2
  exit 1
fi

echo "Rebuilding updater archive from the signed app bundle"
rm -f "${UPDATER_ARCHIVE_TMP}" "${UPDATER_SIGNATURE}"
COPYFILE_DISABLE=1 tar \
  -czf "${UPDATER_ARCHIVE_TMP}" \
  -C "$(dirname "${APP_PATH}")" \
  "${APP_NAME}.app"
mv "${UPDATER_ARCHIVE_TMP}" "${UPDATER_ARCHIVE}"
bun run tauri signer sign "${UPDATER_ARCHIVE}"

echo "Rebuilding DMG from signed app bundle"
rm -rf "${STAGING_DIR}"
mkdir -p "${STAGING_DIR}"
mkdir -p "${DMG_DIR}"
cp -R "${APP_PATH}" "${STAGING_DIR}/"
ln -s /Applications "${STAGING_DIR}/Applications"
rm -f "${DMG_PATH}"

hdiutil create \
  -volname "${APP_NAME}" \
  -srcfolder "${STAGING_DIR}" \
  -ov \
  -format UDZO \
  "${DMG_PATH}"

echo "Post-processing complete"
printf '%s\n' "${SIGNATURE_INFO}" | sed 's/^/codesign: /'
