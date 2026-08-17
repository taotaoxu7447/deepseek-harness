# Agent Note：视觉链多协议、effort 预设与输入守卫

状态：已实现

[English](2026-08-17-vision-chain-protocols-effort-presets.md) | 中文

## 问题

视觉链此前只会说 OpenAI chat completions 一种协议，设置卡片每个后端也只暴露端点/key/模型。三个缺口顶在同一条接缝上：Anthropic 与 OpenAI Responses 部署完全够不到；各家的 effort 词汇不同（OpenAI 五级分档、小米 MiMo 服务端对 low/medium/high 一视同仁、本地 Qwen3 的 `chat_template_kwargs`、Anthropic 的 token 预算 thinking），没有任何单一原始控件能同时适配；也没有任何机制阻止超大图片白烧一次远程调用才被服务器拒绝。

## 决策

**每后端 `protocol`**（默认 `openai-chat`，另有 `openai-responses`、`anthropic`），在同一条链 provider 内按协议各配一对 builder/parser——而不是每种协议一个 provider 包。链的价值在于跨异构端点的优先级降级；拆包会迫使接缝注册表重新学习排序。Anthropic 同时发送 `x-api-key`、`authorization: Bearer` 与 `anthropic-version: 2023-06-01`（兼容代理可能认任一鉴权头），与 web 搜索 provider 的 Anthropic 路径一致。

**厂商 effort 预设**（`effortPreset`）而非原始 effort 字段。配置命名模型说哪家的词汇；各协议的片段函数把它映射到线路字段：`openai` → 五档 `reasoning_effort`/`reasoning.effort`；`mimo` → 关为 `none`、开为 `low`（三个分级档位服务端等效，故 UI 只给开关）；`qwen-local` → 带 `enable_thinking` 与 `thinking_budget` 的 `chat_template_kwargs`；`anthropic` → `thinking.budget_tokens`。MiMo 刻意做成预设而非协议——并不存在可供寻找的 MiMo 线路格式。schema 无法表达的跨字段规则（预设↔协议配对、anthropic 预算 ≥1024 且小于 `maxTokens`）集中在 `validateVisionConfig`，同时挂进设置段落的 `validate` 钩子（保存时拒绝，卡片保留草稿）与 `apply()`（加载时响亮失败），遵循「配置错误要响亮」。

**拒绝而非截断**：`maxTokens` 超过 `contextTokens` 时校验失败，而不是静默收窄输出预算；`maxInputTokens` 在请求发出前以 `VISION_INPUT_TOO_LARGE` 拒绝 describe，链降级到下一优先级，而不是重压缩图片。估算公式是写明了的启发式——文本 4 字符/token 加探测像素 750/token（PNG/JPEG/GIF/WebP 头部；头部不可读则回退字节数）——因为守卫的目的是拦截明显超限的输入，不是计费。

thinking/reasoning 请求在 Responses 与 anthropic-带-thinking 上省略 `temperature`，因为这两个 API 拒绝非默认采样；链的 temperature 留在 chat completions 线路上。

## 备选方案

**每种协议一个 provider 包。** 三个包会各自重实现链的优先级排序与重试预算，接缝注册表还得学会给 provider 排序——这正是链存在要消除的重复。协议是链上每个后端的属性，与 `apiKeyEnv` 同理。

**用原始 effort 字段而非厂商预设。** 没有任何单一词汇能适配：OpenAI 分五档、MiMo 服务端把其中三档等效、Qwen3 要布尔加 token 预算、Anthropic 要带 1024 下限的预算。原始字段会把各家映射推给每个用户和每条 UI 提示；预设只命名一次词汇，由各协议的片段函数掌管线路映射。

**把 `maxTokens` 截断到 `contextTokens`、重压缩超限图片。** 静默截断让已保存的配置与线路实际发送不符；拒绝让误配在写入时响亮暴露。重压缩会静默改变模型所见的图片——守卫选择拒绝，由携带自己上限的下一链优先级决定是否还能服务该输入。

## 影响

- 模型可见⟺可记录 不受影响：所有新参数只走 sidecar HTTP 请求；会话日志仍只记录 `view_image` 调用及其结果，从不记录 sidecar 线路。
- 设置卡片的新行字段随同一段落保存；行内探测携带其 `protocol`，因此模型发现能正确命中 `/models`（OpenAI）或 `/v1/models`（Anthropic，双鉴权头）。
- 卡片控制器改为单一 `entries` 数组（行 + key 草稿 + 数字草稿 + 探测状态），取代锁步移动的平行数组——锁步不变量曾滋生不可达的防御分支与一条探测失败的崩溃路径。
- `VisionCard` 不再传 `onReset`（列表编辑器的字段永远不可能处于覆盖态）；`FieldProps.onReset` 恰为这种情况改为可选。
- 封闭联合的 `assertNever` 默认分支携带 `v8 ignore` 理由，而不是构造恶意类型转换的测试，与既有 compaction 包一致。

关联：[2026-08-16-vision-sidecar-seam](2026-08-16-vision-sidecar-seam.md)。
