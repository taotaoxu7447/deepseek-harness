# DeepSeek Harness

English | [中文](README.zh.md)

This repository is a working [fork](https://github.com/taotaoxu7447/deepseek-harness) of [DeepSeek AI](https://deepseek.com)'s open-source agent harness (`dsh`). The official product lives at [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness). This checkout tracks that upstream tree and adds the plugins this fork uses every day: a V4 Flash cluster monitor, an official-API balance capsule, SSH remotes, a vision sidecar for text-only routes, custom-model reasoning controls, and native desktop shells.

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

This is not an official DeepSeek release and does not speak for DeepSeek. The published npm package `@deepseek-ai/dsh` is the official product and does not include this fork's plugins.

![Main surface: TAO wordmark, Remote / Cluster monitor / Balance in the sidebar, V4 dock and ¥ balance on the composer](docs/assets/readme/overview.png)

## This checkout vs the official repository

Both trees share the same Web UI, plugin architecture, CLI, and agent loop. The official README stops at how to run that product. This checkout's extra surface is the set of plugins listed below.

| Area | Official repository | This checkout |
|---|---|---|
| Web UI, plugin architecture, CLI | Ships | Ships on the same upstream base |
| V4 Flash cluster monitor | Not present | Composer dock + sidebar toggle |
| Official API balance | Not present | Capsule next to the model picker |
| SSH remote devices | Not present | Settings roster, sidebar entry, macOS helper window |
| Vision on a text-only route | Not present | `view_image` sidecar chain |
| Custom-model reasoning, stream idle timeout, image input | YAML / catalog only | Models page + picker |
| Native desktop shell | Not present | macOS app + Linux GTK shell |
| One-command checkout bootstrap | Not present | `./scripts/setup.sh` + shipped PLN overlay |

## What this checkout adds

### Main surface

The sidebar brand row carries this checkout's wordmark and a chamfered `TAO` badge. Under it, three footer actions sit above Settings:

- **Remote** — connect to another machine's `dsh` over SSH.
- **Cluster monitor** — show or hide the V4 Flash dock above the composer.
- **Balance** — show or hide the official DeepSeek API balance capsule.

The composer keeps the official workspace / permission / model controls and adds the balance capsule immediately left of the model picker. A connected Remote device paints a status dot on that footer action.

### V4 Flash cluster monitor

![Expanded V4 Flash dock above the composer, with a Local Compute tag and connection state](docs/assets/readme/v4-monitor.png)

[`dsh-client-ui-v4-monitor`](packages/client/ui-v4-monitor/README.md) mounts a dock on `conversation.input.dock`. It is not bound to the session model: the sidebar button shows or hides it at any time.

When a Local V4 invite is stored under Settings → Plugins → Local compute monitor, the dock polls live slot state (idle / prefilling / decoding, context used, speculative decoding, last task). Without that invite the dock stays visible and reports that it is not connected. Details: the Host plugin [`dsh-remote-v4-monitor`](packages/remote/v4-monitor/README.md).

### Official API balance

[`dsh-client-ui-deepseek-balance`](packages/client/ui-deepseek-balance/README.md) reads the already-configured official DeepSeek key on the Host and renders the remaining credit as a capsule beside the model picker. The browser bundle never sees the key.

The capsule follows the official DeepSeek account, not a PLN or custom gateway. While shown, it refreshes through the Host RPC bridge every 60 seconds. The Host half is [`dsh-remote-deepseek-balance`](packages/remote/deepseek-balance/README.md).

### Remote machines over SSH

![Remote connections modal listing a connected Mac Mini with Open in tab, Open in new window, and Disconnect](docs/assets/readme/remote.png)

[`dsh-remote-tunnels`](packages/remote/remote-tunnels/README.md) keeps one `ssh -N -L` local-forward per configured device. Authentication stays in your `~/.ssh/config` (BatchMode, no password prompt, host key already trusted). A ready device is `http://127.0.0.1:<localPort>/` — the remote Host serves its own UI, and composing there runs on the remote agent loop.

[`dsh-client-ui-remote`](packages/client/ui-remote/README.md) is the connect-and-open path on the main surface, so a configured device does not require a Settings trip:

- **Open in tab** stages the tunneled UI in this window.
- **Open in new window** opens the tunnel URL in a new browsing context. A plain browser gets a tab; the macOS shell routes it into a titled helper window.

Add or edit the roster under Settings → Plugins → Remote devices. `autoConnect` brings a device up as soon as its row appears.

### Vision sidecar

![Settings → Plugins → Vision: priority chain with gpt-5.6-luna then mimo-v2.5, fallback after 2 failed attempts](docs/assets/readme/vision-chain.png)

Official DeepSeek chat-completions routes are text-only. This checkout adds a vision capability seam so a text-only main model can still reason about images:

1. A paste or drop on a text-only route is stored and logged as a `view_image` pointer (file name, size, `attachment_id`), not as an inline image block.
2. The main model calls [`view_image`](packages/vision/tool-vision/README.md) when it wants a description.
3. [`dsh-vision-qwen`](packages/vision/vision-qwen/README.md) runs a priority chain of OpenAI Chat, OpenAI Responses, or Anthropic backends. The first usable backend serves; a backend that exhausts its attempt budget falls to the next.

Configure the chain under Settings → Plugins → Vision. Drag rows to reorder. Each row names a protocol and an effort preset (`openai`, `mimo`, `qwen-local`, `anthropic`). A typed key is write-only.

![Session that listed workspace images and offered to inspect them through the vision plugin](docs/assets/readme/vision-session.png)

Under the macOS shell, a dropped folder or non-image file arrives as an absolute path mention. In a browser, a dropped folder is walked for attachable images only. See [`dsh-client-ui-attachment`](packages/client/ui-attachment/README.md) and [`dsh-vision`](packages/vision/vision/README.md).

### Custom models and reasoning efforts

![Settings → Models: official DeepSeek plus custom deepseek-pln and vision-exp providers](docs/assets/readme/models.png)

The official Models page stores a DeepSeek key. This checkout's Models page also edits pi-ai routes in the UI:

- add a catalog provider or a hand-declared custom provider
- fetch `/models` from the URL and key currently shown
- set each model's context window, output cap, and `reasoningEfforts` chips (`off` / `high` / `max`, or a vendor preset)
- set the route's stream idle timeout (seconds of silence before the client gives up on a long local generation)
- declare `input: [text, image]` on a custom model that actually accepts images

![Composer model picker open on a custom vision-exp route, with reasoning level Max](docs/assets/readme/model-picker.png)

The picker lists every configured route and the reasoning level the active model declared. A session that has already sent a request keeps the model recorded in its own log. Team defaults for the PLN route live in [`deploy/defaults.patch.yml`](deploy/defaults.patch.yml) and apply on every `dsh` boot; user settings still win. Do not put API keys in that file. Details: [Configure models](docs/user/guide/providers.md).

### Native desktop shells

This checkout ships two desktop wrappers around `http://127.0.0.1:3080/`:

- **macOS** — `scripts/macos-app` builds `DeepSeek Harness.app` (WKWebView, Downloads via `WKDownload`, a separate helper window for a remote device, a restart offer when the web server build is newer than the open window).
- **Linux** — [`scripts/linux-app`](scripts/linux-app/README.md) is a GTK 4 + WebKitGTK window with the same auto-start of `dsh web`. `dsh app` launches it after `./scripts/setup.sh`.

Closing the window does not stop the web server. A later launch reuses `127.0.0.1:3080` when it already answers.

### Checkout bootstrap

`./scripts/setup.sh` installs dependencies, builds this tree, puts `dsh` on `PATH`, seeds `~/.dsh/.credentials.yaml` without overwriting an existing file, and on Linux installs the desktop launcher. Later: `./scripts/setup.sh --update`.

Secrets stay in `~/.dsh/.credentials.yaml`. The wrapper always boots this checkout, so `dsh web` / `dsh app` pick up vision, remotes, and the shipped PLN overlay. `npx @deepseek-ai/dsh` does not.

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run this checkout

```sh
git clone https://github.com/taotaoxu7447/deepseek-harness.git
cd deepseek-harness
./scripts/setup.sh
```

Then, from any directory:

```sh
dsh web
dsh app
dsh --help
```

Fill `~/.dsh/.credentials.yaml` (`DEEPSEEK_API_KEY`, `DEEPSEEK_PLN_API_KEY`) once. Later updates:

```sh
./scripts/setup.sh --update
```

Team defaults (provider route, default model, effort levels) live in [`deploy/defaults.patch.yml`](deploy/defaults.patch.yml) and apply on every `dsh` boot. Edit that file in git to change what every clone gets; do not put API keys there.

### Run from `npm`

Install `Node.js`, then run:

```sh
npx @deepseek-ai/dsh web
```

The command starts the official Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md). The published npm package does not include this fork's vision plugin, remotes, cluster monitor, balance capsule, or custom PLN route.

### Run from source

To run from a repository checkout without the bootstrap:

```sh
git clone https://github.com/taotaoxu7447/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` prepares the repository artifacts. `pnpm dsh web` uses those built artifacts without rebuilding.

## Community and support

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) on the official repository.
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join the <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

Issues that are specific to this fork belong on [`taotaoxu7447/deepseek-harness`](https://github.com/taotaoxu7447/deepseek-harness/issues).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
