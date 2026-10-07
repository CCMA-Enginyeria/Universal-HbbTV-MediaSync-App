#!/bin/sh
# Collects Meta Quest screenshots for the Meta Horizon Store listing.
#
# The store needs exactly 5 real in-headset captures (VRC.Quest.Asset.5): take
# them on the headset (hold the Meta button and press the trigger, or run this
# script with --take while the app is in front), then pull them here and run
#   node store/meta-quest/build.cjs --only screenshots
#
# Usage: sh store/meta-quest/capture.sh [--take] [count]   (default count: 5)
#   --take   ask the headset to take one screenshot now, then pull it
set -eu
# Git Bash on Windows would rewrite the device paths below into Windows paths.
export MSYS_NO_PATHCONV=1

DIR=$(cd "$(dirname "$0")" && pwd)/captures
SRC=/sdcard/Oculus/Screenshots
mkdir -p "$DIR"

if [ "${1:-}" = "--take" ]; then
    shift
    adb shell am startservice -n com.oculus.metacam/.capture.CaptureService -a TAKE_SCREENSHOT >/dev/null
    sleep 3
    COUNT=${1:-1}
else
    COUNT=${1:-5}
fi

# Newest first; the store build sorts the files by name, so keep the
# timestamped names the headset gives them.
adb shell ls -t "$SRC" | tr -d '\r' | grep -iE '\.(png|jpe?g)$' | head -n "$COUNT" | while read -r f; do
    adb pull "$SRC/$f" "$DIR/$f" >/dev/null
    echo "captures/$f"
done
