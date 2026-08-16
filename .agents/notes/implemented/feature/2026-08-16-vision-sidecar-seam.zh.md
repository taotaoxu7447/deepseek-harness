# Agent Note: 视觉侧车接缝 - 基于 describe 能力的 view_image

Status: implemented

[English](2026-08-16-vision-sidecar-seam.md) | 中文

## Problem

`deepseek-official` 路由上的 `deepseek-v4-flash` 是纯文本模型,因此 `read_image` 会拒绝:其结果携带 `ImageBlock`,而 DeepSeek chat-completions 适配器以 `UNSUPPORTED_CONTENT` 拒绝图片内容。这个拒绝是正确的 —— 在无法承载图片的路由上返回图片会破坏该路由的续跑 —— 但它让纯文本代理对所有图片文件(截图、图表、UI 抓帧)视而不见,而这正是用户带到编码 Harness 里的工作。

Harness 需要在纯文本路由上获得图像理解能力,同时不扩大主路由的线上契约。备选方案有三种:

1. 通过 `dsh-llm-pi-ai` 把视觉模型注册为第二条多模态 provider 路由,由某个工具经 `ctx.llm` 把图片送过去。
2. 在纯文本路由上拦截 `read_image` 的结果(`tools/post-execute`)做透明转写。
3. 一个专门的视觉能力接缝,配一个纯文本的 Consumer 工具。

## Decision

一个一等能力接缝,镜像 web 接缝([web capability seam](../architecture/2026-06-24-web-capability-seam.md)):

1. `@deepseek-ai/dsh-vision`(`packages/vision/vision`)拥有 `ctx.vision`:Provider 注册、执行时选择(配置 id,或恰好一个可用 Provider —— `VISION_PROVIDER_CONFIGURED_MISSING` / `_UNAVAILABLE` / `_AMBIGUOUS` / `VISION_PROVIDER_UNAVAILABLE`)、唯一的 `describe({ image: { bytes, mediaType }, prompt? })` 操作,以及 `VisionError` 分类。
2. `@deepseek-ai/dsh-vision-qwen`(`packages/vision/vision-qwen`)基于 OpenAI 兼容 `/chat/completions` 端点(本地 vLLM/SGLang Qwen VL 或等价物)实现 Provider:base64 data URL 图片部分、系统指令加聚焦提问、非流式补全、字符串或数组的 content 映射、deadline 兜底、中止/HTTP 错误分类。`model` 与 `baseURL` 无默认值 —— 它们命名一个具体部署,缺失时加载即失败;API key 为空时不发送 `Authorization` 头,因为无密钥本地端点是受支持的部署形态。
3. `@deepseek-ai/dsh-tool-vision`(`packages/vision/tool-vision`)拥有面向模型的 `view_image` 工具:经 `ctx.fs` 解析路径并读取字节,经附件服务的 `imageLimits`/`validateImage` 做准入与魔数校验(不持久化 —— 之后没有任何东西引用这些字节),然后 `ctx.vision.describe`。结果只有文本。

**校验而不持久化。** `read_image` 持久化字节,因为它的 `ImageBlock` 从会话日志引用它们;`view_image` 没有这种引用,保存只会写入无人引用的内容寻址对象。`validateImage`(魔数、解码完成、策略上限)被复用而不调 `saveImage`;会话只保留描述 —— 图片从不成为主路由的模型可见输入,故 model-visible ⟺ logged 依然成立。

**attachments 条件注册。** 与 `read_image` 相同的组合条件门:没有挂载附件服务,就没有校验字节的权威图片策略,工具不注册。

**设置驱动的配置取代加载期事实。** `vision-qwen` 经 `installSettingsSection` 把组合条目垫在 `vision-qwen` 用户设置小节之下(`llm-deepseek` / `web-search-deepseek` 的模式):Provider 按 describe 投影小节,模型、端点、启用状态与密钥的变更无需重启即达下一次调用;未配置的小节只是停驻 Provider(`available() === false`),而不是让加载失败 —— 网页插件设置卡片(启用开关、模型、接口地址、经凭据域写入的密钥)就是完成配置的预期位置。当配置界面是 UI 时,以带指向的选择拒绝替代加载期报错,才是正确的"响亮"程度。命名空间对浏览器的开放是 `WEB_SETTINGS_NAMESPACES`(`dsh-apiproxy`)中的显式决策,每个小节都必须在那里登记。

