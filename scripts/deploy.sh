#!/usr/bin/env bash
# Install the widget on the TV over sdb, then launch it.
#
# Needs TV_IP, developer mode enabled on the TV with this machine's address entered,
# and a Samsung distributor certificate issued against the TV's DUID. The generic Tizen
# distributor certificate signs fine but a retail set refuses it with error 118012.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SDB="${SDB:-$HOME/tizen-studio/tools/sdb}"
TIZEN="${TIZEN_CLI:-$HOME/tizen-studio/tools/ide/bin/tizen}"
TV_IP="${TV_IP:-}"
APP_ID="qQHcuw4fHz.SimpleIPTV"

[ -n "$TV_IP" ] || { echo "Set TV_IP, for example TV_IP=192.168.0.107 ./scripts/deploy.sh"; exit 1; }
[ -f "$ROOT/build/SimpleIPTV.wgt" ] || "$ROOT/scripts/package.sh"

echo "Connecting to $TV_IP..."
"$SDB" connect "$TV_IP:26101" >/dev/null || true
"$SDB" devices | grep -q "$TV_IP" || {
  echo "No device. The TV must be in developer mode with this machine's IP set, and"
  echo "restarted afterwards, before port 26101 opens."
  exit 1
}

TARGET="$("$SDB" devices | awk 'NR>1 {print $1; exit}')"
"$TIZEN" install -n "$ROOT/build/SimpleIPTV.wgt" -t "$TARGET"
"$SDB" -s "$TARGET" shell 0 was_execute "$APP_ID" || true
echo "Installed and launched $APP_ID"
