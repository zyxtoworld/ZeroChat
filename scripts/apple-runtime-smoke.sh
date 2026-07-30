#!/usr/bin/env bash
set -euo pipefail

app="${1:-${APPLE_ZEROCHAT_APP:-.manual-qa/apple-derived-data/Build/Products/Debug/ZeroChat.app}}"
screenshot="${APPLE_ZEROCHAT_SCREENSHOT:-.manual-qa/apple-runtime-smoke.png}"
metadata="${APPLE_ZEROCHAT_METADATA:-.manual-qa/apple-runtime-smoke.json}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
window_probe_source="$script_dir/apple-window-info.swift"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Apple runtime smoke must run on macOS." >&2
  exit 1
fi

for command in swiftc screencapture sips python3; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing Apple runtime smoke dependency: $command" >&2
    exit 1
  fi
done

if [[ ! -f "$window_probe_source" ]]; then
  echo "Apple runtime window probe is missing: $window_probe_source" >&2
  exit 1
fi

if [[ ! -d "$app" ]]; then
  echo "Apple runtime smoke app bundle is missing: $app" >&2
  exit 1
fi

info_plist="$app/Contents/Info.plist"
executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$info_plist" 2>/dev/null || true)"
bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null || true)"
app_executable="$app/Contents/MacOS/$executable"

if [[ -z "$executable" || ! -x "$app_executable" ]]; then
  echo "Apple runtime smoke could not find an executable inside $app." >&2
  exit 1
fi

mkdir -p "$(dirname "$screenshot")"
mkdir -p "$(dirname "$metadata")"
rm -f "$screenshot"
rm -f "$metadata"

pid=""
window_probe=""

is_launched_app_running() {
  local target_pid="$1"
  local child_pid

  while IFS= read -r child_pid; do
    if [[ "$child_pid" == "$target_pid" ]]; then
      return 0
    fi
  done < <(jobs -pr)

  return 1
}

cleanup_app() {
  local app_pid="${pid:-}"
  local probe_path="${window_probe:-}"
  pid=""
  window_probe=""

  if [[ -n "$app_pid" ]] && is_launched_app_running "$app_pid" && kill -0 "$app_pid" >/dev/null 2>&1; then
    kill "$app_pid" >/dev/null 2>&1 || true
    for _ in $(seq 1 20); do
      if ! is_launched_app_running "$app_pid"; then
        break
      fi
      sleep 0.1
    done
    if is_launched_app_running "$app_pid"; then
      kill -9 "$app_pid" >/dev/null 2>&1 || true
    fi
  fi

  if [[ -n "$app_pid" ]]; then
    wait "$app_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$probe_path" ]]; then
    rm -f "$probe_path"
  fi
}
trap cleanup_app EXIT

window_probe="$(mktemp "${TMPDIR:-/tmp}/zerochat-apple-window.XXXXXX")"
rm -f "$window_probe"
swiftc "$window_probe_source" -o "$window_probe"

"$app_executable" >/dev/null 2>&1 &
pid=$!

window_id=""
window_title=""
for _ in $(seq 1 80); do
  if ! is_launched_app_running "$pid"; then
    wait "$pid" >/dev/null 2>&1 || true
    pid=""
    echo "Apple runtime smoke app exited before a window was visible." >&2
    exit 1
  fi

  window_info="$("$window_probe" "$pid" 2>/dev/null || true)"
  window_id="${window_info%%$'\n'*}"
  window_title=""
  if [[ "$window_info" == *$'\n'* ]]; then
    window_title="${window_info#*$'\n'}"
  fi
  if [[ "$window_id" =~ ^[0-9]+$ ]]; then
    break
  fi
  sleep 0.25
done

if [[ ! "$window_id" =~ ^[0-9]+$ ]]; then
  echo "Apple runtime smoke could not find a captureable ZeroChat app window." >&2
  exit 1
fi

sleep 1
screencapture -x "-l${window_id}" "$screenshot"

if [[ ! -s "$screenshot" ]]; then
  echo "Apple runtime screenshot was not created: $screenshot" >&2
  exit 1
fi

python3 - "$screenshot" "$metadata" "$app" "$pid" "$executable" "$bundle_id" "$window_id" "$window_title" <<'PY'
import json
import os
import re
import hashlib
import subprocess
import sys
import struct
import zlib
from datetime import datetime, timezone


