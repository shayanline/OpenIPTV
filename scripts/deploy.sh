#!/usr/bin/env bash
# Install the widget on the TV over sdb, then launch it.
#
# Needs TV_IP, developer mode enabled on the TV with this machine's address entered,
# and a Samsung distributor certificate issued against the TV's DUID. The generic Tizen
# distributor certificate signs fine but a retail set refuses it with error 118012.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_ID="5mzc7dQsGK.OpenIPTV"

# The toolchain lives in one of two places: a full Tizen Studio install, or the smaller
# set the VS Code extension unpacks. Take whichever is present.
for base in "$HOME/tizen-studio/tools" \
            "$HOME/.tizen-extension-platform/server/sdktools/data/tools"; do
  [ -x "$base/sdb" ] && TOOLS="$base" && break
done
SDB="${SDB:-${TOOLS:-}/sdb}"
TIZEN="${TIZEN_CLI:-${TOOLS:-}/ide/bin/tizen}"
[ -x "$SDB" ] || { echo "No sdb found. Install Tizen Studio, or set SDB."; exit 1; }
# Checked as well, and not only sdb. The VS Code extension does not always unpack the CLI,
# and without this the script dies at the install line with a bare "command not found".
[ -x "$TIZEN" ] || { echo "No Tizen CLI at '$TIZEN'. Install Tizen Studio, or set TIZEN_CLI."; exit 1; }

# Without TV_IP, use a TV that is already paired. `|| true` so that sdb failing here reaches
# the message below rather than tripping `set -e` inside the assignment.
PAIRED="$("$SDB" devices 2>/dev/null | awk 'NR>1 {split($1,a,":"); print a[1]; exit}' || true)"
TV_IP="${TV_IP:-$PAIRED}"
[ -n "$TV_IP" ] || { echo "Set TV_IP, for example TV_IP=192.168.1.100 ./scripts/deploy.sh"; exit 1; }

# Always rebuild. This used to reuse whatever .wgt happened to be in build/, so editing the
# app and running deploy installed last week's widget and then reported success. A deploy
# that can silently ship something other than the working tree is worse than a slow one.
"$ROOT/scripts/package.sh"

echo "Connecting to $TV_IP..."
"$SDB" connect "$TV_IP:26101" >/dev/null || true

# -F so the dots in an address are dots rather than any character, and the trailing colon so
# that 192.168.1.10 does not match 192.168.1.100.
"$SDB" devices | grep -qF "$TV_IP:" || {
  echo "No device at $TV_IP. The TV must be in developer mode with this machine's IP set,"
  echo "and restarted afterwards, before port 26101 opens."
  exit 1
}

# The two tools disagree about what names a device: the Tizen CLI wants the model name in
# the third column, sdb wants the host:port in the first. Both are read from the line for
# the TV that was actually asked for. Taking the first line unconditionally meant that with
# two sets paired you installed to whichever sdb happened to list first.
LINE="$("$SDB" devices | grep -F "$TV_IP:" | head -1)"
SERIAL="$(printf '%s\n' "$LINE" | awk '{print $1}')"
# The remainder of the line after the state column, so a model name containing a space
# survives. $3 alone truncated it.
NAME="$(printf '%s\n' "$LINE" | awk '{ $1=""; $2=""; sub(/^[ \t]+/, ""); print }')"

"$TIZEN" install -n "$ROOT/build/OpenIPTV.wgt" -t "$NAME"

# Launching is allowed to fail, and when it does the script says so rather than claiming
# success on the next line.
if "$SDB" -s "$SERIAL" shell 0 was_execute "$APP_ID"; then
  echo "Installed and launched $APP_ID"
else
  echo "Installed $APP_ID, but it did not launch. Start it from the TV's app list."
  exit 1
fi
