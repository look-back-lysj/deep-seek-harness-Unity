# EAC 市场后端协作者指南

日期：2026-09-30。本文给负责 Core、Host、目录、适配器和公共业务接口的协作者使用。普通用户请回到仓库根 README；前端协作者还要阅读 `packages/market/src/client/README.md`、`DESIGN.md` 和 `docs/handoff/DISCOVERY-FOUNDATION-2026-09-30.md`。

## 先确认当前状态

- 源码候选：桌面适配器 `@dsh-eac/market@0.1.0-mvp.10`，核心包 `@dsh-eac/market-core@0.1.0`。
- 当前正式安装包：`0.1.0-mvp.9` 单包。双包尚未替换正式发行入口，不要把本地 workspace、test-only registry 或协作分支写成用户下载地址。
- 最近前端优化提交：`df823a9`。它只修改 Client 和 `DESIGN.md`，没有修改 Core、Host、公共合同或安装协议。
- 前端已经消费可选的 `CatalogSnapshot.discovery`；没有推荐、评分、皮肤或图片数据时会隐藏对应区域或使用文字海报降级。
- 真实公网 core、正式 Desktop 新装、旧 mvp.9 升级、跨平台和 TUI 仍是待验项目。

## 阅读顺序

1. [当前接手入口](START-HERE.md)：分支、状态、真实验收边界和禁止事项。
2. [Core / Desktop Adapter 接口指南](../CORE-ADAPTER-GUIDE.md)：两包职责、公开入口、版本协商和发现页合同。
3. [发现页基础接力](DISCOVERY-FOUNDATION-2026-09-30.md)：首推、推荐皮肤、高分区和全部插件的 UI 对接约定。
4. [通用升级指南](../UPGRADE-GUIDE.md)：迁移、发布、回退和证据规则。
5. [产品要求](../PRODUCT.md)：已经确认的范围，不要用后端便利改变产品决定。

## 后端负责什么

| 区域 | 主要职责 | 前端使用方式 |
| --- | --- | --- |
| `packages/market-core/src/catalog` | 目录解析、版本、撤回、生效期、推荐投影 | Client 只读取 `CatalogSnapshot`，不重复猜测目录规则 |
| `packages/market-core/src/contracts` | 浏览器安全的输入/输出类型 | 变更必须先列消费者、兼容策略、迁移和测试 |
| `packages/market-core/src/core` | 计划、任务、锁、恢复、失败语义 | 安装按钮只调用真实 plan/task 链 |
| `packages/market-core/src/adapters/dsh` | 官方 pluginManager、库存、回执和存储适配 | 不在 Client 另造安装器 |
| `packages/market-core/src/host` | MarketBackend 组装、AI 边界、调用者身份 | adapter 传入可信身份和 profile，不接受 Client 自报 |
| `packages/market/src/index.ts` 与 `session-gate.ts` | DSH 注册、Remote 和协议协商 | 页面写操作必须先握手，协议不兼容时禁止写入 |

## 当前发现页合同

Core 可以在 `CatalogSnapshot` 上返回可选的 `discovery`：

- `featured`：首推海报卡，按 `order` 排序。
- `recommendedSkins`：推荐皮肤，目标插件必须是 `kind=skin`。
- `highScorePlugins`：高分插件；没有有效评分时省略整个字段。
- `highScoreSkills`：高分 skill；没有有效评分时省略整个字段。

每张卡绑定 `pluginId + version`，并可带 `title`、`summary`、`reason`、`source`、`order`、`score` 和 `poster`。评分只能是有来源的维护者目录事实，范围为 0 到 5；没有评分不能填 0，也不能从插件对象或用户界面猜分数。撤回、硬阻断、版本失配和过期推荐不得进入投影。

前端行为已经固定：

- `discovery` 缺失时只兼容旧 `featured` 推荐。
- 推荐皮肤、高分插件、高分 skill 没有真实数据时整块隐藏。
- `poster` 缺失、图片失败或来源不可达时显示 `title + summary` 文字卡。
- 全部插件页消费同一 `CatalogSnapshot.plugins`，不维护第二份目录。
- 不要为了填满首页返回合成推荐、默认评分、假图片或假下载量。

## 后端修改规则

- 不修改官方 DSH 源码、EAC 组织仓、真实用户 profile、凭据或真实会话日志。
- 不让 Core 依赖 React、DOM 或桌面 UI；浏览器安全合同不能导入 Node/Host 实现。
- 不给 `MarketRemote` 增加前端必需方法来解决视觉问题；优先复用现有 `catalog`、`inventory`、`capabilities` 和可选方法。
- 公共合同新增字段必须可选或有明确版本升级；旧 Host 缺字段时页面仍能读取、隐藏或降级。
- 保留 `failed`、`unknown`、`restart-required`、`partial` 等真实结果，不能压成布尔成功。
- 不把 `workspace:*`、本地路径、fixture URL 或测试 registry 作为正式依赖来源。
- 目录源、制品、许可证、来源提交和宿主验证必须分开记录；内容资料变化不能悄悄改变制品摘要。
- Core 负责事实和失败语义，Adapter 负责官方 DSH 接线，Client 负责展示和用户确认，不能跨层复制同一套业务规则。

## 开发与验证

在 `D:/eac-market` 执行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm check
```

定向目录合同测试：

```powershell
pnpm exec vitest run tests/catalog tests/core-api tests/adapter
```

UI 或合同联动后必须同时跑 Client 测试和 browser-check。真实 Desktop 验收需要使用 `D:/eac-market-verify` 新批次，不能用旧截图或本地 fixture 代替。最终包、源码提交、SHA256、宿主版本和日志必须来自同一批次。

## 提交前交接格式

请在 PR 或交接消息中写清：

1. 修改的包和文件范围；
2. 变更的输入/输出字段和旧版本行为；
3. 前端消费者、失败语义和数据降级方式；
4. 定向测试、完整测试、browser-check 和真实宿主结果；
5. 未验证项目、阻塞原因和继续路径；
6. 是否影响制品、版本、摘要、发布入口或迁移。

如果只完成内核雏形，不要写成已正式发布；如果只通过本地测试，不要写成 Desktop 或公网链路已验收。
