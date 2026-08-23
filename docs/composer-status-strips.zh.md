# Composer 状态条参考

[English](composer-status-strips.md) | 中文

本文规定在消息输入框上方注册到 `conversation.input.dock` slot 的独立状态条或摘要条应遵循的布局、视觉、响应式与交互规则。[web-styling.md](web-styling.zh.md) 中的 Web UI 规则仍负责 token 与组件 CSS；本文只负责状态条这一组件家族。

## 适用范围

当一项信息可在收起时压缩成一行、供用户快速扫读，并可在下方展开有限详情时，使用这一组件家族。内建 Todo 状态条是视觉基线；操作面板、常驻表单以及无法压缩成单行摘要的内容应放入设置视图、侧边栏、对话框或其他专用 slot。

本规范适用于独立卡片。Queue 面板是与输入卡片相连的表面：它可以抵消父级间距并把下方圆角改为直角，因为输入卡片会闭合这个形状。第三方状态条不得复制这一例外。

## 放置与职责

每个条目使用稳定的 `id` 和显式整数 `order` 注册。`order` 只控制顺序，不得改变高度、缩进或间距。

`composerStack` 所有方以 `gap: 6px` 提供纵向节奏。条目必须使用 `margin: 0`，不得自行增加上下间距，否则组件 margin 会与父级 gap 叠加，使相邻条目的距离变大。

直接使用宿主提供的 `--dsh-composer-side-clearance`、`--dsh-composer-dock-inset` 与 `--dsh-composer-card-max-width` 变量，不得设置私有数值回退。可见卡片的宽度从可用宽度中减去两侧 clearance 与四个 dock inset，最大宽度则从输入卡片最大宽度中减去四个 dock inset。不得先在包装层减去两个 inset、再增加带 padding 的包装层，除非最终可见卡片解析出的几何尺寸完全相同。

## 几何尺寸

| 部位 | 必需值 | 说明 |
|---|---:|---|
| 可见卡片宽度 | 输入卡片宽度减 32px | 当前四个宿主 dock inset 均为 8px；使用变量，不要使用解析后的数值 |
| 条目间距 | 6px | 由 `composerStack` 所有；条目 margin 保持为零 |
| 卡片边框 | 1px | 位于 36px 内层行之外 |
| 卡片圆角 | 12px | 应用于可见表面 |
| 收起时内层行 | 36px | 24px 内容行加上下各 6px padding |
| 收起时可见高度 | 38px | 内层行加上下两条 1px 边框 |
| 水平 padding | 12px | 左右对称 |
| 元素间距 | 10px | 位于前导图标、标题、摘要与尾部控件之间 |
| 前导图标 | 14px，置于 16px 单元中 | 装饰图标使用 `aria-hidden` |
| 展开内容间距 | 8px | 位于表头与第一行详情之间 |
| 展开内容最大高度 | 180px | 更长的详情列表在卡片内滚动 |

以下几何样式是独立卡片的参考实现。插件可以使用不同的类名，但最终解析出的可见几何尺寸必须一致。

```css
.dock {
  box-sizing: border-box;
  flex: none;
  width: calc(
    100% -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-side-clearance) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  max-width: calc(
    var(--dsh-composer-card-max-width) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset) -
    var(--dsh-composer-dock-inset)
  );
  margin: 0 auto;
}

.surface {
  box-sizing: border-box;
  overflow: hidden;
  width: 100%;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-specific-tip);
}

.summary {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;
  padding: 6px 12px;
}
```

## 收起内容

收起状态保持为一行，并按以下顺序排列：可选前导图标、短标题、弹性摘要、可选紧凑指标与可选尾部展开控件。标题使用 13px/24px、字重 500 和主标签 token；摘要文字使用 13px/20px、字重 400 和次要或三级标签 token。

标题与尾部控件不得收缩。摘要占用弹性宽度，并使用 `min-width: 0`、`overflow: hidden`、`text-overflow: ellipsis` 与 `white-space: nowrap`。指标应从最低优先级开始逐项隐藏，之后才可以移除标题、当前状态或展开控件。

不得在收起行内放置大型品牌图块、双行标题／状态块或常驻网格。状态颜色只用于小图标、圆点、徽标或局部文字，不得给整张卡片换色。

## 表面与状态

表面使用 `--dsw-specific-tip`，边框使用 `--dsw-alias-border-l1`，内容使用语义标签或状态别名。不得添加组件专用阴影、颜色字面量、主题选择器或回退色板值。统一的背景与边框使多个独立提供的条目形成同一个视觉家族。

悬停、焦点、选中、警告与错误状态必须局限于拥有该状态的控件或状态片段。只有当一个会阻止操作的错误适用于整个条目时，才可以使用整张表面的状态样式。

## 展开与响应式状态

展开时保留同一张卡片、宽度、表头顺序与水平对齐。详情放在表头下方，间距为 8px；详情行使用 13px/20px 文字角色，并在最大高度为 180px 的区域内滚动。需要常驻高面板或无界列表的功能必须把详情视图移出输入区堆栈，只在状态条中保留紧凑摘要。

在窄宽度下，先截断弹性摘要，再按优先级隐藏次要指标。不得让收起行换行或增高。验证组合效果时至少同时显示两个 dock 条目，避免响应式规则只针对孤立组件优化。

## 交互与无障碍

可展开状态条使用一个原生按钮承载完整表头，并暴露 `aria-expanded`；展开区域与该控件保持稳定关联。不可展开状态条只为真实操作使用按钮，不得伪装成可点击表头。

为 section 或状态提供无障碍名称。把装饰图标标记为隐藏，保留清晰可见的键盘焦点，并让 spinner 或 pulse 遵循减少动态效果偏好。不得通过 live region 播报高频遥测数据；播报只用于与用户有关的状态转换。

## 评审清单

- 条目以稳定 `id` 和显式 `order` 注册到 `conversation.input.dock`。
- 可见卡片使用宿主宽度变量、12px 圆角、tip 表面和一级边框。
- 收起卡片解析为 36px 内层行与 38px 可见高度。
- 条目没有纵向 margin 或自定义阴影；父级提供 6px 堆栈间距。
- 收起内容保持单行，在改变高度之前移除低优先级指标。
- 状态颜色保持局部，所有颜色都来自语义 token。
- 展开内容有明确上限；常驻详情控件放在堆栈之外。
- 已验证键盘、焦点、展开语义、减少动态效果、明暗主题、窄宽度以及多个条目同时存在的情形。
- GUI 变更运行[测试策略](testing.zh.md)要求的检查。
