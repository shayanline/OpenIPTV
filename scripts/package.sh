#!/usr/bin/env bash
# Build the web app, then wrap dist/ as a signed Tizen widget.
#
# Vite copies public/ verbatim, so config.xml and icon.png land beside index.html and
# dist/ is already a complete widget root. The Tizen CLI signs in place.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The Samsung profile whose distributor certificate is bound to this TV's DUID. A generic
# Tizen distributor certificate signs cleanly but a retail set rejects it at install with
# "Check certificate error [118, -12]".
PROFILE="${SIGNING_PROFILE:-OpenIPTV}"

# Tizen Studio installs to different places depending on how it was set up, so look
# rather than assume, and say something useful when it is missing.
find_tizen() {
  [ -n "${TIZEN_CLI:-}" ] && [ -x "$TIZEN_CLI" ] && { echo "$TIZEN_CLI"; return; }
  for candidate in \
    "$HOME/tizen-studio/tools/ide/bin/tizen" \
    "$HOME/TizenStudio/tools/ide/bin/tizen" \
    "/Applications/tizen-studio/tools/ide/bin/tizen" \
    "$HOME/.tizen-extension-platform/server/sdktools/data/tools/ide/bin/tizen" \
    "$(command -v tizen 2>/dev/null || true)"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
}

echo "Building..."
npm --prefix "$ROOT" run build

# Stamp the widget with the release it was built from, so the number on the set and the number
# on the About screen cannot disagree. Only dist/ is touched.
VERSION="$(node -p "require('$ROOT/package.json').version")"
node "$ROOT/scripts/stamp-version.mjs" "$ROOT/dist/config.xml" "$VERSION"
echo "Version $VERSION"

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
# The output is kept rather than discarded. The Tizen CLI is known for printing signing and
# certificate problems and then exiting zero, so throwing stdout away meant a failure here
# surfaced as nothing but "No .wgt produced." with the actual reason gone.
PACKAGE_LOG="$(mktemp)"
trap 'rm -f "$PACKAGE_LOG"' EXIT
if ! "$TIZEN" package -t wgt -s "$PROFILE" -- "$ROOT/dist" >"$PACKAGE_LOG" 2>&1; then
  cat "$PACKAGE_LOG"
  echo "The Tizen CLI failed. If it mentions a profile, SIGNING_PROFILE is '$PROFILE'."
  exit 1
fi

# -print -quit rather than a pipe into head, which under `set -o pipefail` can exit 141 when
# head closes the pipe early.
WGT="$(find "$ROOT/dist" -maxdepth 1 -name '*.wgt' -print -quit)"
if [ -z "$WGT" ]; then
  cat "$PACKAGE_LOG"
  echo "No .wgt produced. The Tizen CLI exited cleanly, which it does even when signing fails."
  echo "SIGNING_PROFILE is '$PROFILE'. Check it exists in the Certificate Manager."
  exit 1
fi
mkdir -p "$ROOT/build"
mv "$WGT" "$ROOT/build/OpenIPTV.wgt"
echo "build/OpenIPTV.wgt  ($(du -h "$ROOT/build/OpenIPTV.wgt" | cut -f1))"
