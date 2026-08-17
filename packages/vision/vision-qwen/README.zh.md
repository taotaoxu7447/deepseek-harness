# @deepseek-ai/dsh-vision-qwen

[English](README.md) | 中文

面向 harness [视觉能力接缝](../vision/README.md)（`ctx.vision`）的多协议 `VisionProvider` 链：一个 provider，其 `backends` 列表即优先级顺序——第一个可用条目先服务；耗尽重试预算的后端降级到下一优先级。每个后端说三种线路协议之一——OpenAI chat completions（本地 vLLM/SGLang 的 Qwen 部署，或任何兼容服务器）、OpenAI Responses，或 Anthropic Messages。图片以 base64 载荷随请求发送；回复文本即描述结果。

这是一个**实现**包：它把 provider 注册进 `ctx.vision`，不拥有 `ctx.vision` 键，也不注册面向模型的工具（那是 [`dsh-tool-vision`](../tool-vision/README.md)）。它是函数/命名空间插件（`inject: ['vision']`），不是默认导出服务。

连接事实按次调用解析、分层：`cordis.yml` 条目配置在下，可选的 `vision` 用户设置段落（`ctx.settings`）在上——网页端 **设置 → 插件 → 视觉** 卡片编辑它——每个后端的 API key 经凭据接缝解析。链路、优先级、模型、协议、effort 选择或 key 的变更在下一次 describe 即生效，无需重启。没有任何可用后端（缺 `model` 或 `baseURL` 不可解析）的段落会停放 provider——已注册但拒绝被选——而不是让加载失败：设置卡片就是补完配置的预期位置。

## 配置

链级键：

| 键 | 默认值 | 含义 |
|---|---|---|
| `backends` | `[]` | 优先级链（索引 0 先服务）；至多 5 条。 |
| `attemptsPerBackend` | `2` | 每个后端的重试次数，用尽后链降级到下一优先级。 |
| `temperature` | `0.2` | 采样温度，`[0, 2]` 内。仅在 chat completions 与未开 thinking 的 Anthropic Messages 上发送；Responses 与 thinking 请求拒绝非默认值，故省略。 |
| `maxTokens` | `1024` | 单次描述的输出预算（token）。后端的 `contextTokens` 若设置，不得小于它——违规在保存/加载时被拒绝，绝不静默截断。 |
| `timeoutMs` | `60000` | 单次尝试的 HTTP 预算；触发映射为 `VISION_ABORTED`。 |

后端级键（`backends` 的每个条目）：

| 键 | 默认值 | 含义 |
|---|---|---|
| `id` | （必填） | 稳定 id，用于错误信息与凭据引用命名。 |
| `enabled` | `true` | 为 false 时停放该后端，不影响其余顺序。 |
| `baseURL` | `$QWEN_BASE_URL` | 端点基址；按协议追加路径（`/chat/completions`、`/responses` 或 `/v1/messages`）。 |
| `model` | （未设） | 端点服务的视觉模型 id。未设则该后端不可用。 |
| `apiKeyEnv` | `VISION_<ID>_API_KEY` | 每次 describe 解析的凭据引用。答案为空则不发送任何鉴权头——无 key 的本地端点可正常工作。 |
| `apiKey` | （未设） | 字面 API key；优选 `apiKeyEnv`，避免密钥进入配置文件。 |
| `instruction` | 内置 | 该后端 describe 调用的系统指令。 |
| `protocol` | `openai-chat` | 线路协议：`openai-chat`、`openai-responses` 或 `anthropic`。 |
| `effortPreset` | （未设） | 模型说哪家的 effort 词汇：`openai`、`mimo`、`qwen-local` 或 `anthropic`。未设则不发送任何 effort 参数。 |
| `effortLevel` | （未设） | `openai` 预设的分级档位：`none`/`minimal`/`low`/`medium`/`high`。 |
| `effortEnabled` | （未设） | `mimo`、`qwen-local`、`anthropic` 预设的 effort 开关。 |
| `thinkingBudget` | （未设） | `qwen-local`（`thinking_budget`）与 `anthropic`（`budget_tokens`；开关打开时至少 1024 且小于 `maxTokens`）的思考预算（token）。 |
| `contextTokens` | （未设） | 模型标称的上下文窗口；`maxTokens` 超过它时写入被拒绝。 |
| `maxInputTokens` | （未设） | 输入估算守卫；估算超限的 describe 在任何请求发出前以 `VISION_INPUT_TOO_LARGE` 被拒绝，链降级到下一优先级。 |

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

组合时无需任何配置：在插件设置卡片上完成设置（添加后端，选择协议、端点、key、模型——探测按钮会从端点自己的模型列表回填模型 id），值会持久化到用户设置文档并即时生效。卡片自上而下按优先级画出整条链——拖动行首的 ⋮⋮ 手柄（或用行内上移/下移按钮）调整顺位，行间连接线标明了按尝试次数耗尽后的降级去向。每行可用 ▾ 按钮收起为只剩行首（或用「全部收起」收起整条链），长链也能方便地拖动排序。输入 API key 时以密码掩码回显并挂上「已填写」徽章；保存落盘后立即清空输入框，由「已配置」徽章承接状态——已存的密钥绝不回读。组合式链路示例：

