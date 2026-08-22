# Agent Note: Remote devices over SSH tunnels

Status: implemented

[English](2026-08-21-remote-devices-ssh-tunnels.md) | 中文

## Problem

用户会在多台机器上跑 dsh——工作站、VPS——并希望在本地窗口里驱动远端的那台 dsh。Host 只绑 loopback，并且按设计不带任何入站鉴权（loopback 即信任边界），直接把端口暴露出去并不安全；而在本地 UI 里重做一套远端会话视图，等于对着第二个事件源复制整个界面。

## Decision

远端 Host 本身就服务自己的 UI，所以这个功能转发端口而不是重写界面：`ssh -L <localPort>:127.0.0.1:<remotePort>` 把远端的 loopback UI 映射到本机，保真度逐像素一致、事件流完整、在窗口里发出的指令在远端机器上执行。认证完全落在用户既有的 ssh config 与密钥里；功能本身不接触任何凭据材料，spawn ssh 时带 `BatchMode=yes`，永远不会出现密码交互；目标、密钥或端口出错时 fail loud，给出可读原因。

[`packages/remote/remote-tunnels`](../../../../packages/remote/remote-tunnels/README.md) 拥有整个生命周期。`remoteTunnels` cordis 服务安装 `remote` 设置小节，其 `devices` 清单为每台设备记录 id、ssh 目标、端口与 `autoConnect`；编辑即时生效——改了 ssh 目标会重启对应隧道，移除设备会终止对应隧道。每台设备的隧道由单一生命周期控制器驱动，状态机为 `disconnected → connecting → ready → failed(detail)`：spawn、探测转发的 loopback 端口直到应答 2xx、随后监护。命中致命 stderr 模式（认证失败、主机密钥、无法解析的主机名、转发被拒）直接进入 `failed` 且不重试；期望保持连接时的瞬时退出按指数退避重连（初始 1s、封顶 30s，均可配置）。`disconnect` 终止整个进程树，并且只在端口释放后才 resolve。显式本地端口必须唯一；缺省端口从 13389 起按清单顺序分配。

apiproxy 的 `remote` 域暴露 `remote.list` / `remote.connect` / `remote.disconnect`，携带浏览器可安全引入的 `RemoteDeviceView`；`url` 仅在设备 `ready` 时出现。未组合隧道服务的部署会收到一份空清单和一个具名 `remote-tunnel-failed` 错误，与 vision 域在 provider 缺席时的先例一致。base bundle 以休眠方式组合该服务：没有 `remote` 小节时它空转。

Web 插件设置页新增 Remote 卡（`packages/client/ui-settings-plugins`）：整份清单先暂存、保存时整体写入，与 Vision 链编辑器相同；连接/断开按钮则立即生效。隧道状态通过每两秒轮询一次 `remote.list` 到达卡片——这个界面没有推送通道，而卡片是唯一消费者——仅在卡片打开时轮询。已连接的行提供两种打开方式：新开浏览器标签页，以及为 macOS 壳内单窗口流程准备的原地跳转。

macOS 壳补上回程：View → Show Local（⌘0）在窗口跳到远端 UI 之后重新加载本机 Host；对 web view URL 的 KVO 观察会在 origin 不是本机时把窗口标题改为 `DeepSeek Harness — <host:port>`。壳的 UIDelegate 把 `target=_blank` 导航（卡片的新标签页链接）交给默认浏览器——否则 WKWebView 会静默丢弃——页面侧钩子则把 console 错误与未处理的 rejection 镜像到 `~/Library/Logs/DeepSeekHarness-web.log`，让只在壳内复现的故障留下证据。

## Alternatives considered

**远端 Host 绑 0.0.0.0 再加 token。** 否决：Host 的 loopback 即信任设计没有可挂 token 的入站鉴权层，新造一层的安全面远大于一条 ssh 转发，而且这些机器用户本来就已维护 ssh 访问。

**客户端远端会话视图。** 否决：在本地 UI 里渲染第二个 Host 的事件流等于复制整个界面且保真更差；远端 Host 已经服务逐像素一致的页面，转发它的端口代码更少、结果更好。

**反向隧道、VPN 或 Tailscale。** 否决，属于用户不需要的部署重量：每台目标机器都在用户既有 ssh config 可达范围内，`-L` 不需要任何新基础设施。

**隧道状态走推送通道。** 暂缓而非否决：隧道状态以秒级变化，且设置卡是唯一消费者，卡片打开期间两秒轮询已经足够；若出现第二个消费者，可以用 `remote/state-changed` 事件替换轮询。

## Consequences

新增一个 Host 包、一个薄 RPC 域、一张设置卡和两处壳行为；功能全链路零凭据处理——泄露的清单条目只含主机别名，绝不含密钥。远端版本差异是特性而非风险：远端 UI 永远是远端自己的构建。`BatchMode=yes` 意味着只用密码的主机会 fail loud 而不是挂起；README 要求用户先在终端 ssh 一次，让主机密钥落入 known_hosts。状态 pill 最多落后真实状态一个轮询周期。一台设备恰好占用一个本地端口，端口冲突让该隧道失败，而不是抢占兄弟设备的端口。

## Testing

`packages/remote/remote-tunnels` 用可编排的子进程假身钉住完整状态机：就绪、拒连、非 2xx、探测超时、每一类致命 stderr、spawn 失败、退避倍增、详情截断、静默断开（含卡死进程）、退避中发起连接、设置驱动的重启与移除、非法配置 fail loud、dispose 清理。apiproxy 规格覆盖委托、错误折叠、未组合时的应答以及 fetch 载体往返。卡片的控制器与渲染规格覆盖暂存、保存、被拒写入、按 id 对齐的隧道投影、动词派发、导航与轮询生命周期。端到端路径走手动冒烟：填一台真实设备，Connect，打开就绪链接，在远端 UI 里发一条指令，再 ⌘0 回本机。
