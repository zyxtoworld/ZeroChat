#!/usr/bin/env bash
set -euo pipefail

APP_ID="app.zerochat.client"
APP_NAME="ZeroChat"
BINARY_NAME="zerochat-linux"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
APPDIR="${ZEROCHAT_APPIMAGE_APPDIR:-"${REPO_ROOT}/apps/linux/target/appimage/${APP_NAME}.AppDir"}"
OUTPUT_DIR="${ZEROCHAT_APPIMAGE_OUTPUT_DIR:-"${REPO_ROOT}/apps/linux/target/appimage"}"
APPIMAGE_NAME="${ZEROCHAT_APPIMAGE_NAME:-"${APP_NAME}-x86_64.AppImage"}"

APPDIR_ONLY=0
if [[ "${1:-}" == "--appdir-only" ]]; then
  APPDIR_ONLY=1
fi

require_command() {
  local name="$1"
  if ! command -v "${name}" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

install_file() {
  local source="$1"
  local destination="$2"
  install -Dm644 "${source}" "${destination}"
}

require_command cargo
require_command install

cd "${REPO_ROOT}"
cargo build --manifest-path apps/linux/Cargo.toml --release --locked

rm -rf "${APPDIR}"
mkdir -p "${APPDIR}/usr/bin" "${OUTPUT_DIR}"

install -Dm755 \
  "${REPO_ROOT}/apps/linux/target/release/${BINARY_NAME}" \
  "${APPDIR}/usr/bin/${BINARY_NAME}"
install_file \
  "${REPO_ROOT}/apps/linux/data/${APP_ID}.desktop" \
  "${APPDIR}/usr/share/applications/${APP_ID}.desktop"
install_file \
  "${REPO_ROOT}/apps/linux/data/${APP_ID}.metainfo.xml" \
  "${APPDIR}/usr/share/metainfo/${APP_ID}.metainfo.xml"
install_file \
  "${REPO_ROOT}/apps/linux/data/icons/hicolor/scalable/apps/${APP_ID}.svg" \
  "${APPDIR}/usr/share/icons/hicolor/scalable/apps/${APP_ID}.svg"
install_file \
  "${REPO_ROOT}/apps/linux/data/icons/hicolor/symbolic/apps/${APP_ID}-symbolic.svg" \
  "${APPDIR}/usr/share/icons/hicolor/symbolic/apps/${APP_ID}-symbolic.svg"

cat >"${APPDIR}/AppRun" <<'EOF'
#!/usr/bin/env sh
SELF_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "${SELF_DIR}/usr/bin/zerochat-linux" "$@"
EOF
chmod +x "${APPDIR}/AppRun"

cp "${APPDIR}/usr/share/applications/${APP_ID}.desktop" "${APPDIR}/${APP_ID}.desktop"
cp "${APPDIR}/usr/share/icons/hicolor/scalable/apps/${APP_ID}.svg" "${APPDIR}/${APP_ID}.svg"

if [[ "${APPDIR_ONLY}" -eq 1 || "${ZEROCHAT_APPIMAGE_APPDIR_ONLY:-0}" == "1" ]]; then
  echo "AppDir staged at ${APPDIR}"
  exit 0
fi

if command -v "${LINUXDEPLOY:-linuxdeploy}" >/dev/null 2>&1; then
  cd "${OUTPUT_DIR}"
  "${LINUXDEPLOY:-linuxdeploy}" \
    --appdir "${APPDIR}" \
    --desktop-file "${APPDIR}/usr/share/applications/${APP_ID}.desktop" \
    --icon-file "${APPDIR}/usr/share/icons/hicolor/scalable/apps/${APP_ID}.svg" \
    --output appimage
  exit 0
fi

if command -v "${APPIMAGETOOL:-appimagetool}" >/dev/null 2>&1; then
  "${APPIMAGETOOL:-appimagetool}" "${APPDIR}" "${OUTPUT_DIR}/${APPIMAGE_NAME}"
  exit 0
fi

cat >&2 <<EOF
AppDir staged at ${APPDIR}, but neither linuxdeploy nor appimagetool was found.
Install linuxdeploy or appimagetool on the Linux target host, or rerun with --appdir-only
when you only need to validate the AppDir contents before packaging.
EOF
exit 1