```yaml
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
  config:
    backends:
      - id: local-qwen
        baseURL: http://localhost:8000/v1
        model: qwen3-vl-27b
        effortPreset: qwen-local
        effortEnabled: true
        thinkingBudget: 2048
      - id: claude-fallback
        baseURL: https://api.anthropic.com
        model: claude-sonnet-4-5
        protocol: anthropic
        effortPreset: anthropic
        apiKeyEnv: ANTHROPIC_API_KEY
    attemptsPerBackend: 2
```

schema 无法表达的跨字段规则在段落写入时校验（卡片保留被拒绝的草稿），并在组合加载时校验：`effortLevel` 属于 `openai` 预设，`effortEnabled` 属于 `mimo`/`qwen-local`/`anthropic`，`thinkingBudget` 属于 `qwen-local`/`anthropic`；`openai` 与 `mimo` 预设可搭任一 OpenAI 协议，`qwen-local` 仅限 chat completions，`anthropic` 仅限 Messages。

## effort 预设

各家对 effort 的分档定义不同，因此配置命名的是预设而不是原始值：

- `openai` → 按所选档位发送 `reasoning_effort`（chat）或 `reasoning.effort`（Responses）。
- `mimo` → 关映射为 `none`，开映射为 `low`：小米 MiMo 服务端对 low/medium/high 一视同仁，只有开关有意义。MiMo 是预设而非协议——搭配任一 OpenAI 协议使用。
- `qwen-local` → `chat_template_kwargs: { enable_thinking, thinking_budget? }`，仅限 chat completions。
- `anthropic` → 开时发送 `thinking: { type: 'enabled', budget_tokens }`；此时按 Messages API 的要求省略 temperature。

## 输入守卫

`maxInputTokens` 比较的是估算值而非计费数字：文本（指令加提示词）按 4 字符 1 token，图片按 750 像素 1 token，尺寸从 PNG/JPEG/GIF/WebP 头部解析；头部不可读时回退为按文本速率估算编码字节数。拒绝发生在任何请求发出之前，并跳过该后端的剩余重试；只有携带自己上限的下一优先级仍可能服务该输入。

## 线路映射

Chat completions：`model`；携带 `instruction` 的 system 消息；一条 user 消息，内容部件为 `[image_url（data URL）、text（prompt ?? "Describe this image in detail."）]`；`max_tokens`；`temperature`；`stream: false`；外加 effort 片段。回复经 `choices[0].message.content` 映射——纯字符串，或把各 `text` 部件连接的数组——并回退到 `reasoning_content` 再 `reasoning`，因为以 OpenAI 兼容方式服务的思考模型有时把完整答案放在 reasoning 字段里。

Responses：`model`；`instructions`；一条 `input` 消息，部件为 `[input_image（data URL）、input_text]`；`max_output_tokens`；`stream: false`；不发 temperature。回复读 `output_text`，否则遍历 `output[]` 消息条目找 `output_text` 部件。

Anthropic Messages：`model`；`max_tokens`；`system`；一条 user 消息，块为 `[image（base64 source）、text]`；仅思考关闭时发 `temperature`；头部携带 `x-api-key`、`authorization: Bearer` 与 `anthropic-version: 2023-06-01`。回复连接 `content` 中的 `text` 块，丢弃 thinking 块。

每种协议都以服务端回报的 `model`（若有）作为 `VisionDescription.model`，否则用配置的 id；描述缺失或不可用时抛 `VisionError` `VISION_PROVIDER_ERROR`。HTTP 错误提取服务端嵌套的 `error.message`（字符串或对象）或顶层 `message`，否则回退到状态行；网络与响应体解析失败为 `VISION_PROVIDER_ERROR`；调用方取消与尝试自身的截止为 `VISION_ABORTED`。HTTP 重定向在联系 `Location` 目标之前即被拒绝。

## 模型体验

间接地经由 [`dsh-tool-vision`](../tool-vision/README.md)：它把本 provider 的描述文本与实际服务模型署名渲染进 `view_image` 工具结果。每次 describe 调用都是发往 sidecar 端点的独立请求，从不直接进入主模型的请求。

#### KV 缓存影响

不直接使主模型缓存失效；sidecar 请求相互独立。主请求前缀的任何变化由具名消费者负责。

## 已知限制与缓议事项

- **每次调用一张图，sidecar 无状态**——端点独立地看待每次 describe；跨调用的图片 token 缓存是服务器自己的事，接缝不建模。
- **不做图片压缩**——字节原样发送；`maxInputTokens` 对超限 describe 选择拒绝而非缩小，尺寸策略由调用方（或上限更宽的下一链优先级）负责。
- **中止分类基于错误形态**——只有名为 `AbortError` 的 `DOMException`（或已中止的融合信号）映射为 `VISION_ABORTED`；其他中止形态以 `VISION_PROVIDER_ERROR` 呈现。
- **输入估算是启发式**——4 字符/token 与 750 像素/token 是粗粒度校准；守卫拦截的是明显超限的输入，而非计费级精确值。
