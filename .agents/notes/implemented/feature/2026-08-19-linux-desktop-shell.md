# Agent Note: Linux desktop shell

Status: implemented

English | [中文](2026-08-19-linux-desktop-shell.zh.md)

## Problem

The repository ships a native macOS WKWebView shell in [`scripts/macos-app`](../../../../scripts/macos-app/main.swift) that owns a Dock icon, loads the loopback Web UI, starts the backend when the health check fails, and saves attachments into `~/Downloads`. Ubuntu and other Linux desktops have only a browser tab: no application-grid icon, no Freedesktop launcher, and no matching auto-start or download handoff.

## Decision

[`scripts/linux-app`](../../../../scripts/linux-app/README.md) is a GTK 4 + libadwaita + WebKitGTK 6 shell over `http://127.0.0.1:3080/`. `scripts/linux-app/build.sh` installs a user desktop entry `com.deepseek.harness.desktop`, hicolor icons, `~/.local/bin/deepseek-harness`, `~/.local/bin/dsh`, and `~/bin/dsh-serve`. The application id is `com.deepseek.harness` so the desktop filename does not become `*.desktop.desktop`; the macOS bundle id remains `com.deepseek.harness.desktop`. The terminal `dsh` wrapper execs this checkout's CLI (`apps/cli/lib/bin.js`, or the TypeScript entry through tsx) without changing the invoking directory, so `dsh web` and `dsh --profile headless` from any folder use the fork's vision chain and custom-model effort UI with that folder as the default workspace.

The shell health-checks the loopback URL, then runs `dsh-serve` in a new session when it is down. `dsh-serve` takes an exclusive lock at `~/.dsh/serve.lock`, starts `DSH_SERVE_CMD`, else `pnpm dsh web` in a built checkout (`DSH_CHECKOUT` or the installed `checkout.path`), else `dsh web`, else `npx --yes @deepseek-ai/dsh web`, waits until the loopback URL answers, and never attaches the server to the GTK process group. The checkout path is required for this fork's vision chain and custom-model reasoning-effort UI, which the published npm package does not ship. Closing the window or Ctrl+Q quits only the shell. Ctrl+R / F5 reloads. Unrenderable MIME types and `Content-Disposition: attachment` responses write into `~/Downloads` with the same uniquified names as the macOS shell and reveal the file through `org.freedesktop.FileManager1`. Website data persists under `~/.local/share/deepseek-harness/webkit`. A GNOME launch prepends `~/bin` and `~/.local/bin` because those directories are absent from a desktop `PATH`. The process sets `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS` so WebKitGTK does not launch bubblewrap: the webview loads only the loopback UI, and the sandbox fails when unprivileged user namespaces are unavailable.

## Alternatives considered

**Electron or Tauri.** Rejected because the macOS shell is a thin native WebView and a second JavaScript runtime would add a large dependency the Ubuntu desktop already satisfies with WebKitGTK.

**Qt WebEngine.** Rejected because Ubuntu 24.04 GNOME already ships GTK 4, libadwaita, and WebKitGTK 6; Qt would be an extra toolkit for the same WebView job.

**GTK 3 and WebKit2GTK.** Rejected because Ubuntu 24.04's native GNOME stack is GTK 4 / WebKit 6, and libadwaita follows that stack.

**A browser bookmark or installed PWA.** Rejected because a PWA does not start `dsh web`, does not own a Freedesktop application id, and cannot apply the Downloads uniquify-and-reveal rule.

**Hide-on-close plus a tray icon.** Rejected because Ubuntu 24.04 GNOME has no default tray; a hidden process without a window is not discoverable. Quitting the shell and relaunching against the still-running backend is the restore path.

## Consequences

Ubuntu 24.04 GNOME can install and launch a native window over the same loopback Web UI the browser already uses. The backend outlives the window, matching the macOS lifetime rule. The shell requires the GI bindings listed in the [Linux desktop shell README](../../../../scripts/linux-app/README.md); a headless host can still run `python3 -m unittest scripts/linux-app/test_helpers.py` because those tests import no GTK. The Linux application id is not the macOS bundle id. `dsh-serve` daemonizes with `setsid`, so a crash or quit of the shell does not stop in-flight sessions. Disabling the WebKitGTK sandbox means renderer compromise would share the user's privileges; that is accepted because the loaded origin is the local Web UI, not arbitrary websites.

## Testing

`scripts/linux-app/test_helpers.py` pins basename sanitizing, download uniquify, `PATH` prefixing, and command resolution. `scripts/linux-app/make-icon.py` and `build.sh` are exercised by generating the 1024px marks and installing the desktop entry. The GTK window is verified on a display session by launching `deepseek-harness` and loading the loopback UI; CI without a desktop session does not run that window.
