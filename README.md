# DeepSeek Harness

English | [中文](README.zh.md)

DeepSeek Harness (`dsh`) is an open-source agent harness developed by [DeepSeek AI](https://deepseek.com).

It uses an architecture where **everything is a plugin**, and is powered by [Cordis](https://github.com/cordiverse/cordis), whose design is described in [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper).

## Developer preview

DeepSeek Harness is currently in _developer preview_ and is iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

## Run

### Run this checkout

This fork ships a one-command bootstrap so `dsh` uses the local tree (vision plugin, custom-model effort, and the shipped PLN provider). Secrets stay in `~/.dsh/.credentials.yaml` and are never committed.

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

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md). The published npm package does not include this fork's vision plugin or custom PLN route.

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

- Feel free to submit feedback or bug reports through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to your plugin repository for discoverability.
- Join <a href="https://discord.gg/Ycq5dCaS4">DeepSeek Harness Discord community</a>.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

For agents, follow [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