def paeth(a, b, c):
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def png_unique_pixels(path):
    with open(path, "rb") as handle:
        data = handle.read()

    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        return 0

    offset = 8
    width = height = bit_depth = color_type = None
    idat = bytearray()

    while offset + 8 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        chunk = data[offset + 8 : offset + 8 + length]
        offset += 12 + length

        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, _ = struct.unpack(">IIBBBBB", chunk)
        elif kind == b"IDAT":
            idat.extend(chunk)
        elif kind == b"IEND":
            break

    channels_by_type = {0: 1, 2: 3, 4: 2, 6: 4}
    channels = channels_by_type.get(color_type)
    if width is None or height is None or bit_depth != 8 or channels is None:
        return 0

    row_length = width * channels
    raw = zlib.decompress(bytes(idat))
    previous = bytearray(row_length)
    position = 0
    pixels = set()
    sample_step = max(1, min(width, height) // 60)

    for y in range(height):
        filter_type = raw[position]
        position += 1
        current = bytearray(raw[position : position + row_length])
        position += row_length

        for x in range(row_length):
            left = current[x - channels] if x >= channels else 0
            up = previous[x]
            upper_left = previous[x - channels] if x >= channels else 0
            if filter_type == 1:
                current[x] = (current[x] + left) & 0xFF
            elif filter_type == 2:
                current[x] = (current[x] + up) & 0xFF
            elif filter_type == 3:
                current[x] = (current[x] + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                current[x] = (current[x] + paeth(left, up, upper_left)) & 0xFF
            elif filter_type != 0:
                return 0

        if y % sample_step == 0:
            for x in range(0, width, sample_step):
                start = x * channels
                pixels.add(tuple(current[start : start + min(3, channels)]))
                if len(pixels) >= 24:
                    return len(pixels)

        previous = current

    return len(pixels)

def file_evidence(path):
    with open(path, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest().upper()
    return {
        "path": os.path.abspath(path),
        "bytes": os.path.getsize(path),
        "sha256": digest,
    }

def bundle_manifest(root):
    root = os.path.abspath(root)
    files = []
    total_bytes = 0
    for directory, _, names in os.walk(root):
        names.sort()
        for name in names:
            full_path = os.path.join(directory, name)
            if not os.path.isfile(full_path):
                continue
            evidence = file_evidence(full_path)
            evidence["path"] = os.path.relpath(full_path, root).replace(os.sep, "/")
            files.append(evidence)
            total_bytes += evidence["bytes"]

    files.sort(key=lambda item: item["path"])
    return {
        "root": root,
        "fileCount": len(files),
        "totalBytes": total_bytes,
        "files": files,
    }

path, metadata, app, pid, executable, bundle_id, window_id, window_title = sys.argv[1:9]
info = subprocess.check_output(["sips", "-g", "pixelWidth", "-g", "pixelHeight", path], text=True)
width_match = re.search(r"pixelWidth:\s*(\d+)", info)
height_match = re.search(r"pixelHeight:\s*(\d+)", info)

if not width_match or not height_match:
    raise SystemExit("Unable to read Apple runtime screenshot dimensions")

width = int(width_match.group(1))
height = int(height_match.group(1))
size = os.path.getsize(path)

if width < 800 or height < 500 or size < 20000:
    raise SystemExit(
        f"Apple runtime screenshot looks collapsed: {width}x{height}, {size} bytes"
    )

unique_pixels = png_unique_pixels(path)
if unique_pixels < 12:
    raise SystemExit(
        f"Apple runtime screenshot looks blank: {unique_pixels} sampled colors"
    )

executable_path = os.path.join(app, "Contents", "MacOS", executable)
executable_evidence = file_evidence(executable_path)
app_bundle_manifest = bundle_manifest(app)

os.makedirs(os.path.dirname(metadata) or ".", exist_ok=True)
with open(metadata, "w", encoding="utf-8") as handle:
    json.dump(
        {
            "platform": "apple",
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "appBundle": os.path.abspath(app),
            "appBundleManifest": app_bundle_manifest,
            "screenshot": os.path.abspath(path),
            "pid": int(pid),
            "executable": executable,
            "executableEvidence": executable_evidence,
            "bundleId": bundle_id,
            "windowId": int(window_id),
            "windowTitle": window_title,
            "width": width,
            "height": height,
            "bytes": size,
            "sampledColors": unique_pixels,
            "captureTarget": "app-window",
            "processAttribution": "exact-bundle-child-pid",
            "cleanupPolicy": "bounded-exit-trap",
            "windowDiscovery": "coregraphics-owner-pid",
        },
        handle,
        ensure_ascii=True,
        indent=2,
        sort_keys=True,
    )
    handle.write("\n")

print(
    f"Apple runtime smoke captured {path} "
    f"({size} bytes, {width}x{height}, {unique_pixels} sampled colors); "
    f"metadata: {metadata}"
)
PY
