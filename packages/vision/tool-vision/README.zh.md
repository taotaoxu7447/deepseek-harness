# @deepseek-ai/dsh-tool-vision

[English](README.md) | 中文

面向模型的 `view_image` 工具,构建于 Harness [视觉能力接缝](../vision/README.md)(`ctx.vision`)之上:通过 `ctx.fs` 读取 PNG/JPEG/WebP/GIF 文件,经附件服务按部署的图片策略校验(不落盘),请挂载的视觉模型描述它,并以文本返回描述。

结果只有文本,因此 `view_image` 在任何模型路由上都可用 —— 包括纯文本路由(例如 `deepseek-official` 上的 `deepseek-v4-flash`),而在这些路由上 `read_image` 会因其图片块无法传输而拒绝。在支持图片输入的路由上,`read_image` 仍是更好的工具:模型看到的是图片本身。

本包拥有 schema、校验、提示引导与呈现,从不包含具体的视觉后端(请挂载诸如 [`dsh-vision-qwen`](../vision-qwen/README.md) 的 Provider)。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `120000` | 协作式工具调用预算,由 `@deepseek-ai/dsh-tool-call-timeout-policy` 执行。宽裕地高于 Qwen Provider 默认的 60 秒 HTTP 预算。 |
| `maxOutputChars` | `8192` | 完整渲染工具输出的上限;被截断的描述追加截断脚注。 |

```yaml
- id: vision
  name: '@deepseek-ai/dsh-vision'
- id: vision-qwen
  name: '@deepseek-ai/dsh-vision-qwen'
- id: tool-vision
  name: '@deepseek-ai/dsh-tool-vision'
```

在网页 **设置 → 插件 → 视觉** 卡片上配置提供方(启用、模型、接口地址、密钥);取值无需重启即生效。

只有当 `attachments` 服务挂载时工具才会注册(与 `read_image` 相同的组合条件门):没有它,部署就没有校验字节的权威图片策略。执行阶段的门都在任何文件系统 I/O 之前:扩展名必须声明图片媒体类型、部署必须接纳该类型、附件服务的魔数校验必须确认声明格式 —— 不匹配时给出改名或转换的提示,而不发起侧车调用。

## Model Experience

### System prompt

#### 模型看到什么

工具注册期间,贡献下方的 view-image 引导。

##### 逐字的 view-image 引导

```markdown
Use the view_image tool to understand what a PNG/JPEG/WebP/GIF image file looks like: it sends the image to a separate vision model and returns a detailed text description, with any text in the image transcribed. Pass the optional question argument when you need one specific fact. The description comes from another model; treat surprising claims as worth verifying when the file itself is available.
```

#### Token effect

工具注册期间每次请求固定引导开销;即使作用域限制隐藏了它的 schema,该开销依然存在。

#### KV Cache effect

在工具、作用域与引导文本不变时前缀稳定;插件生命周期(含 attachments 条件注册)可能使复用从本节起失效。

### Tool schemas

#### 模型看到什么

模型看到生成的 [`view_image` schema](../../../docs/tool-catalog.md#deepseek-aidsh-tool-vision)。输出上限是部署设置,不是模型参数。

#### Token effect

每次请求固定 schema 开销;注册组合变化或作用域限制会移除它。

#### KV Cache effect

定义及其可见性不变时前缀稳定;插件生命周期或作用域限制可能使复用从首个变化的 schema token 起失效。

### View result

#### 模型看到什么

一次成功的查看严格为 `<path><displayPath></path>`、`<model><servedVisionModel></model>`、`<description>`、Provider 生成的描述文本、`</description>`,逐行排列。被上限截断的描述追加空行与 `(Description truncated by the view_image output cap.)`;失败呈现为 `Error: <message>`(空白路径、非图片扩展名、被拒绝的媒体类型、文件缺失或非常规文件、格式不匹配、`VISION_*` Provider 失败)。调用参数留在调用历史中;图片本身从不进入主请求。

#### Token effect

Provider 以 `maxTokens` 限制描述长度;渲染结果受 `maxOutputChars` 限制;保留的调用结果在压缩前持续重发。

#### KV Cache effect

只追加;新可见内容位于可复用请求前缀之后,不使既有 KV-cache 条目失效。侧车 describe 调用是一次独立的模型请求,对主缓存无影响。

## Known Limitations and Deferred Work

- **仅支持本地文件** —— `view_image` 接收由 `ctx.fs` 解析的路径;查看远程图片需先下载到磁盘(目前没有原始字节下载工具)。
- **被查看的图片不做持久化** —— 只有描述进入日志;与 `read_image` 不同,没有附件引用进入会话(纯文本路由本来也无法承载它)。
- **UI 没有图片卡片** —— 呈现层渲染通用 read 卡片;携带路径与模型的视觉结果卡片有待尚不存在的客户端卡片类型。
- **尚无免密钥快照场景** —— 包测试与真实 Loader 守卫覆盖了组装路径;经可运行示例的 ACP/headless 快照推迟到 `examples/` 落地 fixture 服务器之后。
