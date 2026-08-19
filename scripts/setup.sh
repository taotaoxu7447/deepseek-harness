#!/usr/bin/env bash
# One-command checkout bootstrap: install dependencies, build, put `dsh` on PATH,
# install the Linux desktop shell when the GI bindings are present, and seed a
# credentials document without overwriting one that already exists.
#
#   git clone <this-repo> && cd deepseek-harness && ./scripts/setup.sh
#   ./scripts/setup.sh --update
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/bin:${HOME}/.local/bin:${PATH}"
UPDATE=0
for arg in "$@"; do
  case "$arg" in
    --update|-u) UPDATE=1 ;;
    --help|-h)
      cat <<'EOF'
Usage: scripts/setup.sh [--update]

Install this checkout so `dsh` and the desktop app use it.

  --update   git pull --ff-only, then rebuild and reinstall launchers
EOF
      exit 0
      ;;
    *)
      echo "setup.sh: unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "setup.sh: Node.js 22+ is required (https://nodejs.org/)" >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "→ installing pnpm 11.7.0"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@11.7.0 --activate
  elif command -v npm >/dev/null 2>&1; then
    npm install -g pnpm@11.7.0
    if ! command -v pnpm >/dev/null 2>&1; then
      PREFIX="$(npm prefix -g)"
      if [[ -x "${PREFIX}/bin/pnpm" ]]; then
        ln -sfn "${PREFIX}/bin/pnpm" "${HOME}/.local/bin/pnpm"
      fi
    fi
  else
    echo "setup.sh: cannot install pnpm (need corepack or npm)" >&2
    exit 1
  fi
fi

if (( UPDATE == 1 )); then
  if [[ -d "${ROOT}/.git" ]]; then
    echo "→ git pull --ff-only"
    git -C "$ROOT" pull --ff-only
  else
    echo "setup.sh: --update requires a git checkout" >&2
    exit 1
  fi
fi

echo "→ pnpm install"
cd "$ROOT"
pnpm install

echo "→ pnpm run build"
pnpm run build

mkdir -p "${HOME}/.local/bin" "${HOME}/bin" "${HOME}/.dsh" "${HOME}/.local/share/deepseek-harness"
install -m 755 "${ROOT}/scripts/linux-app/dsh" "${HOME}/.local/bin/dsh"
printf '%s\n' "$ROOT" > "${HOME}/.local/share/deepseek-harness/checkout.path"

CRED="${HOME}/.dsh/.credentials.yaml"
EXAMPLE="${ROOT}/deploy/credentials.example.yaml"
if [[ ! -f "$CRED" ]]; then
  install -m 600 "$EXAMPLE" "$CRED"
  echo "→ wrote ${CRED} (fill DEEPSEEK_API_KEY and DEEPSEEK_PLN_API_KEY)"
else
  echo "→ keeping existing ${CRED}"
fi

if [[ "$(uname -s)" == Linux ]]; then
  if "${ROOT}/scripts/linux-app/build.sh"; then
    echo "→ desktop launcher installed"
  else
    echo "setup.sh: desktop shell not installed; \`dsh web\` still works. On Ubuntu 24.04:" >&2
    echo "  sudo apt install python3-gi python3-gi-cairo python3-pil gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 gir1.2-gdkpixbuf-2.0" >&2
  fi
fi

echo
echo "Ready. From any directory:"
echo "  dsh web          # Web UI at http://127.0.0.1:3080"
echo "  dsh app          # native desktop window (Linux)"
echo "  dsh --help"
echo
echo "Later:  git pull && ./scripts/setup.sh --update"
echo "Keys:   ${CRED}"
