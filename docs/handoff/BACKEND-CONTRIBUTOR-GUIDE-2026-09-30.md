# EAC 市场后端协作者指南

更新时间：2026-09-30。本文给负责 Core、Host、目录、DSH 适配器和公共业务接口的协作者使用。普通用户先读仓库根 [README](../../README.md)；前端协作者再读 [Client 维护边界](../../packages/market/src/client/README.md)、[DESIGN.md](../../DESIGN.md) 和 [当前交互审查](INTERACTION-AUDIT-2026-09-30.md)。

## 先确认当前状态

- 源码候选：`@dsh-eac/market@0.1.0-mvp.10` + `@dsh-eac/market-core@0.1.0`。
- 当前正式安装包：`0.1.0-mvp.9` 单包。双包候选不能写成用户下载地址。
- 当前 Client 已完成发现页、完整插件目录、详情、任务、皮肤和作者工具的前端交互收口；动作反馈使用现有 Remote/Core 返回值，不新增后端必需字段。
- 当前 Client 新增的前端状态层位于 `packages/market/src/client/action-state.ts` 和 `action-feedback.tsx`，不改变 Core contracts。
- 真实公网 Core、官方 Desktop 全新安装、旧 mvp.9 升级、跨平台和 TUI 仍需独立验收。

## 阅读顺序

1. [当前接手入口](START-HERE.md)：当前分支、范围、禁止事项和验证入口。
2. [Core / Desktop Adapter 底座指南](../CORE-ADAPTER-GUIDE.md)：两包职责、公开入口、版本协商和发现页合同。
3. [最新版升级指南](../UPGRADE-GUIDE.md)：迁移、发布、回退和证据规则。
4. [产品要求](../PRODUCT.md)：已确认范围，不用后端便利改变产品决定。
5. [当前交互审查](INTERACTION-AUDIT-2026-09-30.md)：Client 消费的失败语义和下一步反馈。

## 后端负责什么

| 区域 | 主要职责 | 前端使用方式 |
| --- | --- | --- |
| `packages/market-core/src/catalog` | 目录解析、版本、撤回、生效期、推荐投影 | Client 只读取 `CatalogSnapshot`，不重复猜目录规则 |
| `packages/market-core/src/contracts` | 浏览器安全的输入/输出类型 | 变更必须先列消费者、兼容策略、迁移和测试 |
| `packages/market-core/src/core` | 计划、任务、锁、恢复、失败语义 | 安装按钮只调用真实 plan/task 链 |
| `packages/market-core/src/adapters/dsh` | 官方 pluginManager、库存、回执和存储适配 | Client 不另造安装器 |
| `packages/market-core/src/host` | MarketBackend 组装、AI 边界、调用者身份 | Adapter 传入可信身份和 profile，不接受 Client 自报 |
| `packages/market/src/index.ts`、`session-gate.ts` | DSH 注册、Remote 和协议协商 | 页面写操作先握手，协议不兼容时禁止写入 |

Core 负责事实和失败语义，Adapter 负责官方 DSH 接线，Client 负责展示、确认和恢复动作。不要把同一套业务规则复制到两层。

## 当前发现页合同

Core 可以在 `CatalogSnapshot` 上返回可选的 `discovery` 投影：

- `featured`：首推海报卡，按 `order` 排序；可带 `poster`，缺图时前端显示标题和简介文字卡。
- `recommendedSkins`：推荐皮肤，目标插件必须是 `kind=skin`。
- `highScorePlugins`：高分插件；没有有效来源评分时省略字段。
- `highScoreSkills`：高分 skill；没有有效来源评分时省略字段。

每张卡必须绑定 `pluginId + version`，并可带 `title`、`summary`、`reason`、`source`、`order`、`score` 和 `poster`。评分是维护者目录事实，范围为 0 到 5；没有评分不能填 0，也不能从插件对象或 UI 猜分。撤回、硬阻断、版本失配和过期推荐不得进入投影。

前端固定行为：

- `discovery` 缺失时隐藏相应区块；旧 `featured` 数据只做兼容读取。
- 推荐皮肤、高分插件、高分 skill 没有真实数据时整块隐藏。
- `poster` 缺失、图片失败或来源不可达时降级为标题和简介文字卡。
- 全部插件页消费同一 `CatalogSnapshot.plugins`，不维护第二份目录。
- 不返回合成推荐、默认评分、假图片或假下载量来填首页。

## Client 动作状态与后端返回值

Client 只把真实返回映射为展示状态，不改变后端枚举：

| 后端结果 | Client 下一步 |
| --- | --- |
| `failed` | 展示错误原因，允许在确认环境后重试 |
| `unknown` | 先重新读取真实状态，禁止自动重放写入 |
| `restart-required` | 提示保存工作、重启 DSH、再读取 |
| `partial` | 保留已完成项，逐项显示失败项 |
| `awaiting-approval` | 展示脚本清单和明确授权按钮 |
| `awaiting-resume` | 展示重启后核对按钮 |
| 作者 revision 冲突 | 保留当前编辑，重新读取后再决定覆盖 |

新增后端状态时，先在合同和测试中定义它的真实含义，再补 Client 映射；不能只加颜色或一个“失败”布尔值。

## 后端修改规则

- 不修改官方 DSH 源码、EAC 组织仓、真实用户 profile、凭据或真实会话日志。
- 不让 Core 依赖 React、DOM 或桌面 UI；浏览器安全合同不能导入 Node/Host 实现。
- 不为视觉问题新增 Client 必需 Remote 方法；优先复用现有 `catalog`、`inventory`、`capabilities` 和可选方法。
- 公共合同新增字段必须可选或有明确版本升级；旧 Host 缺字段时页面仍能读取、隐藏或降级。
- 保留 `failed`、`unknown`、`restart-required`、`partial` 等真实结果，不能压成布尔成功。
- 不把 `workspace:*`、本地路径、fixture URL 或测试 registry 作为正式依赖来源。
- 目录源、制品、许可证、来源提交和宿主验证分开记录；内容资料变化不能悄悄改变制品摘要。

## 开发与验证

在 `D:/eac-market` 执行：

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm check
```

目录和 Core 联动时再运行：

```powershell
pnpm exec vitest run tests/catalog tests/core-api tests/adapter
```

Client 或合同联动后必须跑 Client 测试和 `node tests/client/browser-check.mjs`。真实 Desktop 验收使用 `D:/eac-market-verify` 新批次，不能用旧截图或本地 fixture 代替。

## 提交前交接格式

每次 PR 或接力消息写清：

1. 修改的包和文件范围；
2. 输入/输出字段和旧版本行为；
3. 前端消费者、失败语义和数据降级方式；
4. 定向测试、完整测试、browser-check 和真实宿主结果；
5. 未验证项目、阻塞原因和继续路径；
6. 是否影响制品、版本、摘要、发布入口或迁移。

只完成内核雏形时不能写成正式发布；只通过本地测试时不能写成 Desktop 或公网链路已验收。
