# Agent Note: Remote devices over SSH tunnels

Status: implemented

English | [中文](2026-08-21-remote-devices-ssh-tunnels.zh.md)

## Problem

A user runs dsh on several machines — a workstation, a VPS — and wants to drive a remote dsh from the local window. The Host binds loopback only and carries no inbound authentication by design (loopback is the trust boundary), so exposing its port directly would be unsafe. Rebuilding a remote session view inside the local UI would duplicate the entire interface against a second event source.

## Decision

The remote Host serves its own UI, so the feature forwards a port instead of re-implementing a screen: `ssh -L <localPort>:127.0.0.1:<remotePort>` makes the remote loopback UI reachable locally with pixel-perfect fidelity, the full event stream, and writes that execute on the remote machine. Authentication lives entirely in the user's ssh config and keys; the feature never touches credential material, spawns ssh with `BatchMode=yes` so a password prompt can never appear, and fails loud with a readable reason when the target, key, or port is wrong.

[`packages/remote/remote-tunnels`](../../../../packages/remote/remote-tunnels/README.md) owns the lifecycle. The `remoteTunnels` cordis service installs a `remote` settings section whose `devices` roster names each device's id, ssh target, ports, and `autoConnect`; edits reconcile live — a changed ssh target restarts its tunnel, a removed device terminates one. Each device's tunnel is one lifecycle controller running `disconnected → connecting → ready → failed(detail)`: spawn, probe the forwarded loopback port until it answers a 2xx, then supervise. Fatal stderr patterns (authentication, host-key, unresolvable name, forward refused) land in `failed` without retry; a transient exit under a desired connection retries on an exponential backoff (1s initial, 30s cap, both configurable). `disconnect` terminates the process tree and resolves only after the port is free. Explicit local ports must be unique; omitted ones are assigned from 13389 in roster order.

The apiproxy `remote` domain exposes `remote.list` / `remote.connect` / `remote.disconnect` with a browser-safe `RemoteDeviceView`; `url` is present only while a device is `ready`. A composition without the tunnel service answers an empty roster and a named `remote-tunnel-failed` error, matching the vision domain's absent-provider precedent. The base bundle composes the service dormant: with no `remote` section it idles.

The Web Plugins settings page gains a Remote card (`packages/client/ui-settings-plugins`) that stages the whole roster and writes it on Save, exactly like the Vision chain editor, while connect/disconnect act immediately. Tunnel state reaches the card by polling `remote.list` every two seconds while the card is open — this surface has no push channel and the card is the only consumer. A ready row offers its tunneled UI two ways: a new browser tab, and an in-place navigation for the single-window flow inside the macOS shell.

The macOS shell closes the loop: View → Show Local (⌘0) loads the local Host again after the window navigated to a remote UI, and a KVO observation on the web view's URL titles the window `DeepSeek Harness — <host:port>` whenever the origin is not the local one. Its UIDelegate routes `target=_blank` navigations (the card's new-tab link) to the default browser — WKWebView drops them otherwise — and a page-side hook mirrors console errors and unhandled rejections to `~/Library/Logs/DeepSeekHarness-web.log`, so failures that only reproduce inside the shell leave evidence.

## Alternatives considered

**Bind the remote Host to 0.0.0.0 behind a token.** Rejected because the Host's loopback-is-trust design has no inbound auth layer to hang a token on; inventing one is a far larger security surface than an ssh forward, and the user already maintains ssh access to these machines.

**A client-side remote session view.** Rejected because rendering a second Host's event stream in the local UI duplicates the entire interface for worse fidelity; the remote Host already serves the pixel-perfect page, so forwarding its port is strictly less code for a perfect result.

**Reverse tunnels, VPN, or Tailscale.** Rejected as deployment weight the user does not need: every target machine is already reachable by the user's ssh config, and `-L` needs no new infrastructure.

**A push channel for tunnel state.** Deferred rather than rejected: tunnel phases change on a second scale and the settings card is the only consumer, so a two-second poll while the card is open is sufficient; a `remote/state-changed` event can replace the poll if a second consumer appears.

## Consequences

One new Host package, one thin RPC domain, one settings card, and two shell behaviors; zero credential handling anywhere in the feature — a leaked roster entry names a host alias, never a key. Remote version skew is a property rather than a risk: the remote UI is always the remote's own build. `BatchMode=yes` means password-only hosts fail loud instead of hanging; the README tells the user to ssh once in a terminal so the host key lands in known_hosts. The status pill can trail reality by up to one poll interval. One device occupies exactly one local port, and a port conflict fails the tunnel instead of stealing a sibling's.

## Testing

`packages/remote/remote-tunnels` pins the full state machine against a scripted subprocess fake: ready, refused, non-2xx, probe timeout, every fatal stderr class, spawn error, backoff doubling, clipped details, quiescent disconnect (including a wedged process), connect-during-backoff, settings-driven restart and removal, invalid-config fail-loud, and disposal teardown. The apiproxy specs cover delegation, error folding, the not-composed answer, and a fetch-carrier round-trip. The card's controller and render specs cover staging, saving, rejected writes, id-keyed tunnel projection, verb dispatch, navigation, and the poll lifecycle. The end-to-end path is a manual smoke: fill a real device, Connect, open the ready link, send an instruction in the remote UI, and ⌘0 back.
