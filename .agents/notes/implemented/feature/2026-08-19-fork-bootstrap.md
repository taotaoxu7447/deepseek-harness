# Agent Note: Checkout bootstrap

Status: implemented

English | [中文](2026-08-19-fork-bootstrap.zh.md)

## Problem

A clone of this fork is source only: `node_modules` and `lib/` are gitignored, `dsh` is not on `PATH`, the Linux desktop shell lives under `scripts/linux-app` and is not installed, and the PLN provider plus effort levels live in `$DSH_HOME/settings.yaml` on one machine. `npx @deepseek-ai/dsh web` boots the published package, which does not include this fork's vision plugin or custom route. Another person therefore cannot clone and run; updating the git tree also does not update their launchers or composition defaults.

API keys in `$DSH_HOME/.credentials.yaml` must not enter git.

## Decision

[`scripts/setup.sh`](../../../../scripts/setup.sh) is the one command for a clone: it installs pnpm if needed, runs `pnpm install` and `pnpm run build`, puts [`scripts/linux-app/dsh`](../../../../scripts/linux-app/dsh) on `~/.local/bin/dsh`, writes `~/.local/share/deepseek-harness/checkout.path`, seeds `~/.dsh/.credentials.yaml` from [`deploy/credentials.example.yaml`](../../../../deploy/credentials.example.yaml) only when that file is absent, and on Linux runs [`scripts/linux-app/build.sh`](../../../../scripts/linux-app/build.sh). `./scripts/setup.sh --update` is `git pull --ff-only` plus the same rebuild and reinstall.

[`scripts/linux-app/dsh`](../../../../scripts/linux-app/dsh) prepends `--patch deploy/defaults.patch.yml` on every CLI invocation. That overlay declares the `deepseek-pln` route (endpoint, model catalog, reasoning efforts) and sets `agent-default-model` to it. `dsh app` execs the installed desktop launcher. `dsh-serve` passes the same `--patch` into `pnpm dsh web` so the GTK window sees the same composition. User settings.yaml fields still overlay composition per field. Keys stay in the managed credentials document.

## Alternatives considered

**Publish a private npm package.** Rejected because this fork iterates with the git tree; every clone would still need a registry, a version bump, and a publish step.

**Copy `~/.dsh/settings.yaml` into git.** Rejected because that document is machine-local, can hold secrets, and would not update on `git pull` after the first seed.

**Patch the base bundle in `packages/bundle/base`.** Rejected because that bundle is the upstream composition; a `--patch` overlay keeps the team defaults in `deploy/` and leaves upstream rows intact.

**Materialize API keys into the patch.** Rejected because keys would be in git history.

## Consequences

A clone plus `./scripts/setup.sh` plus filling two credential slots is the install. Later `./scripts/setup.sh --update` refreshes code, launchers, and the shipped overlay. Changing what every clone boots means editing `deploy/defaults.patch.yml` and pushing; it does not mean editing another person's `~/.dsh`. An existing user settings.yaml that already defines `llm-pi-ai.providers` continues to win those fields. Empty credential values fail requests with `MISSING_CREDENTIAL` until filled.

## Testing

`dsh --dump-config --profile web` from a directory other than the checkout must list `deepseek-pln` and `reasoningEfforts` after the wrapper is installed. `dsh --help` and `dsh web --help` must still parse. `scripts/setup.sh --help` prints usage. Secrets must not appear in `deploy/`.
