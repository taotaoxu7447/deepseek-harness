# @deepseek-ai/dsh-vision

[English](README.md) | 中文

视觉能力接缝(`ctx.vision`)的 Service Definition:一个 Provider 注册表和唯一的 `describe` 操作,通过可替换的视觉模型后端把一张编码图片加可选的聚焦提问转换为面向模型的文本。它存在的意义是让纯文本主路由(例如 `deepseek-v4-flash`)也能推理图片文件:侧车视觉模型生成描述,主模型把它当作普通工具结果文本来消费。

本包拥有 `ctx.vision` 键。它不带任何 Provider(请挂载一个,例如 [`dsh-vision-qwen`](../vision-qwen/README.md)),也不注册面向模型的工具(那是 [`dsh-tool-vision`](../tool-vision/README.md) 的职责)。

## Service API

`VisionRuntime extends Service`,注册为 `ctx.vision`:

- `registerProvider(provider: VisionProvider): () => void` —— 按 `id` 注册一个后端;重复 id 抛出 `VisionError` `VISION_DUPLICATE_PROVIDER`。返回的清理函数负责注销;注册本身是一个 effect,注册它的插件被销毁时同样会回退。
- `describe(request: VisionDescribeRequest, signal?: AbortSignal): Promise<VisionDescription>` —— 在调用时解析 Provider 后委托执行。`request` 为 `{ image: { bytes, mediaType }, prompt? }`;结果为 `{ text, model }`。

`VisionProvider` 即 `{ id, available(): boolean, describe(request, signal?) }`。Provider 不校验图片本身:媒体类型与字节上限校验属于调用方 —— `view_image` 在描述之前先走附件服务的图片策略。

选择语义(与注册顺序无关):配置了 `provider` id 时,它必须已注册且可用(否则 `VISION_PROVIDER_CONFIGURED_MISSING` / `VISION_PROVIDER_CONFIGURED_UNAVAILABLE`);未配置时,必须恰好有一个可用 Provider(没有则 `VISION_PROVIDER_UNAVAILABLE`,多个则 `VISION_PROVIDER_AMBIGUOUS`)。

## Config

| 键 | 默认值 | 含义 |
|---|---|---|
| `provider` | (未设置) | 为 `describe` 指定 Provider id。未设置时,恰好注册了一个可用 Provider 则自动选中。 |

## 粘贴图片准入桥

网页宿主(`dsh-apiproxy`)在图片准入时咨询本接缝:纯文本模型路由上,粘贴或拖入的图片默认被拒(`MODEL_DOES_NOT_SUPPORT_IMAGES`),除非 `hasUsableProvider()` 成立 —— 此时图片经校验与持久化存储,会话里以一行**指针**替代图片块落地:文件名、尺寸、媒体类型,以及取回它的 `view_image` `attachment_id` 参数。主模型自行决定何时(以及带哪个聚焦问题)查看,走与其他查看相同的优先级链,因此准入瞬时完成,视觉调用作为普通工具调用发生在回合内部。若在准入时描述,粘贴将被视觉模型阻塞;指针让 `view_image` 保持唯一通路。附件接缝为此新增了 `readImageById`:指针只带 id,存储端从字节重建规范引用。

## Extension points## Extension points

注册另一个 `VisionProvider` 实现即可替换或增加视觉后端(云端 VL API、另一台本地服务器),无需改动 Consumer。`available()` 参与选择;需要凭据的 Provider 在拿到凭据前返回 `false`。

## Model Experience

间接地,通过 [`dsh-tool-vision`](../tool-vision/README.md) —— 该 Consumer 把本接缝返回的 `VisionDescription` 文本与 `model` 归属渲染进模型可见的 `view_image` 工具结果。

#### KV Cache effect

无直接失效;由上述 Consumer 拥有请求前缀的任何变化。

## Known Limitations and Deferred Work

- **每次 describe 只描述一张图片** —— 把多张图片批量送入一次侧车请求,有待出现需要该能力的 Consumer;当前工具每次调用描述一个文件。
- **侧车无会话、无状态** —— 每次 `describe` 相互独立;复用已缓存图像 token 的多轮视觉追问需要接缝未建模的 Provider 侧状态。
