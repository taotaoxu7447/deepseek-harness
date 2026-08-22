# Agent Note: Server freshness check in the macOS shell

Status: implemented

English | [中文](2026-08-21-macos-shell-server-freshness.zh.md)

## Problem

The macOS shell is a dumb WKWebView over `http://127.0.0.1:3080/`, and its lifecycle policy reused any server answering 200 — forever. A rebuild landed in `lib/` but the long-running server process predated it, so every update appeared to "not reach" the app: the user kept being served the previous build's UI until they happened to kill the process by hand. The shell had no way to tell "a healthy server" apart from "the current build's server".

## Decision

The server now answers the staleness question itself. The `web-app` bundle plugin registers an exact supervisor route, `GET /__dsh_health`, returning `{startedAt, builtAt, stale}` in epoch milliseconds: the process start, the modification time of the complete-build record `.dsh-build/client-build-environment.json` (read per request, so a build landing mid-run is seen immediately), and `stale = builtAt > startedAt`. A checkout without the record answers `builtAt: null` and never reports stale. The route sits before the SPA fallback by the webserver's exact-match dispatch; a pre-endpoint build still answers 200 with HTML there, which JSON parsing rules out, and the root page's `__DSH_BOOT__` marker then fingerprints it as a legacy dsh (restart-offerable, timestamps unknown) rather than a foreign process on the port, which the shell never disturbs.

The shell probes that endpoint at launch and on every Dock reopen, with an ephemeral `URLSession` so a cached 200 can never mask a fresh build. When the payload is stale and the user has not already declined that exact `builtAt`, an app-modal alert names both timestamps and offers "Restart Server" / "Later"; declining snoozes until the next build changes the stamp. Restart SIGTERMs the port's listener (cordis teardown closes sessions and SSH tunnels cleanly), polls the port closed, escalates to SIGKILL only after the grace expires, respawns `~/bin/dsh-serve`, waits for the port to answer, and reloads the window to the local Host. Failure to stop or come back up surfaces its own alert with the manual recovery path.

## Alternatives considered

- **The shell stats repo files itself.** Rejected: the shell would need the checkout path and build layout, facts it deliberately does not own; the server already knows both, and computing `stale` server-side keeps the shell replaceable (a Linux shell, a launchd supervisor) with the same one-endpoint contract.
- **`bin.js` mtime as the stamp.** Rejected: incremental tsc/tsdown may not rewrite unchanged outputs, so a real rebuild can leave the launcher's mtime untouched; the build record is rewritten at the end of every complete build and already certifies the client artifacts.
- **Commit-hash comparison.** Rejected: dirty-tree rebuilds (the normal edit-build-try loop) keep the same HEAD, so hash equality would report "fresh" over a stale process; the actual question is temporal — does the disk build postdate the process?
- **Auto-restart without a prompt.** Rejected: restart interrupts running tasks, and the shell's existing contract is that quitting the window never stops the backend; the user picks the moment, and the alert says honestly that tasks are interrupted while session history survives.

## Consequences

Servers built before the endpoint exists are still caught: the boot-marker fingerprint makes them promptable with a timestamp-free message, so the cutover needs no manual kill. Installed deployments outside a checkout carry no build record and are never nagged. The prompt fires at launch and reopen only, at most once per build stamp per app run (once per run for a legacy server, whose stamp is unknowable). WKWebView page caching remains a separate, smaller staleness layer handled by ⌘R. Separately, `build.sh` now removes any previous bundle before copying: a merge-copy over a running app truncates the binary under the live process, and every later launch of that bundle crashes in arbitrary frames — the first cutover's crash reports pointed at innocent code for exactly this reason. A second optimizer hazard sits in the same build: whole-module dead-stripping removes classes the compiler sees no Swift use for, even when AppKit uses them at runtime — `ComposerDropBridgeView` vanished from the `-O` binary (folder drops fell through to the page's image-only path) until a self-keepalive read made it reachable; the remote helper reuses the same compiled sources, so one fix covers both.

## Testing

Unit: the `serverHealth` fold (newer/equal/older/missing build) and `lastBuildAt` against a staged record (mtime honored, absent root → null). Route: through a captured `webServer.register` — GET answers the payload, non-GET gets 405 with `allow: GET`, and disposing the fiber unregisters. Real composition: the browser-startup test's listening server answers `/__dsh_health` with a well-formed payload and rejects POST.
