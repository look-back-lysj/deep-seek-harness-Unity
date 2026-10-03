# Deep Seek Harness Unity · EAC 插件市场

运行在官方 DeepSeek Harness 内的 EAC 社区插件市场。当前源码采用 Core / Desktop Adapter 双包结构：桌面适配器保留原安装身份，业务规则放在独立 Core，Client 只消费 Remote 和公开合同。

> **当前唯一有效入口**：先读 [当前接手入口](docs/handoff/START-HERE.md)。旧阶段报告、旧计划和旧 UI 记录已经移到 `docs/handoff/archive/2026-09-legacy/`，只能追溯，不能作为当前操作指南。

## 当前状态

- 源码候选：`@dsh-eac/market@0.1.0-mvp.17`
- 源码候选：`@dsh-eac/market-core@0.1.6`
- Core API：`1.0.0`
- 页面通信协议：`2.0.0`
- 目标宿主：官方 DSH `0.2.0-rc.1` / Windows x64
- 当前正式可安装版：`0.1.0-mvp.9` 单包

`mvp.17` 和 Core `0.1.6` 已生成 Registry / GitHub 双通道候选；Registry 通道仍需发布 Core 后才能供普通用户安装。双包已经完成本地测试源空缓存安装、官方 Web 加载和作者草稿保存验证；公网 Core 来源、官方 Desktop 全新安装、旧版升级和跨平台仍需独立验收。

## 协作者从这里开始

| 角色 | 必读入口 |
| --- | --- |
| 所有维护者 | [当前接手入口](docs/handoff/START-HERE.md) → [最新版升级指南](docs/UPGRADE-GUIDE.md) |
| Core / Host / 目录 / DSH 适配器 | [后端协作者指南](docs/handoff/BACKEND-CONTRIBUTOR-GUIDE-2026-09-30.md) → [Core 新增能力补齐计划（方案 A v1.2）](docs/handoff/CORE-NEW-CAPABILITIES-PLAN-2026-10-01.md) |
| Client / UI | [Client 维护边界](packages/market/src/client/README.md) → [DESIGN.md](DESIGN.md) → [当前交互审查](docs/handoff/INTERACTION-AUDIT-2026-09-30.md) |
| 包合同与发布 | [Core / Desktop Adapter 底座指南](docs/CORE-ADAPTER-GUIDE.md) |
| 插件作者 | [作者 / Agent 投稿指南](docs/contributing/AGENT-SUBMISSION.md) |

后端协作必须遵守：Core 不依赖 React/DOM；Client 不重复实现目录、安装计划或官方管理器；`CatalogSnapshot.discovery` 是可选投影，缺少真实推荐、评分或媒体数据时不生成假数据；`failed`、`unknown`、`restart-required` 等结果必须保留。

## 双通道候选安装

普通用户只下载一个前端插件包。官方 DeepSeek Harness 会根据包内依赖自动下载 Core，并在安装后启用前端 bundle。

### A：npm Registry 通道

- 前端：`@dsh-eac/market@0.1.0-mvp.17`
- 自动依赖：`@dsh-eac/market-core@0.1.6`
- 状态：候选包已生成；Core 发布到 npm Registry 后才能正式使用。

### B：GitHub 固定地址通道

- 前端：`@dsh-eac/market@0.1.0-mvp.17-github.1`
- 自动依赖：GitHub 固定 commit 中的 Core `0.1.6` 内容寻址文件
- 前端包：`releases/0.1.0-mvp.17-dual/dsh-eac-market-0.1.0-mvp.17-github.1.tgz`

两个通道都只需要把一个前端 `.tgz` 填入官方 DSH 的「插件 → 添加插件」。不要单独安装 Core。安装后完整退出并重新启动 DSH。

## 代码边界

| 路径 | 职责 |
| --- | --- |
| `packages/market` | DSH bundle、Client UI、Remote、协议协商和随包目录 |
| `packages/market-core` | 目录、预检、安装计划、任务恢复、作者资料、AI 提案和官方适配门面 |
| `packages/market/src/client` | 发现页、全部插件、详情、任务、皮肤和作者工具；只消费现有 Remote |
| `docs/handoff/START-HERE.md` | 当前接手顺序、禁止事项和验证入口 |
| `docs/UPGRADE-GUIDE.md` | 当前唯一升级、构建、发布和回退指南 |

普通用户不需要安装 Node、pnpm 或 Core。维护者只能使用包 `exports` 中的公开入口，不直接导入 `lib` 或跨包源码路径。

## 当前能力

- 发现页首推海报、推荐皮肤、高分插件、高分 Skill；缺少真实数据的区块自动隐藏。
- 全部插件目录支持搜索、用途、安装状态、验证状态和排序。
- 通过官方 pluginManager 执行预检、安装、启用、停用、卸载和重启等待。
- 任务、皮肤切换、作者草稿、README 导入、资料 ZIP 和受限 AI 提案均保留真实失败语义。

市场不代表 DeepSeek 官方认证，不包含在线作者投稿、自动 Star、任意命令执行或 TUI 成品。没有真实验证的第三方业务和未来 DSH 版本不会被标记为已支持。

## 从源码构建

维护环境：Node.js 24+、pnpm 11.7.0。

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm typecheck
```

Registry / GitHub 双通道候选必须分别通过隔离发行脚本准备，并明确 Core 的固定来源：

```powershell
pnpm pack:release --out-dir D:/eac-market-verify/release-candidate --core-url "https://发行主机/固定提交/artifacts/sha256/{sha256}/{filename}"
```

完整流程以 [最新版升级指南](docs/UPGRADE-GUIDE.md) 为准。脚本只准备候选，不上传、不修改 npm 配置，也不把 `workspace:*` 固化成开发机版本。

## 文档与协作

[文档总目录](docs/index.md) 只列当前有效文档和历史归档入口。任何日期较早的报告都不能覆盖当前接手入口的版本、路径和未验证边界。协作前先读 [接手入口](docs/handoff/START-HERE.md) 和 [Core / Adapter 底座指南](docs/CORE-ADAPTER-GUIDE.md)。
