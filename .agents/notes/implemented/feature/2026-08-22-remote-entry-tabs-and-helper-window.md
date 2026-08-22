# Agent Note: Remote connections on the main surface — sidebar entry, window tabs, helper window

Status: implemented

English | [中文](2026-08-22-remote-entry-tabs-and-helper-window.zh.md)

## Problem

SSH-tunnel remote devices shipped with exactly one surface: the Settings → Plugins Remote card. Reaching a configured device meant opening Settings, finding the card, connecting, then choosing between a browser tab (which leaves the app) and an in-place navigation (which evicts the local session from the window). A user who drives a remote dsh daily needs the connect-and-open path on the main window, and needs both open gestures to stay inside the app: a tab in this window, or a second app window that owns up to being remote in the Dock and the titlebar.

## Decision

A new package, `packages/client/ui-remote`, occupies the sidebar-owned `sidebar.footer.action` list slot with a "Remote" trigger beside Settings. Its modal lists the `remote` RPC domain's roster with live phases, runs `remote.connect`/`remote.disconnect` immediately, and extends the `remote` settings section through an add-device form (label, ssh target, ports, auto-connect) — the staged multi-field editor stays in Settings. One bootstrap `remote.list` poll at controller construction feeds a status dot on the trigger (so Host-auto-connected tunnels show without opening anything); the continuous 2s poll runs only while the modal is open, the one surface that watches phases change. The roster write extends the *stored* devices list rather than the polled view, so a configured device whose tunnel the Host has not built yet can never be dropped by re-adding from the RPC answer.

**Open in tab** stages the tunneled UI as a window tab: `ui-layout` owns a tab strip above the columns that appears while any remote tab exists, and switching swaps a per-device iframe (keyed `id@url`) in for the local frame. The local frame stays mounted and hidden, so an in-flight conversation survives tab hops, and every staged remote keeps running; a reconnect that moves the tunnel port remounts only that tab. `ctx.layout` gains `openRemoteTab`/`activateRemoteTab`/`showLocalTab`/`closeRemoteTab`; the strip is transient like the rest of the layout store.

**Open in new window** opens the tunnel URL in a new browsing context with the device label riding the `dshRemoteLabel` query parameter. A plain browser ignores the parameter and opens a tab. The macOS shell's UIDelegate routes any URL carrying that parameter to a bundled helper app (`Contents/Helpers/DeepSeek Harness Remote.app`, own bundle id `com.deepseek.harness.desktop.remote` — one process, one Dock icon, named "DeepSeek Harness 远程") instead of the default browser. The helper hosts the URL in a WKWebView window titled "DeepSeek Harness" with the machine name as `NSWindow.subtitle`; a second spawn forwards its URL to the running instance over a distributed notification and exits, and closing the window quits the helper. Shared shell code (console mirror, downloads, menu builders, the routing enum) moved into `scripts/macos-app/shared.swift`, linked by both entry files.

## Alternatives considered

**Electron-style multi-window in one process.** Rejected: macOS gives one Dock icon per process, so a titled, separately-distinguishable remote window requires a second bundle — the helper-app split is the native answer, not a workaround.

**Replace the local UI in place, with a back affordance.** Rejected by the user's requirement and by state: an in-place navigation kills the local session's page state, while a hidden mounted frame plus iframes preserves both sides for free.

**Tabs owned by the remote package itself.** Rejected: only the layout frame can swap the whole column area while keeping the local tree mounted; a feature-owned overlay could not. The tab strip is frame chrome, so `ui-layout` owns it and `ui-remote` is a consumer of the service face.

**Persisting remote tabs across reload.** Deferred: the layout store persists nothing today, and a stale tunnel URL on the next launch would restore a dead tab more often than a live one.

## Consequences

The connect-and-open path is one click from every window state, and the two gestures now mean what the labels say inside the macOS app. The same-window tab leans on the webserver having no frame-blocking headers — a deployment that adds `X-Frame-Options`/CSP frame rules must revisit it. The helper is a second Swift target in the build script and a second console log (`DeepSeekHarnessRemote-web.log`); both share `shared.swift`, so shell behavior fixes land once. The settings card and the sidebar entry both poll `remote.list`, but never at the same time for the same surface state — the entry polls only while its modal is open.

## Testing

`ui-remote` unit specs cover the helpers (label fallback, id minting, port parsing), the controller (bootstrap and modal-scoped polling, verb busy tracking, both open gestures with the label param, add-device validation/write/connect and its failures, disposal), the component (wide/rail trigger, fleet dot, row actions, the add form), and the apply wiring with teardown. `ui-layout` specs cover the store actions and the frame's tab strip rendering. The macOS helper's routing and single-instance forwarding are exercised by a manual smoke: connect a device, open it both ways, click the gesture twice, close the helper window.
