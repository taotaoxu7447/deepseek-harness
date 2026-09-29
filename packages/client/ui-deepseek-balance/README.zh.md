---
description: "官方 DeepSeek API 余额输入栏胶囊：峰谷配色的余额芯片带消费弹层，以及侧栏开关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-deepseek-balance

[English](README.md) | 中文

## 摘要

`dsh-client-ui-deepseek-balance` 把官方 DeepSeek API 账户余额渲染为模型选择器旁的紧凑芯片。芯片按当前计费时段（北京时间峰/谷）配色；点击打开弹层，展示 Host 服务聚合的每日与每月消费柱状图。侧栏底部开关控制胶囊显示，并通过 Host 写入存储的 `enabled` 标志，条目的 Settings 表单始终是唯一权威。

## 配置

无。胶囊读取 `@deepseek-ai/dsh-deepseek-balance` 提供的 `deepseekBalance` Remote 命名空间（`read`、`setEnabled`）；密钥引用、端点与开关默认值都在该 Host 条目的 Settings 表单里。

## 模型体验

无。胶囊不触碰会话内容，也不注册任何模型向接口。

#### KV Cache 效应

无 — 余额读取经 Host 独立查询官方计费端点，从不改动模型提示词。

## 已知限制与后续工作

- **单一币种** — 官方 API 同时返回 CNY 与 USD 时，胶囊显示 CNY。
- **分钟级轮询** — 挂载期间每分钟轮询一次并在连接重置时重读；Host 侧有五秒 TTL 缓存。
