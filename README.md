# Deep Seek Harness Unity · EAC 插件市场

运行在官方 DeepSeek Harness 内的 EAC 社区插件市场。当前源码最新版是 Core / Desktop Adapter 双包底座：桌面适配器保留原包名，业务逻辑拆成独立 core，方便后续维护和接入其他界面。

## 当前源码与发行状态

- 桌面适配器：`@dsh-eac/market@0.1.0-mvp.10`
- 核心包：`@dsh-eac/market-core@0.1.0`
- Core API：`1.0.0`
- 页面协议：`2.0.0`
- 目标宿主：官方 DSH `0.2.0-rc.1` / Windows x64

上述版本是当前源码候选，尚未正式发布。已完成本地测试源下的空缓存安装、官方 Web 加载和作者草稿保存验证；公网 core 获取、Desktop 全新安装及从旧版升级仍待验证。当前正式安装包是 `0.1.0-mvp.9`，它是单包版本，不会安装独立 core。

本页和 [升级指南](docs/UPGRADE-GUIDE.md) 仅保留当前有效说明。历史证据只用于追溯，不能替代当前版本验收。

## 新手安装

从 Gitee 发行站复制当前正式版本的固定 `.tgz` 地址，粘贴到官方 DSH 的「插件 → 添加插件」中的「包名或地址」。目前应安装 `0.1.0-mvp.9`；不要仅填写未发布到 npm 的包名，也不要把源码候选或仓库首页当安装包。

[打开 Gitee 最新发行说明](https://gitee.com/flowing-shadows-like-scenes/deep-seek-harness-unity-mirror)

安装完成后点击「立即启用」，然后完整退出并重新启动 DSH。打开侧边栏 EAC，使用「发现 / 全部插件 / 我的插件」三个主导航。

双包正式发布后，用户仍只安装桌面适配器，官方包管理器负责取得 core。首次获取依赖仍需联网，本地 `.tgz` 不等于完整离线包。

## 结构和维护入口

| 路径 | 职责 |
| --- | --- |
| `packages/market` | DSH bundle、桌面 UI、Remote、协议协商和随包目录 |
| `packages/market-core` | 业务规则、安装计划、任务恢复、目录、交付、作者资料和 DSH 适配门面 |
| `docs/CORE-ADAPTER-GUIDE.md` | 两包职责、公开 API、版本协商、发布和后续 TUI 边界 |
| `docs/UPGRADE-GUIDE.md` | 当前版本唯一升级指南 |
| `docs/handoff/CORE-ADAPTER-2026-09-29.md` | 本批真实测试、包摘要和未验范围 |
| `docs/handoff/START-HERE.md` | 下一位维护者接手入口 |

普通用户不需要接触源码、Node、pnpm 或 core 包。维护者只使用包 `exports` 中的公开入口；不要直接导入 `lib` 或跨包源码路径。

## 当前能力

- 浏览、搜索、筛选、详情和我的插件。
- 通过官方 pluginManager 执行预检、安装、启用、停用、卸载和重启等待。
- 皮肤中心、作者本地图文编辑、README 导入、资料 ZIP 导出和受限 AI 提案。
- Core 与桌面 UI 分开维护；以后可以在同一业务接口上增加 TUI adapter。

市场不代表 DeepSeek 官方认证，不包含在线作者投稿、自动 Star、任意命令执行或 TUI 成品。没有真实验证的第三方业务和未来 DSH 版本不会被标记为已支持。

## 从源码构建

维护环境：Node.js 24+、pnpm 11.7.0。普通用户不需要安装这些开发工具。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
```

双包发行必须明确 core 的真实来源：

```powershell
pnpm pack:release --out-dir D:/eac-market-verify/release-candidate --core-url "https://发行主机/固定提交/artifacts/sha256/{sha256}/{filename}"
```

发行脚本只准备本地候选，不上传、不修改 npm 配置，也不把 `workspace:*` 官方 DSH peer 固化为开发机版本。完整流程见 [最新版升级指南](docs/UPGRADE-GUIDE.md)。

## 许可和协作

插件作者先读 [作者 / Agent 投稿指南](docs/contributing/AGENT-SUBMISSION.md)，维护者先读 [文档总目录](docs/index.md)。投稿范围、审核规则和固定制品要求不因拆包改变。

市场代码按仓库许可证发布；目录中的插件和皮肤继续遵循各自 LICENSE/NOTICE。协作前先读 [接力入口](docs/handoff/START-HERE.md) 和 [Core / Adapter 底座指南](docs/CORE-ADAPTER-GUIDE.md)。
