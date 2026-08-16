#!/bin/zsh
# Build and install the DeepSeek Harness macOS app: compiles the WKWebView
# shell, generates the icon, assembles the bundle, and copies it to
# /Applications (falling back to ~/Applications without write access).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="DeepSeek Harness"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

APP="$STAGE/$NAME.app"
RES="$APP/Contents/Resources"
MAC="$APP/Contents/MacOS"
mkdir -p "$RES" "$MAC"

echo "→ compiling shell"
swiftc -O -o "$MAC/DeepSeekHarness" "$HERE/main.swift"

echo "→ generating icon"
ICONSET="$STAGE/AppIcon.iconset"
mkdir -p "$ICONSET"
python3 "$HERE/make-icon.py" "$STAGE/icon-1024.png"
for size in 16 32 64 128 256 512; do
  cp "$STAGE/icon-1024.png" "$ICONSET/icon_${size}x${size}.png"
  cp "$STAGE/icon-1024.png" "$ICONSET/icon_${size}x${size}@2x.png"
done
cp "$STAGE/icon-1024.png" "$ICONSET/icon_512x512@2x.png"
iconutil -c icns -o "$RES/AppIcon.icns" "$ICONSET"

echo "→ assembling bundle"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>DeepSeek Harness</string>
  <key>CFBundleDisplayName</key><string>DeepSeek Harness</string>
  <key>CFBundleExecutable</key><string>DeepSeekHarness</string>
  <key>CFBundleIdentifier</key><string>com.deepseek.harness.desktop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
</dict>
</plist>
PLIST

echo "→ installing"
DEST="/Applications"
if ! cp -R "$APP" "$DEST/" 2>/dev/null; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
  cp -R "$APP" "$DEST/"
fi
echo "installed: $DEST/$NAME.app"
