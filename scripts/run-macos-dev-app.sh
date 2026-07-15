#!/bin/zsh
set -euo pipefail
unsetopt BG_NICE

if [[ $# -lt 1 ]]; then
  print -u2 "Talkis macOS dev runner: missing Cargo command or executable path"
  exit 2
fi

SCRIPT_DIR="${0:A:h}"
PROJECT_ROOT="${SCRIPT_DIR:h}"
APP_ARGUMENTS=()
target_triple=""

if [[ "$1" == "run" ]]; then
  shift
  BUILD_ARGUMENTS=()
  parsing_app_arguments=0
  for argument in "$@"; do
    if [[ "${argument}" == "--" && "${parsing_app_arguments}" == "0" ]]; then
      parsing_app_arguments=1
      continue
    fi
    if [[ "${parsing_app_arguments}" == "1" ]]; then
      APP_ARGUMENTS+=("${argument}")
    else
      BUILD_ARGUMENTS+=("${argument}")
    fi
  done

  profile="debug"
  for ((index = 1; index <= ${#BUILD_ARGUMENTS}; index += 1)); do
    argument="${BUILD_ARGUMENTS[index]}"
    if [[ "${argument}" == "--release" ]]; then
      profile="release"
    elif [[ "${argument}" == "--target" && index -lt ${#BUILD_ARGUMENTS} ]]; then
      target_triple="${BUILD_ARGUMENTS[index + 1]}"
    elif [[ "${argument}" == --target=* ]]; then
      target_triple="${argument#--target=}"
    fi
  done

  if [[ "${TALKIS_DEV_SKIP_BUILD:-0}" != "1" ]]; then
    cargo build --bin talkis "${BUILD_ARGUMENTS[@]}"
  fi

  target_root="${CARGO_TARGET_DIR:-${PWD}/target}"
  if [[ -n "${target_triple}" ]]; then
    target_root="${target_root}/${target_triple}"
  fi
  SOURCE_EXECUTABLE="${target_root}/${profile}/talkis"
else
  SOURCE_EXECUTABLE="${1:A}"
  shift
  APP_ARGUMENTS=("$@")
fi

if [[ ! -f "${SOURCE_EXECUTABLE}" ]]; then
  print -u2 "Talkis macOS dev runner: executable not found: ${SOURCE_EXECUTABLE}"
  exit 2
fi

SOURCE_EXECUTABLE="${SOURCE_EXECUTABLE:A}"

SOURCE_DIR="${SOURCE_EXECUTABLE:h}"
APP_DIR="${SOURCE_DIR}/bundle/macos/Talkis Dev.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
APP_EXECUTABLE="${MACOS_DIR}/Talkis"
INFO_PLIST="${CONTENTS_DIR}/Info.plist"
APP_VERSION="$(/usr/bin/plutil -extract version raw -o - "${PROJECT_ROOT}/package.json")"
SIGNING_IDENTITY="${TALKIS_DEV_SIGNING_IDENTITY:-}"

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  SIGNING_IDENTITY="$(
    /usr/bin/security find-identity -v -p codesigning 2>/dev/null | \
      /usr/bin/awk '/"Apple Development:/{print $2; exit}'
  )"
fi

if [[ -z "${SIGNING_IDENTITY}" ]]; then
  SIGNING_IDENTITY="-"
  print -u2 "Talkis dev: no Apple Development signing identity found; macOS permissions may reset after each rebuild"
else
  print "Talkis dev: using stable signing identity ${SIGNING_IDENTITY}"
fi

mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"
cp "${SOURCE_EXECUTABLE}" "${APP_EXECUTABLE}"
chmod +x "${APP_EXECUTABLE}"

if [[ -z "${target_triple}" ]]; then
  target_triple="$(rustc --print host-tuple)"
fi

for sidecar in talkis-ffmpeg talkis-stt talkis-diarize talkis-llm; do
  prepared_sidecar="${PROJECT_ROOT}/src-tauri/binaries/${sidecar}-${target_triple}"
  target_sidecar="${SOURCE_DIR}/${sidecar}"

  if [[ -f "${prepared_sidecar}" ]]; then
    cp "${prepared_sidecar}" "${MACOS_DIR}/${sidecar}"
    chmod +x "${MACOS_DIR}/${sidecar}"
  elif [[ -f "${target_sidecar}" ]]; then
    cp "${target_sidecar}" "${MACOS_DIR}/${sidecar}"
    chmod +x "${MACOS_DIR}/${sidecar}"
  fi
done

if [[ -f "${PROJECT_ROOT}/src-tauri/icons/icon.icns" ]]; then
  cp "${PROJECT_ROOT}/src-tauri/icons/icon.icns" "${RESOURCES_DIR}/icon.icns"
fi

cp "${PROJECT_ROOT}/src-tauri/Info.plist" "${INFO_PLIST}"

set_plist_string() {
  local key="$1"
  local value="$2"
  /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${INFO_PLIST}" >/dev/null 2>&1 || \
    /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "${INFO_PLIST}"
}

set_plist_bool() {
  local key="$1"
  local value="$2"
  /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "${INFO_PLIST}" >/dev/null 2>&1 || \
    /usr/libexec/PlistBuddy -c "Add :${key} bool ${value}" "${INFO_PLIST}"
}

set_plist_string "CFBundleDisplayName" "Talkis Dev"
set_plist_string "CFBundleName" "Talkis Dev"
set_plist_string "CFBundleExecutable" "Talkis"
set_plist_string "CFBundleIdentifier" "com.trixter.talkis.dev"
set_plist_string "CFBundleInfoDictionaryVersion" "6.0"
set_plist_string "CFBundlePackageType" "APPL"
set_plist_string "CFBundleShortVersionString" "${APP_VERSION}"
set_plist_string "CFBundleVersion" "${APP_VERSION}"
set_plist_string "CFBundleIconFile" "icon.icns"
set_plist_string "LSMinimumSystemVersion" "11.0"
set_plist_bool "CSResourcesFileMapped" "true"
set_plist_bool "LSRequiresCarbon" "true"
set_plist_bool "NSHighResolutionCapable" "true"

codesign \
  --force \
  --deep \
  --timestamp=none \
  --sign "${SIGNING_IDENTITY}" \
  --identifier "com.trixter.talkis.dev" \
  --entitlements "${PROJECT_ROOT}/src-tauri/entitlements.plist" \
  "${APP_DIR}" >/dev/null

print "Talkis dev: prepared signed app bundle ${APP_DIR}"

if [[ "${TALKIS_DEV_PREPARE_ONLY:-0}" == "1" ]]; then
  exit 0
fi

if /usr/bin/pgrep -f "${APP_EXECUTABLE}" >/dev/null 2>&1; then
  print "Talkis dev: stopping previous app instance before relaunch"
  /usr/bin/pkill -f "${APP_EXECUTABLE}" >/dev/null 2>&1 || true
  for _attempt in {1..40}; do
    if ! /usr/bin/pgrep -f "${APP_EXECUTABLE}" >/dev/null 2>&1; then
      break
    fi
    sleep 0.05
  done
fi

print "Talkis dev: launching ${APP_DIR}"

open_pid=""
terminate_app() {
  /usr/bin/pkill -f "${APP_EXECUTABLE}" >/dev/null 2>&1 || true
  if [[ -n "${open_pid}" ]]; then
    kill "${open_pid}" >/dev/null 2>&1 || true
  fi
}
trap 'terminate_app; exit 130' INT
trap 'terminate_app; exit 143' TERM HUP

/usr/bin/open -n -W "${APP_DIR}" --args "${APP_ARGUMENTS[@]}" &
open_pid=$!
set +e
wait "${open_pid}"
open_status=$?
set -e
open_pid=""

# The process plugin relaunches the executable directly. LaunchServices stops
# waiting for the original instance, so keep the Tauri runner alive while the
# replacement process is running instead of killing it from an EXIT trap.
for _attempt in {1..20}; do
  if /usr/bin/pgrep -f "${APP_EXECUTABLE}" >/dev/null 2>&1; then
    print "Talkis dev: attached to relaunched app process"
    while /usr/bin/pgrep -f "${APP_EXECUTABLE}" >/dev/null 2>&1; do
      sleep 0.5
    done
    break
  fi
  sleep 0.1
done

exit "${open_status}"
