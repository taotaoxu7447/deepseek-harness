# Linux desktop shell

English | [中文](README.zh.md)

GTK 4 + libadwaita + WebKitGTK 6 window over the local Web UI at `http://127.0.0.1:3080/`. It is the Linux counterpart of [`scripts/macos-app`](../macos-app/main.swift): own launcher icon, auto-start of the web server, Downloads-folder attachment saving, and a shell that never stops the backend.

## Prerequisites

Ubuntu 24.04 or another desktop with:

```sh
sudo apt install python3-gi python3-gi-cairo python3-pil \
  gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 gir1.2-gdkpixbuf-2.0
```

Node.js 22+ and `pnpm` on `PATH` (or `~/.local/bin`). From a built checkout, `dsh-serve` runs `pnpm dsh web` so the window loads this repository's plugins (vision, custom-model effort). Without a checkout it falls back to `dsh` or `npx @deepseek-ai/dsh`.

## Install

From a fresh clone, run the checkout bootstrap (dependencies, build, `dsh` on `PATH`, desktop launcher, credentials seed):

```sh
./scripts/setup.sh
```

To install only the desktop launcher and `dsh` wrapper after the tree is already built:

```sh
scripts/linux-app/build.sh
```

Installs a user launcher (`~/.local/share/applications/com.deepseek.harness.desktop`), icons, `~/.local/bin/deepseek-harness`, `~/.local/bin/dsh`, and `~/bin/dsh-serve`. Open **DeepSeek Harness** from the GNOME app grid, or run `dsh web` / `dsh --help` in a terminal.

From this directory without installing:

```sh
python3 scripts/linux-app/main.py
```

## Behavior

- Loads `http://127.0.0.1:3080/` after a health check. If that fails, `~/bin/dsh-serve` (or the bundled copy) starts a new session: a built checkout at `DSH_CHECKOUT` or `checkout.path` runs `pnpm dsh web`; otherwise `dsh web` or `npx --yes @deepseek-ai/dsh web`. It polls for up to 90 seconds.
- Closing the window or Ctrl+Q quits the shell only. The web server keeps running; a later launch reuses it.
- Ctrl+R / F5 reloads. Unrenderable responses and attachment downloads land in `~/Downloads` with uniquified names and are revealed in the file manager.
- Website data persists under `~/.local/share/deepseek-harness/webkit`. Server logs append to `~/.dsh/serve.log`.
- `~/.local/bin/dsh` boots this checkout from any directory without changing the working directory (the invoking directory is the default workspace). `dsh web` is the terminal equivalent of the desktop shell's auto-start.
- `DSH_SERVE_CMD` overrides the command `dsh-serve` starts when the health check fails.
- The shell sets `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS` because the webview only loads the loopback UI and WebKitGTK's bubblewrap sandbox fails when unprivileged user namespaces are unavailable.

The decision record is the [Linux desktop shell Agent Note](../../.agents/notes/implemented/feature/2026-08-19-linux-desktop-shell.md).
