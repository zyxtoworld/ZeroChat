#!/usr/bin/env bash
set -euo pipefail

binary="${1:-${LINUX_ZEROCHAT_BINARY:-apps/linux/target/release/zerochat-linux}}"
screenshot="${LINUX_ZEROCHAT_SCREENSHOT:-.manual-qa/linux-runtime-smoke.png}"
metadata="${LINUX_ZEROCHAT_METADATA:-.manual-qa/linux-runtime-smoke.json}"
display="${LINUX_ZEROCHAT_DISPLAY:-:99}"
width="${LINUX_ZEROCHAT_WIDTH:-1280}"
height="${LINUX_ZEROCHAT_HEIGHT:-800}"

for command in Xvfb dbus-run-session xdotool import identify python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing Linux runtime smoke dependency: $command" >&2
    exit 1
  fi
done

if [[ ! -x "$binary" ]]; then
  echo "Linux runtime smoke binary is missing or not executable: $binary" >&2
  exit 1
fi

mkdir -p "$(dirname "$screenshot")"
mkdir -p "$(dirname "$metadata")"
rm -f "$screenshot"
rm -f "$metadata"

Xvfb "$display" -screen 0 "${width}x${height}x24" -nolisten tcp >/tmp/zerochat-xvfb.log 2>&1 &
xvfb_pid=$!
display_ready=0
for _ in $(seq 1 20); do
  if DISPLAY="$display" xdotool getdisplaygeometry >/dev/null 2>&1; then
    display_ready=1
    break
  fi
  sleep 0.25
done
if [[ "$display_ready" -ne 1 ]]; then
  echo "Linux runtime smoke display did not become ready: $display" >&2
  cat /tmp/zerochat-xvfb.log >&2 || true
  exit 1
fi

