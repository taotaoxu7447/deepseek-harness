# @deepseek-ai/dsh-vision-qwen

[English](README.md) | 中文

面向 Harness [视觉能力接缝](../vision/README.md)(`ctx.vision`)的 `VisionProvider`,由一个提供 Qwen 视觉模型的 OpenAI 兼容 `/chat/completions` 端点支撑 —— 本地 vLLM/SGLang 部署,或任何讲同一线上格式的服务器。图片以 base64 data URL 随请求发送;回复文本即描述。

这是一个**实现**包:它向 `ctx.vision` 注册 Provider,不拥有 `ctx.vision` 键,也不注册面向模型的工具(那是 [`dsh-tool-vision`](../tool-vision/README.md))。它是函数/命名空间插件(`inject: ['vision']`),注册自己的后端,而非默认导出的服务。

连接事实按调用解析,分层:`cordis.yml` 条目配置在下,可选的 `vision-qwen` 用户设置小节(`ctx.settings`,即网页 **设置 → 插件 → 视觉** 卡片)在上,API Key 经凭据接缝解析。模型、端点、启用状态或密钥的变更无需重启即在下一次 describe 生效。未配置 `model`/`baseURL` 的组合只是停驻 Provider(已注册但拒绝选择,错误信息指向设置页),不会导致加载失败:设置卡片就是完成配置的预期位置。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `id` | `qwen` | 本实例注册所用的注册表 id;每个组合实例各自不同。 |
| `settingsSection` | `vision-qwen` | 本实例拥有的设置小节名;每个组合实例各自不同,且需对可编辑的客户端开放。 |
| `enabled` | `true` | 为 false 时停驻 Provider:已注册但拒绝选择。对应设置卡片的开关。 |
| `model` | (未设置) | 端点提供的视觉模型 id。唯一没有默认值的字段;未设置即停驻。 |
| `baseURL` | `$QWEN_BASE_URL` | 端点前缀;后接 `/chat/completions`。未设置即停驻。 |
| `apiKey` | (未设置) | 字面 API 密钥;优先用 `apiKeyEnv`,避免密钥进入配置文件。空字符串视为未设置。 |
| `apiKeyEnv` | `QWEN_API_KEY` | 每次 describe 解析的凭据引用。解析为空时不发送 `Authorization` 头 —— 无密钥的本地端点无需任何密钥。 |
| `instruction` | 内置 | describe 调用的系统指令。默认指令面向编码代理,要求事实性、以转写为主的描述。 |
| `temperature` | `0.2` | 采样温度,区间 `[0, 2]`。 |
| `maxTokens` | `1024` | 单次描述的补全预算(token)。 |
| `timeoutMs` | `60000` | 单次 describe 调用的 HTTP 预算;超时映射为 `VISION_ABORTED`。 |

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

组合时无需任何配置:在插件设置卡片上完成配置(启用、模型、接口地址、密钥),值持久化到用户设置文档并即时生效。

## 多后端

每个视觉后端组合一次本插件 —— 第二行带上自己的 `id`、`settingsSection` 与 `apiKeyEnv`(让每张卡片的密钥控件写入各自的凭据),即获得独立的设置卡片:

```yaml
- id: vision-chatgpt
  name: '@deepseek-ai/dsh-vision-qwen'
  config:
    id: chatgpt-luna
    settingsSection: vision-chatgpt
    apiKeyEnv: CHATGPT_API_KEY
    enabled: false
```

选择即启用开关:恰好启用一个后端时它为 `view_image` 服务;未加接缝 `provider` 固定而同时启用多个时以 `VISION_PROVIDER_AMBIGUOUS` 拒绝(停驻其一),一个都不启用时为 `VISION_PROVIDER_UNAVAILABLE`。

## Wire mapping

请求是一次非流式 chat completion:`model`;承载 `instruction` 的 system 消息;一条 user 消息,内容为 `[image_url(data URL), text(prompt ?? "Describe this image in detail.")]`;`max_tokens`;`temperature`;`stream: false`。回复经 `choices[0].message.content` 映射 —— 纯字符串,或把数组中的 `text` 部分连接 —— 得到 `VisionDescription.text`;`content` 为空时依次回退 `reasoning_content`、`reasoning`,因为以 OpenAI 兼容方式服务的思考型模型有时把全部答案放在推理字段;`VisionDescription.model` 优先取服务器上报的 `model`,否则用配置 id。描述缺失或不可用时抛出 `VisionError` `VISION_PROVIDER_ERROR`。HTTP 错误优先呈现服务器嵌套的 `error.message`(字符串或对象)或顶层 `message`,否则回退到状态行;网络与响应体解析失败为 `VISION_PROVIDER_ERROR`;调用方取消与 Provider 自身超时为 `VISION_ABORTED`。HTTP 重定向在接触 `Location` 目标之前即被拒绝。

## Model Experience

间接地,通过 [`dsh-tool-vision`](../tool-vision/README.md) —— 该 Consumer 把本 Provider 的描述文本与实际服务的模型归属渲染进 `view_image` 工具结果。每次 describe 都是对侧车端点的独立请求,从不直接进入主模型的请求。

#### KV Cache effect

不直接使主模型缓存失效;侧车请求独立进行。主请求前缀的任何变化由上述 Consumer 拥有。

## Known Limitations and Deferred Work

- **每次调用一张图片、侧车无状态** —— 端点对每次 describe 独立处理;跨调用的图像 token 缓存属于服务器行为,接缝不建模。
- **不做图片缩放** —— 字节在附件策略的字节上限内原样发送;超大图片的成本取决于服务器。
- **中止判定基于错误形态** —— 只有名为 `AbortError` 的 `DOMException`(或已中止的融合信号)映射为 `VISION_ABORTED`;其他中止形态呈现为 `VISION_PROVIDER_ERROR`。
- **仅支持 OpenAI 兼容协议** —— 原生厂商协议(DashScope 多模态、Anthropic 内容块)有待单独的 Provider 包。
