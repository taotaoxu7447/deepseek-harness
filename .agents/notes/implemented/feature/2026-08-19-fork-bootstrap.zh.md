# Agent Note: 检出目录引导

Status: implemented

[English](2026-08-19-fork-bootstrap.md) | 中文

## 问题

对本 fork 的一次 clone 只有源码：`node_modules` 和 `lib/` 被 gitignore，`dsh` 不在 `PATH` 上，Linux 桌面壳层在 `scripts/linux-app` 下且未安装，PLN 提供方和 effort 档位只存在于某台机器的 `$DSH_HOME/settings.yaml`。`npx @deepseek-ai/dsh web` 启动的是已发布的包，其中没有本 fork 的 vision 插件或自定义路由。因此别人无法 clone 后直接运行；更新 git 树也不会更新他们的启动器或组合默认值。

`$DSH_HOME/.credentials.yaml` 中的 API 密钥不得进入 git。

## 决策

[`scripts/setup.sh`](../../../../scripts/setup.sh) 是 clone 后的一条命令：按需安装 pnpm，运行 `pnpm install` 和 `pnpm run build`，把 [`scripts/linux-app/dsh`](../../../../scripts/linux-app/dsh) 放到 `~/.local/bin/dsh`，写入 `~/.local/share/deepseek-harness/checkout.path`，仅在 `$HOME/.dsh/.credentials.yaml` 不存在时从 [`deploy/credentials.example.yaml`](../../../../deploy/credentials.example.yaml) 写入种子文件，并在 Linux 上运行 [`scripts/linux-app/build.sh`](../../../../scripts/linux-app/build.sh)。`./scripts/setup.sh --update` 是 `git pull --ff-only` 加上同样的重建与重新安装。

[`scripts/linux-app/dsh`](../../../../scripts/linux-app/dsh) 在每次 CLI 调用前插入 `--patch deploy/defaults.patch.yml`。该 overlay 声明 `deepseek-pln` 路由（端点、模型目录、reasoning efforts）并把 `agent-default-model` 设为它。`dsh app` 会 exec 已安装的桌面启动器。`dsh-serve` 把同一 `--patch` 传给 `pnpm dsh web`，因此 GTK 窗口看到的组合与终端一致。用户 settings.yaml 中的字段仍按字段覆盖组合层。密钥仍只在受管凭据文档中。

## 曾考虑的替代方案

**发布私有 npm 包。** 不予采纳，因为本 fork 随 git 树迭代；每个 clone 仍需要 registry、版本号和一次发布。

**把 `~/.dsh/settings.yaml` 拷进 git。** 不予采纳，因为该文档是机器本地的、可能含密钥，并且在第一次写入之后不会随 `git pull` 更新。

**改 `packages/bundle/base` 里的基础组合包。** 不予采纳，因为那是上游组合；用 `--patch` overlay 把团队默认值放在 `deploy/`，可保持上游各行不变。

**把 API 密钥写进 patch。** 不予采纳，因为密钥会进入 git 历史。

## 后果

clone 加上 `./scripts/setup.sh` 再加上填写两个凭据槽位就是安装。之后 `./scripts/setup.sh --update` 会刷新代码、启动器和随仓库分发的 overlay。要改每个 clone 启动时的内容，就是编辑 `deploy/defaults.patch.yml` 并推送；不是去改别人的 `~/.dsh`。若用户已有的 settings.yaml 定义了 `llm-pi-ai.providers`，这些字段继续优先。凭据值为空时请求会以 `MISSING_CREDENTIAL` 失败，直到填入为止。

## 测试

包装器安装后，从非检出目录运行 `dsh --dump-config --profile web` 必须列出 `deepseek-pln` 和 `reasoningEfforts`。`dsh --help` 和 `dsh web --help` 仍须能解析。`scripts/setup.sh --help` 打印用法。`deploy/` 中不得出现密钥。
