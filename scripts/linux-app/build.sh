#!/usr/bin/env bash
# Build and install the DeepSeek Harness Linux app: generate icons, install the
# GTK 4 / WebKitGTK shell, desktop entry, launcher, and ~/bin/dsh-serve.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NAME="DeepSeek Harness"
APP_ID="com.deepseek.harness"
SHARE="${XDG_DATA_HOME:-$HOME/.local/share}"
APPDIR="$SHARE/deepseek-harness"
ICON_THEME="$SHARE/icons/hicolor"
BIN="$HOME/.local/bin"
SERVE_BIN="$HOME/bin"

echo "→ checking desktop dependencies"
if ! python3 -c 'import gi; from PIL import Image, ImageDraw'; then
  echo "missing Python packages. On Ubuntu 24.04:" >&2
  echo "  sudo apt install python3-gi python3-gi-cairo python3-pil gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 gir1.2-gdkpixbuf-2.0" >&2
  exit 1
fi
if ! python3 - <<'PY'
import gi
gi.require_version("Adw", "1")
gi.require_version("Gtk", "4.0")
gi.require_version("WebKit", "6.0")
gi.require_version("GdkPixbuf", "2.0")
from gi.repository import Adw, Gtk, WebKit, GdkPixbuf
PY
then
  echo "missing GTK 4 / WebKitGTK 6 / libadwaita / GdkPixbuf GI bindings. On Ubuntu 24.04:" >&2
  echo "  sudo apt install python3-gi python3-gi-cairo python3-pil gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 gir1.2-gdkpixbuf-2.0" >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

echo "→ generating icons"
python3 "$HERE/make-icon.py" --appearance light "$STAGE/AppIconLight.png"
python3 "$HERE/make-icon.py" --appearance dark "$STAGE/AppIconDark.png"

echo "→ installing launcher files"
mkdir -p "$APPDIR/icons" "$BIN" "$SERVE_BIN" "$SHARE/applications"
install -m 644 "$HERE/helpers.py" "$APPDIR/helpers.py"
install -m 644 "$HERE/main.py" "$APPDIR/main.py"
install -m 644 "$HERE/make-icon.py" "$APPDIR/make-icon.py"
install -m 755 "$HERE/dsh-serve" "$APPDIR/dsh-serve"
install -m 755 "$HERE/dsh-serve" "$SERVE_BIN/dsh-serve"
# Point the installed helper at this checkout so it starts fork plugins
# (vision, custom-model effort) instead of the published npm package.
(cd "$HERE/../.." && pwd) > "$APPDIR/checkout.path"
cp "$APPDIR/checkout.path" "$SERVE_BIN/checkout.path"
install -m 755 "$HERE/dsh" "$BIN/dsh"
install -m 644 "$STAGE/AppIconLight.png" "$APPDIR/icons/AppIconLight.png"
install -m 644 "$STAGE/AppIconDark.png" "$APPDIR/icons/AppIconDark.png"

python3 - "$STAGE/AppIconLight.png" "$ICON_THEME" "$APP_ID" <<'PY'
import sys
from pathlib import Path
from PIL import Image

source = Path(sys.argv[1])
theme = Path(sys.argv[2])
app_id = sys.argv[3]
with Image.open(source) as image:
    for size in (16, 32, 48, 128, 256, 512):
        dest_dir = theme / f"{size}x{size}" / "apps"
        dest_dir.mkdir(parents=True, exist_ok=True)
        resized = image.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(dest_dir / f"{app_id}.png")
PY

cat > "$BIN/deepseek-harness" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PATH="\$HOME/bin:\$HOME/.local/bin:\$PATH"
export WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
exec /usr/bin/python3 "$APPDIR/main.py" "\$@"
EOF
chmod 755 "$BIN/deepseek-harness"

cat > "$SHARE/applications/${APP_ID}.desktop" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=${NAME}
Comment=DeepSeek Harness desktop shell
Exec=${BIN}/deepseek-harness
Icon=${APP_ID}
Terminal=false
Categories=Development;Utility;
Keywords=dsh;DeepSeek;AI;agent;
StartupNotify=true
StartupWMClass=${APP_ID}
X-GNOME-UsesNotifications=false
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$SHARE/applications" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -f "$ICON_THEME" >/dev/null 2>&1 || true
fi

echo "installed: $SHARE/applications/${APP_ID}.desktop"
echo "launcher:  $BIN/deepseek-harness"
echo "cli:       $BIN/dsh"
echo "server:    $SERVE_BIN/dsh-serve"
echo "Open “${NAME}” from the app grid, or run: deepseek-harness"
echo "Terminal:  dsh --help   |   dsh web"
