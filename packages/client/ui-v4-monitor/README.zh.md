---
description: "DeepSeek V4 Flash 集群输入栏状态条：实时 slot 状态、解码速率与最近任务，由 Host 经 ds-dash 监控提供。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-v4-monitor

[English](README.md) | 中文

## 摘要

`dsh-client-ui-v4-monitor` 把 DeepSeek V4 Flash 实时集群状态渲染为输入框上方的状态条。折叠时每个 slot 一条紧凑行，带上下文用量条与解码速率；展开时显示每 slot 卡片（上下文用量、预填进度、解码 tok/s）与最近完成的任务。Host 服务探测 ds-dash 监控端点并按配置间隔驱动状态条；侧栏底部开关控制显示，并通过 Host 写入存储的 `enabled` 标志。

## 配置

无。状态条读取 `@deepseek-ai/dsh-v4-monitor` 提供的 `v4Monitor` Remote 命名空间（`read`、`setEnabled`）；监控地址、邀请码、轮询间隔与折叠默认值都在该 Host 条目的 Settings 表单里。

## 模型体验

无。状态条不触碰会话内容，也不注册任何模型向接口。

#### KV Cache 效应

无 — 监控读取经 Host 独立查询 ds-dash 遥测端点，从不改动模型提示词。

## 已知限制与后续工作

- **按需轮询** — 仅挂载期间轮询，按 Host 配置间隔（默认 2 秒），连接重置时重读。
- **邀请码安全** — 邀请码只留在 Host 侧；响应只携带集群状态。
