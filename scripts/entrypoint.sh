#!/bin/sh
set -eu
mkdir -p "${DATA_DIR:-/data}/pi" "${DATA_DIR:-/data}/artifacts"
Xvfb "${DISPLAY:-:99}" -screen 0 1366x768x24 -nolisten tcp &
display_pid=$!
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if xdotool getdisplaygeometry >/dev/null 2>&1; then break; fi
  kill -0 "$display_pid" 2>/dev/null || exit 1
  sleep 0.2
done
xdotool getdisplaygeometry >/dev/null
exec "$@"
