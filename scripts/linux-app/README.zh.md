# Linux 桌面壳层

[English](README.md) | 中文

GTK 4 + libadwaita + WebKitGTK 6 窗口，加载本地 Web UI `http://127.0.0.1:3080/`。它是 [`scripts/macos-app`](../macos-app/main.swift) 的 Linux 对应物：自有启动器图标、自动启动 Web 服务器、将附件保存到 Downloads 目录，以及退出壳层时不停止后端。

## 前置条件

Ubuntu 24.04 或其他具备以下依赖的桌面：

```sh
sudo apt install python3-gi python3-gi-cairo python3-pil \
  gir1.2-gtk-4.0 gir1.2-webkit-6.0 gir1.2-adw-1 gir1.2-gdkpixbuf-2.0
```

`PATH`（或 `~/.local/bin`）上需要 Node.js 22+ 和 `pnpm`。在已构建的检出目录中，`dsh-serve` 会运行 `pnpm dsh web`，使窗口加载本仓库的插件（vision、自定义模型 effort）。没有检出目录时回退到 `dsh` 或 `npx @deepseek-ai/dsh`。

## 安装

全新 clone 后请运行检出目录引导（依赖、构建、把 `dsh` 放到 `PATH`、桌面启动器、凭据种子文件）：

```sh
./scripts/setup.sh
```

若源码树已经构建完成，只安装桌面启动器和 `dsh` 包装器：

```sh
scripts/linux-app/build.sh
```

会安装用户启动器（`~/.local/share/applications/com.deepseek.harness.desktop`）、图标、`~/.local/bin/deepseek-harness`、`~/.local/bin/dsh` 和 `~/bin/dsh-serve`。可从 GNOME 应用网格打开 **DeepSeek Harness**，或在终端运行 `dsh web` / `dsh --help`。

不安装、直接从本目录运行：

```sh
python3 scripts/linux-app/main.py
```

## 行为

- 健康检查通过后加载 `http://127.0.0.1:3080/`。若失败，`~/bin/dsh-serve`（或捆绑副本）会新开一个会话：`DSH_CHECKOUT` 或 `checkout.path` 指向的已构建检出目录运行 `pnpm dsh web`；否则运行 `dsh web` 或 `npx --yes @deepseek-ai/dsh web`。最多轮询 90 秒。
- 关闭窗口或 Ctrl+Q 只退出壳层。Web 服务器继续运行；之后再次启动会复用它。
- Ctrl+R / F5 重新加载。无法渲染的响应与附件下载会以去重后的文件名落入 `~/Downloads`，并在文件管理器中显示。
- 网站数据保存在 `~/.local/share/deepseek-harness/webkit`。服务器日志追加到 `~/.dsh/serve.log`。
- `~/.local/bin/dsh` 可从任意目录启动本检出目录，且不改变工作目录（调用时的目录就是默认 workspace）。`dsh web` 是桌面壳层自动启动在终端中的对应方式。
- `DSH_SERVE_CMD` 可覆盖健康检查失败时 `dsh-serve` 启动的命令。
- 壳层会设置 `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS`，因为 webview 只加载环回 UI，且在无法使用非特权 user namespace 时 WebKitGTK 的 bubblewrap 沙箱会失败。

决策记录见 [Linux 桌面壳层 Agent Note](../../.agents/notes/implemented/feature/2026-08-19-linux-desktop-shell.md)。
