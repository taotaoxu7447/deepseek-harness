# @deepseek-ai/dsh-remote-tunnels

English | [中文](README.zh.md)

SSH local-forward tunnels from this host to DeepSeek Harness instances on other machines, exposed as the `ctx.remoteTunnels` service and surfaced by the **Settings → Plugins → Remote** card. Each configured device owns one lifecycle: `ssh -N -L <localPort>:127.0.0.1:<remotePort> <sshTarget>` kept alive while the device is wanted, probed over HTTP until the remote web UI answers, then served with its `url` — `http://127.0.0.1:<localPort>/` — which any browser (or the macOS app window) can open for the remote interface in full fidelity: the remote Host serves its own UI and every session event, and composing a message there executes on the remote host's agent loop.

Authentication never passes through this package. The child runs with `BatchMode=yes`, so every login is non-interactive and the user's own ssh configuration (host alias, user, port, key, agent) carries it; the harness reads no key and the subprocess seam's environment scrub keeps harness credentials out of the child. The remote Host binds loopback and trusts its loopback, which is exactly why forwarding a local port into it is the intended — and only safe — transport. One prerequisite sits outside dsh: ssh to the target once in a terminal so its host key is trusted in `known_hosts`; under BatchMode an unconfirmed host key is an immediate failure, not a prompt.

## Config

The composition entry seeds the roster and the optional `remote` settings section — what the Remote card writes — overrides it live: a committed change takes effect without a restart (connection-relevant edits restart that device's tunnel, removals terminate it, label-only edits never touch a live process). With no devices the service idles. Activation fails loud when no `ssh` client is on `PATH`.

| Key | Default | Meaning |
|---|---|---|
| `devices` | `[]` | The device roster, in display order. |
| `reconnectInitialMs` | `1000` | First delay before respawning a dropped tunnel process; doubles per drop. |
| `reconnectMaxMs` | `30000` | Cap on the reconnect backoff; must not be below `reconnectInitialMs`. |
| `probeIntervalMs` | `1000` | Delay between two readiness probes of one connecting tunnel. |
| `probeTimeoutMs` | `4000` | HTTP budget of one readiness probe. |
| `terminateGraceMs` | `3000` | SIGTERM grace before the subprocess seam escalates to SIGKILL. |

Per-device keys (each `devices` entry):

| Key | Default | Meaning |
|---|---|---|
| `id` | (required) | Stable, unique id naming the device in errors and RPC calls. |
| `label` | (unset) | Display name; the card falls back to `id`. |
| `sshTarget` | (required) | ssh destination — a `~/.ssh/config` alias or `user@host`; host, port, user, and key all live in ssh configuration. |
| `remotePort` | `3080` | Web port the remote dsh listens on. |
| `localPort` | auto | Loopback port the tunnel binds here; unset devices take consecutive slots from `13389`, skipping every explicitly claimed port. |
| `autoConnect` | `false` | True connects the tunnel as soon as its roster entry appears. |

```yaml
- id: remote-tunnels
  name: '@deepseek-ai/dsh-remote-tunnels'
  config:
    devices:
      - id: work
        label: Work machine
        sshTarget: work          # ~/.ssh/config Host alias
        remotePort: 3080
        autoConnect: true
```

Duplicate ids, empty ids or targets, duplicate explicit `localPort`s, and a `reconnectMaxMs` below `reconnectInitialMs` fail the settings write (the card keeps the drafts) or the composition load — never a silent clamp.

## Lifecycle

`disconnected → connecting → ready → failed(detail)`. `connect(id)` spawns the forward and returns the now-`connecting` view; readiness is observed through `list()`. A probe loop GETs `/` on the loopback port until it answers 2xx, at which point the device turns `ready` and its view carries `url`. While the device is wanted, an unexpected process exit respawns after a doubling backoff (1s → 30s by default) — so a remote host that is down keeps retrying cheaply. Exits whose stderr names an unfixable condition — authentication denied, host-key verification, an unresolvable hostname, a rejected forwarding specification, a local port already bound — turn the device `failed` immediately with a readable reason and never retry: repeating the same spawn cannot fix them. `disconnect(id)` terminates the process tree and awaits its exit before resolving, so the loopback port is free when the view reads `disconnected`. Unloading the plugin terminates every live tunnel the same way.

Every detail line is clipped and free of credential material — BatchMode children neither see nor echo secrets.

## Model Experience

None, as the tunnels below the Settings Remote card move no session content and register nothing model-facing; the agent's model traffic stays local to whichever host runs its loop.

#### KV Cache effect

None — tunnel processes are plain ssh clients and never touch a model request.

## Known Limitations and Deferred Work

- **State is read, not pushed** — the card polls `remote.list()`; there is no event stream, so a background phase change appears on the next poll rather than immediately.
- **One forward per device, owned here** — a port another tool already forwarded is reported `failed` (never adopted), and two dsh hosts serving the same port need distinct `localPort`s.
- **BatchMode or nothing** — password prompts and interactive host-key confirmations fail by design; key-based login and a prior terminal `ssh` for `known_hosts` trust are prerequisites, documented above rather than bypassed.
- **No remote version skew checks** — the tunneled UI is whatever the remote host serves (always its own current build), which is the point; mismatched fork features across the two hosts are not diagnosed.