cleanup() {
  if kill -0 "$xvfb_pid" >/dev/null 2>&1; then
    kill "$xvfb_pid" >/dev/null 2>&1 || true
    wait "$xvfb_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

export DISPLAY="$display"
export GDK_BACKEND=x11
export GSK_RENDERER="${GSK_RENDERER:-cairo}"
export LIBGL_ALWAYS_SOFTWARE="${LIBGL_ALWAYS_SOFTWARE:-1}"
export ZEROCHAT_BINARY="$binary"
export ZEROCHAT_SCREENSHOT="$screenshot"
export ZEROCHAT_WINDOW_METADATA="/tmp/zerochat-linux-window-metadata"
rm -f "$ZEROCHAT_WINDOW_METADATA"

dbus-run-session -- bash <<'SMOKE'
set -euo pipefail

"$ZEROCHAT_BINARY" >/tmp/zerochat-linux-runtime.log 2>&1 &
app_pid=$!

cleanup_app() {
  if kill -0 "$app_pid" >/dev/null 2>&1; then
    kill "$app_pid" >/dev/null 2>&1 || true
    wait "$app_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup_app EXIT

window_id=""
window_width=""
window_height=""
for _ in $(seq 1 80); do
  if ! kill -0 "$app_pid" >/dev/null 2>&1; then
    echo "ZeroChat Linux app exited before a window was visible." >&2
    cat /tmp/zerochat-linux-runtime.log >&2 || true
    exit 1
  fi

  candidate_window_id="$(xdotool search --name '^ZeroChat$' 2>/dev/null | head -n 1 || true)"
  if [[ -n "$candidate_window_id" ]]; then
    candidate_geometry="$(xdotool getwindowgeometry --shell "$candidate_window_id" 2>/dev/null || true)"
    candidate_width="$(printf '%s\n' "$candidate_geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
    candidate_height="$(printf '%s\n' "$candidate_geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
    if [[ -n "$candidate_width" && -n "$candidate_height" && "$candidate_width" -ge 360 && "$candidate_height" -ge 360 ]]; then
      window_id="$candidate_window_id"
      window_width="$candidate_width"
      window_height="$candidate_height"
      break
    fi
  fi

  sleep 0.25
done

if [[ -z "$window_id" ]]; then
  echo "ZeroChat Linux app did not expose a stable visible window in time." >&2
  cat /tmp/zerochat-linux-runtime.log >&2 || true
  exit 1
fi

geometry="$(xdotool getwindowgeometry --shell "$window_id" 2>/dev/null || true)"
window_width="$(printf '%s\n' "$geometry" | awk -F= '$1 == "WIDTH" { print $2 }')"
window_height="$(printf '%s\n' "$geometry" | awk -F= '$1 == "HEIGHT" { print $2 }')"
window_name="$(xdotool getwindowname "$window_id" 2>/dev/null || true)"

if [[ -z "$window_width" || -z "$window_height" || "$window_width" -lt 360 || "$window_height" -lt 360 ]]; then
  echo "ZeroChat Linux app window looks collapsed: ${window_width:-unknown}x${window_height:-unknown}" >&2
  cat /tmp/zerochat-linux-runtime.log >&2 || true
  exit 1
fi

xdotool windowactivate "$window_id" >/dev/null 2>&1 || true
sleep 0.5
ready=0
for _ in $(seq 1 20); do
  import -window "$window_id" "$ZEROCHAT_SCREENSHOT"
  screenshot_bytes="$(wc -c < "$ZEROCHAT_SCREENSHOT" | tr -d '[:space:]')"
  screenshot_colors="$(identify -format '%k' "$ZEROCHAT_SCREENSHOT")"
  if [[ "$screenshot_bytes" -ge 10000 && "$screenshot_colors" -ge 24 ]]; then
    ready=1
    break
  fi
  sleep 0.5
done

if [[ "$ready" -ne 1 ]]; then
  echo "Linux runtime window did not render a stable UI before screenshot timeout." >&2
  exit 1
fi
printf 'windowId=%s\nwindowName=%s\nwindowWidth=%s\nwindowHeight=%s\n' \
  "$window_id" "$window_name" "$window_width" "$window_height" > "$ZEROCHAT_WINDOW_METADATA"
SMOKE

if [[ ! -s "$screenshot" ]]; then
  echo "Linux runtime screenshot was not created: $screenshot" >&2
  exit 1
fi

distinct_colors="$(identify -format '%k' "$screenshot")"

if [[ "$distinct_colors" -lt 24 ]]; then
  echo "Linux runtime screenshot looks blank or collapsed: $distinct_colors colors" >&2
  exit 1
fi

bytes="$(wc -c < "$screenshot" | tr -d '[:space:]')"
image_size="$(identify -format '%w %h' "$screenshot")"
image_width="${image_size%% *}"
image_height="${image_size##* }"
window_id="$(awk -F= '$1 == "windowId" { print $2 }' "$ZEROCHAT_WINDOW_METADATA" 2>/dev/null || true)"
window_name="$(awk -F= '$1 == "windowName" { print $2 }' "$ZEROCHAT_WINDOW_METADATA" 2>/dev/null || true)"
window_width="$(awk -F= '$1 == "windowWidth" { print $2 }' "$ZEROCHAT_WINDOW_METADATA" 2>/dev/null || true)"
window_height="$(awk -F= '$1 == "windowHeight" { print $2 }' "$ZEROCHAT_WINDOW_METADATA" 2>/dev/null || true)"

python3 - "$metadata" "$binary" "$screenshot" "$display" "$window_id" "$window_name" "$window_width" "$window_height" "$image_width" "$image_height" "$bytes" "$distinct_colors" <<'PY'
import hashlib
import json
import os
import sys
from datetime import datetime, timezone

(
    metadata,
    binary,
    screenshot,
    display,
    window_id,
    window_name,
    window_width,
    window_height,
    image_width,
    image_height,
    byte_count,
    distinct_colors,
) = sys.argv[1:13]

def file_evidence(path):
    with open(path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest().upper()
    return {
        "path": os.path.abspath(path),
        "bytes": os.path.getsize(path),
        "sha256": digest,
    }

os.makedirs(os.path.dirname(metadata) or ".", exist_ok=True)
with open(metadata, "w", encoding="utf-8") as handle:
    json.dump(
        {
            "platform": "linux",
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "binary": os.path.abspath(binary),
            "binaryEvidence": file_evidence(binary),
            "screenshot": os.path.abspath(screenshot),
            "display": display,
            "windowId": int(window_id) if window_id else None,
            "windowTitle": window_name,
            "windowWidth": int(window_width) if window_width else None,
            "windowHeight": int(window_height) if window_height else None,
            "width": int(image_width),
            "height": int(image_height),
            "bytes": int(byte_count),
            "distinctColors": int(distinct_colors),
            "captureTarget": "app-window",
        },
        handle,
        ensure_ascii=True,
        indent=2,
        sort_keys=True,
    )
    handle.write("\n")
PY

rm -f "$ZEROCHAT_WINDOW_METADATA"
echo "Linux runtime smoke captured $screenshot ($bytes bytes, ${image_width}x${image_height}, $distinct_colors colors); metadata: $metadata"
