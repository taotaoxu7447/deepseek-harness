# @deepseek-ai/dsh-remote-tunnels

[English](README.md) | 中文

从本机到其他设备上的 DeepSeek Harness 实例的 SSH 本地转发隧道，以 `ctx.remoteTunnels` 服务对外提供，并由「设置 → 插件 → Remote」卡片呈现。每台配置的设备拥有独立的生命周期：在设备处于期望连接状态期间保持 `ssh -N -L <localPort>:127.0.0.1:<remotePort> <sshTarget>` 存活，通过 HTTP 探测直到远端 Web UI 应答，然后携带其 `url`——`http://127.0.0.1:<localPort>/`——供任何浏览器（或 macOS 应用窗口）打开，以完整保真度获得远端界面：远端 Host 自行服务其 UI 与全部会话事件，在其中撰写消息即在远端主机的 agent loop 上执行。

认证永不经过本包。子进程以 `BatchMode=yes` 运行，所有登录均为非交互，由用户自己的 ssh 配置（主机别名、用户、端口、密钥、agent）承载；harness 不读取任何密钥，subprocess seam 的环境清理确保 harness 凭据不会进入子进程。远端 Host 绑定 loopback 并信任其 loopback，这正是把本地端口转发进去是预期——也是唯一安全的——传输方式的原因。有一项前提在 dsh 之外：先在终端里 ssh 一次目标主机，使其主机密钥进入 `known_hosts` 信任列表；在 BatchMode 下未确认的主机密钥是立即失败，而不是提示。

## 配置

组合入口（entry）提供初始清单，可选的 `remote` 设置小节——即 Remote 卡片写入的内容——实时覆盖它：提交的更改无需重启即生效（连接相关的编辑会重启该设备的隧道，移除条目会终止隧道，仅改 label 不触碰存活进程）。没有设备时服务空转。激活时若 `PATH` 上没有 `ssh` 客户端则直接报错（fail loud）。

| 键 | 默认值 | 含义 |
|---|---|---|
| `devices` | `[]` | 设备清单，按显示顺序。 |
| `reconnectInitialMs` | `1000` | 隧道进程掉线后首次重连的延迟；每次掉线翻倍。 |
| `reconnectMaxMs` | `30000` | 重连退避上限；不得低于 `reconnectInitialMs`。 |
| `probeIntervalMs` | `1000` | 同一条连接中两次就绪探测之间的间隔。 |
| `probeTimeoutMs` | `4000` | 单次就绪探测的 HTTP 预算。 |
| `terminateGraceMs` | `3000` | subprocess seam 升级到 SIGKILL 之前的 SIGTERM 宽限。 |

每台设备的键（`devices` 条目）：

| 键 | 默认值 | 含义 |
|---|---|---|
| `id` | （必填） | 稳定且唯一的 id，用于错误信息与 RPC 调用。 |
| `label` | （未设置） | 显示名；未设置时卡片回退到 `id`。 |
| `sshTarget` | （必填） | ssh 目标——`~/.ssh/config` 别名或 `user@host`；主机、端口、用户、密钥全部在 ssh 配置中。 |
| `remotePort` | `3080` | 远端 dsh 监听的 Web 端口。 |
| `localPort` | 自动 | 隧道在本机绑定的 loopback 端口；未设置的设备从 `13389` 起按顺序取槽位，跳过所有被显式占用的端口。 |
| `autoConnect` | `false` | 为 true 时，清单一出现该条目即连接隧道。 |

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

重复的 id、空的 id 或目标、重复的显式 `localPort`、低于 `reconnectInitialMs` 的 `reconnectMaxMs` 都会使设置写入失败（卡片保留草稿）或组合加载失败——绝不静默截断。

## 生命周期

`disconnected → connecting → ready → failed(detail)`。`connect(id)` 拉起转发进程并返回当前为 `connecting` 的视图；就绪状态通过 `list()` 观察。探测循环对 loopback 端口 GET `/`，直到应答 2xx，设备随即转为 `ready` 且视图携带 `url`。在设备处于期望连接状态期间，进程意外退出会在翻倍退避（默认 1s → 30s）后重新拉起——因此远端主机宕机时会以低开销持续重试。stderr 指明不可修复条件的退出——认证被拒、主机密钥验证失败、主机名无法解析、转发规格被拒、本地端口已被绑定——会立即将设备转为 `failed` 并给出可读原因，且绝不重试：重复同样的 spawn 无法修复这些问题。`disconnect(id)` 终止进程树并等待其退出后才返回，因此视图读到 `disconnected` 时 loopback 端口已释放。卸载插件会以同样方式终止所有存活隧道。

每条 detail 信息都经过截断且不含凭据材料——BatchMode 子进程既看不到也不会回显密钥。

## 模型体验

无。Remote 卡片下方的隧道不搬运任何会话内容，也不注册任何面向模型的能力；agent 的模型流量始终留在运行其 loop 的主机本地。

#### KV Cache 影响

无——隧道进程只是普通的 ssh 客户端，从不触碰模型请求。

## 已知限制与延期工作

- **状态靠读取而非推送**——卡片轮询 `remote.list()`；没有事件流，因此后台发生的状态变化在下一次轮询时才可见，而非立即。
- **每台设备一条转发，归本包所有**——已被其他工具占用的端口会报告为 `failed`（绝不接管），服务同一端口的两台 dsh 主机需要不同的 `localPort`。
- **只支持 BatchMode**——密码提示与交互式主机密钥确认按设计直接失败；基于密钥的登录以及先做一次终端 `ssh` 以建立 `known_hosts` 信任是前提，上文已说明，不做绕过。
- **不检查远端版本差异**——隧道呈现的 UI 就是远端主机自己服务的版本（始终是其当前构建），这正是设计意图；两端 fork 功能不一致时不做诊断。
