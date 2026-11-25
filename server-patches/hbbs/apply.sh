#!/usr/bin/env bash
set -euo pipefail
patch_dir="$(cd "$(dirname "$0")" && pwd)"
if [[ $# != 1 ]]; then
  echo "Usage: $0 /path/to/clean/rustdesk-server" >&2
  exit 1
fi
server_dir="$(cd "$1" && pwd)"
expected_server=680b60395ecf99a76f74a1d934e453bb6e5e0aa2
expected_common=69cea8dafee147848ae88702029f4bf7df7224c3
if [[ "$(git -C "$server_dir" rev-parse HEAD)" != "$expected_server" ]] ||
   [[ "$(git -C "$server_dir/libs/hbb_common" rev-parse HEAD)" != "$expected_common" ]]; then
  echo "Source revision does not match the documented patch base. No changes made." >&2
  exit 1
fi
if [[ -n "$(git -C "$server_dir" status --porcelain)" ]] ||
   [[ -n "$(git -C "$server_dir/libs/hbb_common" status --porcelain)" ]]; then
  echo "Use a clean checkout; existing changes will not be overwritten." >&2
  exit 1
fi
git -C "$server_dir" apply --check "$patch_dir/hbbs-webrtc.patch"
git -C "$server_dir/libs/hbb_common" apply --check "$patch_dir/hbb-common-webrtc.patch"
git -C "$server_dir" apply "$patch_dir/hbbs-webrtc.patch"
git -C "$server_dir/libs/hbb_common" apply "$patch_dir/hbb-common-webrtc.patch"
echo "Patched source. Build and validate hbbs before enabling ENABLE_WEBRTC=Y."
