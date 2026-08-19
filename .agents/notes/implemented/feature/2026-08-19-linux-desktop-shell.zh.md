# Agent Note: Linux 桌面壳层

Status: implemented

[English](2026-08-19-linux-desktop-shell.md) | 中文

## 问题

仓库在 [`scripts/macos-app`](../../../../scripts/macos-app/main.swift) 中提供原生 macOS WKWebView 壳层：拥有 Dock 图标、加载环回 Web UI、在健康检查失败时启动后端，并把附件保存到 `~/Downloads`。Ubuntu 及其他 Linux 桌面只有浏览器标签页：没有应用网格图标、没有 Freedesktop 启动器，也没有对应的自动启动与下载交接。

## 决策

[`scripts/linux-app`](../../../../scripts/linux-app/README.md) 是覆盖 `http://127.0.0.1:3080/` 的 GTK 4 + libadwaita + WebKitGTK 6 壳层。`scripts/linux-app/build.sh` 会安装用户桌面项 `com.deepseek.harness.desktop`、hicolor 图标、`~/.local/bin/deepseek-harness`、`~/.local/bin/dsh` 和 `~/bin/dsh-serve`。application id 为 `com.deepseek.harness`，避免桌面文件名变成 `*.desktop.desktop`；macOS bundle id 仍为 `com.deepseek.harness.desktop`。终端 `dsh` 包装器会 exec 本检出目录的 CLI（`apps/cli/lib/bin.js`，或通过 tsx 运行 TypeScript 入口），且不改变调用时的目录，因此在任意文件夹运行 `dsh web` 和 `dsh --profile headless` 都会使用本 fork 的 vision 链和自定义模型 effort UI，并以该文件夹为默认 workspace。

壳层先对环回 URL 做健康检查，未就绪时在新会话中运行 `dsh-serve`。`dsh-serve` 在 `~/.dsh/serve.lock` 上取排他锁，依次启动 `DSH_SERVE_CMD`、否则在已构建的检出目录（`DSH_CHECKOUT` 或已安装的 `checkout.path`）中运行 `pnpm dsh web`、否则 `dsh web`、否则 `npx --yes @deepseek-ai/dsh web`，等到环回 URL 有响应，并且不把服务器挂到 GTK 进程组。检出目录是本 fork 的 vision 链和自定义模型 reasoning-effort UI 所必需的，已发布的 npm 包不包含这些功能。关闭窗口或 Ctrl+Q 只退出壳层。Ctrl+R / F5 重新加载。无法渲染的 MIME 类型以及 `Content-Disposition: attachment` 响应会按与 macOS 壳层相同的去重文件名写入 `~/Downloads`，并通过 `org.freedesktop.FileManager1` 显示该文件。网站数据保存在 `~/.local/share/deepseek-harness/webkit`。GNOME 启动会把 `~/bin` 和 `~/.local/bin` 加到 `PATH` 前面，因为桌面 `PATH` 里没有这些目录。进程会设置 `WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS`，从而不启动 WebKitGTK 的 bubblewrap：webview 只加载环回 UI，且在无法使用非特权 user namespace 时该沙箱会失败。

## 曾考虑的替代方案

**Electron 或 Tauri。** 不予采纳，因为 macOS 壳层是一层薄的原生 WebView，而第二套 JavaScript 运行时只会增加大量依赖；Ubuntu 桌面已有 WebKitGTK 可完成同样的工作。

**Qt WebEngine。** 不予采纳，因为 Ubuntu 24.04 的 GNOME 已经提供 GTK 4、libadwaita 与 WebKitGTK 6；为同一件 WebView 工作再引入 Qt 是额外的工具包。

**GTK 3 与 WebKit2GTK。** 不予采纳，因为 Ubuntu 24.04 的原生 GNOME 栈是 GTK 4 / WebKit 6，libadwaita 也沿用该栈。

**浏览器书签或已安装的 PWA。** 不予采纳，因为 PWA 不会启动 `dsh web`、没有 Freedesktop application id，也无法应用 Downloads 目录的去重并显示规则。

**关闭时隐藏并加托盘图标。** 不予采纳，因为 Ubuntu 24.04 的 GNOME 默认没有托盘；没有窗口的隐藏进程不可发现。退出壳层、再对仍在运行的后端重新启动，才是恢复路径。

## 后果

Ubuntu 24.04 的 GNOME 可以安装并启动一个原生窗口，覆盖浏览器已经使用的同一环回 Web UI。后端寿命长于窗口，与 macOS 的寿命规则一致。该壳层需要 [Linux 桌面壳层 README](../../../../scripts/linux-app/README.md) 中列出的 GI 绑定；无界面主机仍可运行 `python3 -m unittest scripts/linux-app/test_helpers.py`，因为这些测试不导入 GTK。Linux application id 不是 macOS bundle id。`dsh-serve` 用 `setsid` 守护化，因此壳层崩溃或退出不会停止进行中的会话。关闭 WebKitGTK 沙箱意味着渲染进程一旦被攻破会共享用户权限；这被接受，因为加载的源是本地 Web UI，而不是任意网站。

## 测试

`scripts/linux-app/test_helpers.py` 固定了 basename 净化、下载去重、`PATH` 前缀和命令解析。`scripts/linux-app/make-icon.py` 与 `build.sh` 通过生成 1024px 标志并安装桌面项来行使。GTK 窗口在带显示的会话中通过启动 `deepseek-harness` 并加载环回 UI 来验证；没有桌面会话的 CI 不运行该窗口。
