# DeepSeek Harness

[English](README.md) | 中文

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。

它采用**一切皆插件**的架构，并由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## 开发者预览

DeepSeek Harness 目前处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

## 运行

### 运行本检出目录

本 fork 提供一条命令完成引导，使 `dsh` 使用本地源码树（vision 插件、自定义模型 effort，以及随仓库分发的 PLN 提供方）。密钥只放在 `~/.dsh/.credentials.yaml`，永不提交。

```sh
git clone https://github.com/taotaoxu7447/deepseek-harness.git
cd deepseek-harness
./scripts/setup.sh
```

然后可在任意目录运行：

```sh
dsh web
dsh app
dsh --help
```

把 `~/.dsh/.credentials.yaml` 里的 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_PLN_API_KEY` 填一次即可。之后更新：

```sh
./scripts/setup.sh --update
```

团队默认值（提供方路由、默认模型、effort 档位）在 [`deploy/defaults.patch.yml`](deploy/defaults.patch.yml)，每次 `dsh` 启动都会应用。要改所有 clone 拿到的默认值，请改这个文件并提交；不要把 API 密钥写进去。

### 通过 `npm` 运行

安装 `Node.js`，然后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 `http://127.0.0.1:3080`。详见 [Web UI 指南](docs/user/guide/index.md)。已发布的 npm 包不包含本 fork 的 vision 插件或自定义 PLN 路由。

### 从源码运行

如需从仓库源码运行、且不使用引导脚本：

```sh
git clone https://github.com/taotaoxu7447/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 社区与支持

- 欢迎通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈或 bug 报告。
- 为你的插件仓库添加 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题，便于被发现。
- 欢迎加入 DeepSeek Harness 企微群：扫码添加企微小助手并填写入群问卷，完成后小助手会邀请你入群。

<table>
  <thead>
    <tr>
      <th align="center">企微小助手</th>
      <th align="center">入群问卷</th>
      <th align="center">微信公众号</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td align="center"><img src="assets/community-wecom-assistant.png" alt="DeepSeek Harness 企微小助手二维码" width="180" height="180"></td>
      <td align="center"><a href="https://trtgsjkv6r.feishu.cn/share/base/form/shrcnIt5twSVdLGD52KJBckGCgg"><img src="assets/community-wecom-survey.png" alt="DeepSeek Harness 入群问卷二维码" width="180" height="180"></a></td>
      <td align="center"><img src="assets/community-wechat-official-account.png" alt="DeepSeek Harness 团队微信公众号二维码" width="180" height="180"></td>
    </tr>
  </tbody>
</table>

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 开发

请先阅读[开发指南](docs/development.md)与[架构文档](docs/architecture.md)。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
