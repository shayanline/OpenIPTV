#!/usr/bin/env bash
# Build the web app, then wrap dist/ as a signed Tizen widget.
#
# Vite copies public/ verbatim, so config.xml and icon.png land beside index.html and
# dist/ is already a complete widget root. The Tizen CLI signs in place.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${SIGNING_PROFILE:-shayanline}"

# Tizen Studio installs to different places depending on how it was set up, so look
# rather than assume, and say something useful when it is missing.
find_tizen() {
  [ -n "${TIZEN_CLI:-}" ] && [ -x "$TIZEN_CLI" ] && { echo "$TIZEN_CLI"; return; }
  for candidate in \
    "$HOME/tizen-studio/tools/ide/bin/tizen" \
    "$HOME/TizenStudio/tools/ide/bin/tizen" \
    "/Applications/tizen-studio/tools/ide/bin/tizen" \
    "$(command -v tizen 2>/dev/null || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
}

echo "Building..."
npm --prefix "$ROOT" run build

TIZEN="$(find_tizen)"
if [ -z "$TIZEN" ]; then
  cat <<'MSG'

Built, but not packaged: the Tizen CLI was not found.

dist/ is already a complete widget root, so all that is missing is signing. Install
Tizen Studio (the CLI alone is enough), then either set TIZEN_CLI to its path or
re-run this script.

A widget must be signed by an author certificate to install on a TV, and by a Samsung
distributor certificate tied to that TV's DUID to install on a retail set.
MSG
  exit 2
fi

echo "Packaging as $PROFILE..."
"$TIZEN" package -t wgt -s "$PROFILE" -- "$ROOT/dist" >/dev/null

WGT="$(find "$ROOT/dist" -maxdepth 1 -name '*.wgt' | head -1)"
[ -n "$WGT" ] || { echo "No .wgt produced."; exit 1; }
mkdir -p "$ROOT/build"
mv "$WGT" "$ROOT/build/SimpleIPTV.wgt"
echo "build/SimpleIPTV.wgt  ($(du -h "$ROOT/build/SimpleIPTV.wgt" | cut -f1))"
