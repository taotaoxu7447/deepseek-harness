# @deepseek-ai/dsh-v4-monitor

[English](README.md) | 中文

DeepSeek V4 Flash 实时集群监控服务与 ds-dash 状态代理，以 `ctx.v4Monitor` 暴露。连接参数在本条目自己的设置表单上编辑。

鉴权走 `X-Dash-Pass` 头。Host 代理避免浏览器 CORS。监控地址和邀请码都没有出厂默认值：两者没有同时写入时，服务不会发起请求。

## 配置

所有字段均为 volatile，条目本身就是实时设置表单：改动即时生效，无需重载。

| 键 | 默认 | 含义 |
|---|---|---|
| `enabled` | `false` | 是否显示输入框上方状态条。侧栏开关写入此项。 |
| `monitorUrl` | （空） | ds-dash 监控服务地址。 |
| `passcode` | （空） | 写入 `X-Dash-Pass` 的邀请码。 |
| `pollIntervalMs` | `2000` | 状态条打开时的轮询间隔。 |
| `autoCollapse` | `false` | 状态条是否默认折叠。 |

```yaml
- id: v4-monitor
  name: '@deepseek-ai/dsh-v4-monitor'
```

## 模型体验

无。监控服务不触碰会话内容，也不注册任何模型向接口。

#### KV Cache 效应

无。监控请求独立查询 ds-dash 遥测端点，不改模型提示词。

## 已知限制与后续工作

- **按需轮询** — 通过 HTTP 轮询而非 SSE；仅当消费方调用 `fetchState` 且两个连接参数都存在时轮询。
- **邀请码** — 邀请码存在本地设置文档里，作为请求头发出。
- **暂无 0.2.0 状态条 UI** — 输入框上方状态条需要移植到当前的 client-plugin 表面；在此之前本服务只面向 Host 侧消费方。
