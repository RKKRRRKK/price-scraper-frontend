#!/usr/bin/env bash
# Finds the Watch S5 auth key in Mi Fitness's logs over adb (no root needed) and
# writes it to watch-lab/.env (WATCH_AUTH_KEY) and health-bridge/health.properties
# (watch.authKey). Also tries the phone's Bluetooth bond list for the watch's address.
# Never prints a key in full: only its first 4 hex chars. Every candidate, newest
# last, goes to out/key-candidates.txt (gitignored) in case the newest one fails auth.
#
# Usage (Git Bash, phone plugged in with USB debugging): scripts/get_auth_key.sh
set -euo pipefail

ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
LAB="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$LAB/.env"
PROPS="$LAB/../health-bridge/health.properties"
LOGDIR=/sdcard/Android/data/com.xiaomi.wearable/files/log

[ "$("$ADB" get-state 2>/dev/null || true)" = device ] || { echo "No phone over adb: plug it in and allow USB debugging."; exit 1; }

# Oldest log first, so the last match overall is the newest key.
files=$("$ADB" shell "ls -tr $LOGDIR 2>/dev/null" | tr -d '\r')
[ -n "$files" ] || { echo "No Mi Fitness logs in $LOGDIR (open Mi Fitness and let it sync once, then retry)."; exit 1; }

mkdir -p "$LAB/out"
cand="$LAB/out/key-candidates.txt"
: > "$cand"
for f in $files; do
  "$ADB" shell "grep -Eo '(encryptKey|authKey|huamiAuthKey|token)[\":= ]+[[:xdigit:]]{32}' '$LOGDIR/$f' 2>/dev/null" \
    | tr -d '\r' \
    | sed -nE "s/^([A-Za-z]+)[^0-9A-Fa-f]+([0-9A-Fa-f]{32})\$/\1 \2 $f/p" >> "$cand" || true
done

# Prefer the explicit key fields; "token" also matches unrelated values.
pick=$(grep -E '^(encryptKey|authKey|huamiAuthKey) ' "$cand" | tail -1 | cut -d' ' -f2 || true)
[ -n "$pick" ] || pick=$(tail -1 "$cand" | cut -d' ' -f2 || true)
if [ -z "$pick" ]; then
  echo "No key in the Mi Fitness logs. Toggle the phone's Bluetooth off and on so Mi Fitness reconnects, wait a minute, retry."
  exit 1
fi
key=$(printf '%s' "$pick" | tr 'A-F' 'a-f')

echo "Candidates (newest last; first 4 chars only):"
awk '{ printf "  %-13s %s…  %s\n", $1, substr(tolower($2), 1, 4), $3 }' "$cand" | uniq | tail -8
echo "Using ${key:0:4}…"

set_line() {  # file, key name, value
  if grep -q "^$2=" "$1"; then sed -i "s|^$2=.*|$2=$3|" "$1"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}
set_line "$ENV_FILE" WATCH_AUTH_KEY "$key"
set_line "$PROPS" watch.authKey "$key"
echo "Wrote the key to watch-lab/.env and health-bridge/health.properties (both gitignored)."

# The watch's Bluetooth address from the phone's bond list (newer Android masks it; then use lab.py scan).
addr=$("$ADB" shell dumpsys bluetooth_manager 2>/dev/null | tr -d '\r' \
  | grep -iE '([0-9A-F]{2}:){5}[0-9A-F]{2}.*Xiaomi Watch S5' | grep -oiE '([0-9A-F]{2}:){5}[0-9A-F]{2}' | head -1 || true)
if [ -n "$addr" ]; then
  set_line "$ENV_FILE" WATCH_ADDRESS "$addr"
  echo "Watch address $addr written to watch-lab/.env."
else
  echo "Watch address not readable from the phone; lab.py scan will find it."
fi
