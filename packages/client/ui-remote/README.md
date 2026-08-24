# @deepseek-ai/dsh-client-ui-remote

English | [中文](README.zh.md)

The remote-device entry on the main surface: a sidebar footer trigger beside Settings whose modal lists the `remote` RPC domain's roster with live tunnel phases, runs its connect/disconnect verbs, and opens a ready tunnel's UI two ways. The roster's staged editing stays in Settings → Plugins ([`dsh-client-ui-settings-plugins`](../ui-settings-plugins/README.md)); this package is the connect-and-open path so a configured device never requires a settings trip.

The trigger is an occupant of `sidebar.footer.action` and renders the same 42px row / 36px rail circle geometry as the other footer actions. A status dot appears on it while any tunnel is live — ready outranks connecting outranks failed — and disappears when every tunnel rests. One bootstrap `remote.list` poll at construction feeds that dot (tunnels the Host auto-connected at boot show without opening anything); the continuous 2s poll runs only while the modal is open, the one surface that watches phases change.

A ready row offers two open gestures. **Open in tab** stages the tunneled UI as a window tab through `ctx.layout.openRemoteTab`, so the local session and any number of remotes share one window and swap through the tab strip. **Open in new window** opens the tunnel URL in a new browsing context with the device label riding the `dshRemoteLabel` query parameter: a plain browser opens a tab and ignores the parameter, while the macOS shell routes such URLs into a separate app window titled with the remote machine's name.

The add-device form at the bottom of the modal extends the `remote` settings section in place: display name, SSH target (an alias already in `~/.ssh/config`), optional remote/local ports, and auto-connect. Validation is minimal and local — the target is required, ports must parse into 1–65535 — and a saved device connects immediately when it asked to auto-connect. The roster write extends the stored list rather than the polled view, so re-adding from the RPC answer can never drop a configured device whose tunnel the Host has not built yet.

Copy goes through the package's own `remoteEntry` locale namespace; styling uses tokens only.

## Model Experience

None, as this package renders Host-reported tunnel state for a human and touches no prompt, message, schema, stream, or tool result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **The same-window tab requires the loopback remote UI to allow framing** — the tab stages the remote page in an iframe, so a future deployment that adds `X-Frame-Options` or a frame-blocking CSP to the webserver must pair it with a different same-window answer.
- **The new-window gesture depends on the native shell's routing** — under a plain browser it is an ordinary `window.open` tab; only the macOS wrapper turns it into a titled app window with its own Dock icon.
