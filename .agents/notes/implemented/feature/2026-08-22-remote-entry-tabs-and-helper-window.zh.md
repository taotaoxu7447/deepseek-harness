# Agent Note: 远程连接登上主界面——侧栏入口、窗口标签页与辅助窗口

Status: implemented

[English](2026-08-22-remote-entry-tabs-and-helper-window.md) | 中文

## Problem

基于 SSH 隧道的远程设备此前只有一个界面：「设置 → 插件」里的 Remote 卡片。要连一台已配置的设备，得先打开设置、找到卡片、连接，然后二选一：浏览器标签页（离开应用），或原地导航（把本地会话挤出窗口）。每天都要驱动远程 dsh 的用户需要主窗口上的「连接并打开」路径，而且两种打开手势都要留在应用内：本窗口的一个标签页，或者一个在 Dock 和标题栏都表明远程身份的独立应用窗口。

## Decision

新包 `packages/client/ui-remote` 占用侧栏声明的 `sidebar.footer.action` 列表槽，在 Settings 旁放一个「远程连接」触发器。其弹层列出 `remote` RPC 域的名册与实时相位，立即执行 `remote.connect`/`remote.disconnect`，并通过添加设备表单（显示名、SSH 目标、端口、自动连接）就地扩展 `remote` 设置段——分阶段的多字段编辑器仍留在设置页。控制器构造时的一次 `remote.list` 引导轮询喂给触发器上的状态点（Host 自动连接的隧道无需打开任何东西即可显示）；持续的 2 秒轮询只在弹层打开时运行，因为弹层是唯一关注相位变化的界面。名册写入扩展的是*已存储*的设备列表而非轮询视图，所以一台已配置但 Host 尚未建出隧道的设备绝不会因照 RPC 答复重新添加而丢失。

**在标签页打开**把隧道 UI 摆成窗口标签页：`ui-layout` 在列上方持有一条标签栏，存在远程标签页时显示，切换即把按设备划分的 iframe（以 `id@url` 为键）换入本地框架的位置。本地框架保持挂载仅被隐藏，进行中的对话不会在标签切换中丢失，每个已摆入的远程持续运行；一次把隧道端口挪走的重连只重挂载那一个标签页。`ctx.layout` 新增 `openRemoteTab`/`activateRemoteTab`/`showLocalTab`/`closeRemoteTab`；与布局 store 的其余部分一样，标签条是瞬态的。

**在新窗口打开**以新浏览上下文打开隧道 URL，设备显示名挂在 `dshRemoteLabel` 查询参数上。普通浏览器忽略该参数、打开一个标签页。macOS 外壳的 UIDelegate 则把携带该参数的 URL 路由给随包捆绑的辅助应用（`Contents/Helpers/DeepSeek Harness Remote.app`，独立 bundle id `com.deepseek.harness.desktop.remote`——一个进程一个 Dock 图标，名为「DeepSeek Harness 远程」），而不是交给默认浏览器。辅助应用在 WKWebView 窗口中承载该 URL，标题为「DeepSeek Harness」，机器名作为 `NSWindow.subtitle`；再次启动会把 URL 经分布式通知转发给正在运行的实例后退出，关闭窗口即退出辅助应用。外壳的共享代码（控制台镜像、下载、菜单构建器、路由枚举）移入 `scripts/macos-app/shared.swift`，由两个入口文件各自链接。

## Alternatives considered

**单进程多窗口（Electron 式）。** 否决：macOS 一个进程只给一个 Dock 图标，要让远程窗口在 Dock 中可区分且有标题，就必须有第二个 bundle——辅助应用拆分是原生答案，不是权宜之计。

**原地替换本地 UI，加返回手段。** 被用户要求与状态事实双重否决：原地导航会杀掉本地会话的页面状态，而「隐藏但保持挂载的框架加 iframe」能零成本保全两侧。

**标签页由远程包自己持有。** 否决：只有布局框架能在保持本地树挂载的前提下换掉整个列区域；特性自持的遮罩层做不到。标签条属于框架外壳，因此归 `ui-layout` 所有，`ui-remote` 只是服务接口的消费方。

**跨重载持久化远程标签页。** 暂缓：布局 store 如今什么都不持久化，而且下次启动时一个过期的隧道 URL，恢复出一个死标签页的概率远高于活标签页。

## Consequences

「连接并打开」在任何窗口状态下都是一次点击，两种手势在 macOS 应用内名副其实。同窗口标签页依赖 webserver 没有禁止嵌框的响应头——将来加上 `X-Frame-Options`/CSP 嵌框规则的部署必须重访这条路径。辅助应用是构建脚本里的第二个 Swift 目标，也是第二份控制台日志（`DeepSeekHarnessRemote-web.log`）；两者共享 `shared.swift`，外壳行为修复只需落一次。设置卡片与侧栏入口都轮询 `remote.list`，但同一界面状态下二者不会同时轮询——入口只在弹层打开时轮询。

## Testing

`ui-remote` 的单测覆盖辅助函数（显示名兜底、id 铸造、端口解析）、控制器（引导轮询与弹层期轮询、动词 busy 跟踪、两种打开手势及其 label 参数、添加设备的校验/写入/连接及其失败、销毁）、组件（宽/导轨触发器、聚合状态点、行动作、添加表单）以及 apply 装配与拆解。`ui-layout` 的测试覆盖 store 动作与框架的标签条渲染。macOS 辅助应用的路由与单实例转发靠手动冒烟验证：连一台设备，两种方式各开一次，连点两次手势，关闭辅助窗口。
