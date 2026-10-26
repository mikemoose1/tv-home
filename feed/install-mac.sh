#!/bin/bash
# Installs the tv-home calendar feed as a per-user launchd agent on macOS.
set -e
D="$(cd "$(dirname "$0")" && pwd)"
NODE="${NODE:-$(command -v node || echo /Users/$USER/.local/bin/node)}"
LABEL=com.tvhome.feed
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
cd "$D"
[ -f skylight.env ] || { echo "missing $D/skylight.env (SKYLIGHT_EMAIL=..., SKYLIGHT_PASSWORD=...)"; exit 1; }
chmod 600 skylight.env
PATH="$(dirname "$NODE"):$PATH" npm install --omit=dev --no-audit --no-fund --loglevel=error
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-c</string><string>set -a; . ./skylight.env; set +a; exec "$NODE" ./feed-server.mjs</string></array>
  <key>WorkingDirectory</key><string>$D</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$D/feed.log</string>
  <key>StandardErrorPath</key><string>$D/feed.log</string>
  <key>EnvironmentVariables</key><dict><key>HOME</key><string>$HOME</string></dict>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "installed $PLIST"