**多后端靠组合、选择靠启用。** 每个视觉后端一行插件(`id` + `settingsSection` + `apiKeyEnv` 配置)各得一张设置卡片;接缝的"恰好一个可用"规则让启用开关成为选择 —— 未加接缝 `provider` 固定而同时启用多个时以 `VISION_PROVIDER_AMBIGUOUS` 拒绝,而不猜测顺序。Provider 包保持 OpenAI 兼容的通用性(Qwen 之名是它的出身,不是它的协议)。

**粘贴图片以 view_image 指针方式桥接。** 纯文本路由上的粘贴图片不能简单放行:日志里的图片块会让后续每个请求在 DeepSeek 适配器处失败,这正是产品在门口拒绝它的原因。桥(`dsh-apiproxy` 的 `prompt`)仅在 `ctx.vision.hasUsableProvider()` 成立时放行,持久化存储后,以一行**指针**替代图片块落日志 —— 文件名、尺寸,以及给 `view_image` 的 `attachment_id` 参数。主模型自行决定何时查看、带什么聚焦问题,走与文件查看相同的优先级链;描述调用作为普通工具调用发生在回合内部,进度可见。它取代了早期的"准入即描述"草案 —— 那会把粘贴 RPC 阻塞在视觉模型的整段描述上(本地 27B Q4 需要几十秒,客户端 30 秒单次调用上限超时,转写一片空白,消息稍后才以排队形式浮现)。指针需要仅凭 id 取回字节,因此附件接缝新增 `readImageById`(存储端从字节重建规范引用)。拖拽与粘贴走同一客户端通路。遗留取舍:转写录显示指针文本而非内嵌图片预览。



## Alternatives considered

**通过 `ctx.llm` 走 `dsh-llm-pi-ai` provider 路由承载视觉模型。** 可行,但它把 Consumer 耦合到特定适配器包的组合(工具可用之前,路由必须存在并声明 `input: [text, image]`),把完整适配器面(流式、工具 schema、推理力度)拖进一次性的 describe 调用,并给侧车一个主循环的模型选择可能误路由到的 provider-route 身份。视觉侧车不是代理的另一条路由;它是代理的工具所调用的能力。接缝把线上格式留在 Provider 包里,正如搜索厂商藏在 `ctx.web` 之后。

**经 `tools/post-execute` 对 `read_image` 结果做透明转写。** `read_image` 在纯文本路由上于执行时即拒绝 —— 没有成功结果可供转写,而从外部改写另一个工具的拒绝会与它文档化的路由门作对。透明转写还向模型隐瞒了文本出自第二个模型;`view_image` 的 schema 与提示引导明说这一点,让模型对侧车结论保持应有的怀疑。

**在支持图片的路由上也返回图片块。** 一个工具,一份契约。在支持图片的路由上 `read_image` 仍是更好的工具(模型看到图片本身);`view_image` 的价值恰恰是处处可用,而其 `model` 信封行把描述归属于真正的作者。

## Consequences

**每张图、每个问题一次工具调用。** 每次 `view_image` 调用都把图片重新上传给侧车;多轮视觉推理每轮花费一次侧车请求。接缝不建模侧车状态(见 Deferred work)。

**侧车时延位于工具预算之内。** 默认 `timeoutMs` 为 120 秒,对比 Provider 的 60 秒 HTTP 兜底,大型本地模型的首 token 不会输给工具死线;两者都是配置。

**被查看的图片无法从会话恢复。** 审阅日志的人看到的是描述与路径,不是像素。若未来某个 Consumer 需要持久图片(例如 UI 卡片),它可以自行调用 `saveImage`;接缝不强制。

## Deferred work

- 按组装记录测试政策,补一个经可运行示例的免密钥 ACP/headless 快照场景(一个讲 OpenAI 兼容 describe 协议的 fixture 服务器)。
- 批量 describe(一次侧车请求多张图)与侧车侧图像 token 复用,待出现需要的 Consumer。
- 携带 path/mediaType/model 的客户端视觉结果卡片;呈现层目前渲染通用 read 卡。
- 远程图片的 `view_image`(URL 参数),待原始字节下载路径出现;今天模型需先取到磁盘。

## Open questions

- 基础 bundle 是否应像 `llm-deepseek` 那样把 `dsh-vision` + `dsh-vision-qwen` 组合进一个 settings 小节,还是保持用户补丁可选?当前:可选。
- 纯文本路由上 `read_image` 的拒绝消息是否应在 `view_image` 已注册时指向它?耦合是提示层面的、代价低,但两个工具按组合互不相识。
