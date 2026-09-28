# EAC 市场阶段成果复查与下一阶段接力报告

日期：2026-09-28。用途：给下一模型做独立审查和下一阶段规划。本轮只做复查、运行检查和报告整理，不再继续扩展业务代码；不把自动测试写成完整产品验收。

## 1. 本轮实际做了什么

在既有 `D:/eac-market` 工程上完成了一轮三组子智能体实现：

- 安装 Worker：修复计划身份、升级/降级、同版本保留、重启前置、取消竞态、终态保护、来源保护和错误诊断等安装状态机问题。
- 内容 Worker：实现受控目录来源、公共格式与 Evidence 校验、原子目录切换、README revision、媒体安全解析、ZIP provenance 往返。
- UI Worker：修复任务抽屉遮挡、方案目标绑定、试装勾选、状态误报、轮询倒退、更新入口，并加入混合商城和系统组件折叠的基础形态。
- 主控：冻结契约、整理构建顺序、接入 AI 无工具分析/确认入口、生成运行包、补充 AI 测试和运行报告。

本轮的实现文件主要位于：

- `packages/market/src/core/**`
- `packages/market/src/adapters/dsh/**`
- `packages/market/src/catalog/**`
- `packages/market/src/delivery/**`
- `packages/market/src/authoring/**`
- `packages/market/src/client/**`
- `packages/market/src/host/**`
- `packages/market/src/contracts/types.ts`
- `tests/**`

## 2. 深度复查结果：可以确认的成果

| 项目 | 复查结论 | 证据 |
|---|---|---|
| 构建入口 | 当前 `pnpm.cmd check` 会先生成 Host/Client/Typert，再 lint、测试和打包 | `package.json:16`，本轮命令通过 |
| 必需 ambient 源码 | `packages/market/src/protocol-ambient.d.ts` 不再被 `.gitignore` 忽略 | `git check-ignore` 返回未忽略 |
| 自动测试 | 23 个测试文件、110 个测试通过 | `pnpm.cmd check` |
| 内容专项 | 6 个测试文件、36 个测试通过 | `pnpm.cmd test:catalog` |
| 包结构 | 108 个文件，27 个 Remote descriptors，运行结果 schema 可解析 | `pnpm.cmd test:pack` |
| 最终包 | `D:/eac-market-verify/audit-20260928/ai-run-3/dsh-eac-market-0.1.0-mvp.0.tgz`，358423 bytes，SHA256 `A15C1A1AFA46197E71A8329ED513E6F8A128074DD274DF65CF3FAECE2CBE944C` | npm pack 与 SHA256 |
| 隔离 profile | 最终包安装到 `D:/eac-market-verify/m8-home/profiles/desktop`；profile、Electron userData 和 pnpm store 均指向测试目录 | 进程参数、profile `package.json`、包文件摘要 |
| 真实页面 | Playwright CDP 连接隔离官方 Desktop，点击 EAC、发现、全部插件、我的插件、任务面板后页面可见；截图已保存 | `evidence/final-market-mine.jpg`、`evidence/final-market-task.jpg` |
| 页面边界 | 空目录显示真实空态；系统错误/状态未知没有被折叠隐藏 | 截图和页面正文 |

这些结果证明：**当前包可以构建、打包、进入隔离 profile，并在官方 Desktop 中显示市场 UI**。它们仍不能证明所有安装和 AI 流程已通过真实验收。

## 3. 深度复查发现：下一模型必须先处理的阻断项

### R01｜P1｜AI 诊断输入为空

位置：`packages/market/src/host/market-runtime.ts:401-408`。

`diagnosticsExport()` 当前仍然返回 `diagnostics: []`。也就是说 `aiAnalyze()` 虽然已接入无工具模型入口，但实际发送给模型的诊断材料没有任务错误、阶段信息或日志引用。此前文档和运行报告把它描述成“真实诊断收集”，是**过早结论**，下一版必须更正。

影响：AI 只能凭 `request` 猜测，不能完成“基于证据解释失败”的核心要求。需要把任务错误、官方错误码、脱敏日志引用、库存异常和目录异常收集为有界 `DiagnosticEntry`，并验证敏感信息不会进入模型输入。

### R02｜P1｜AI 确认链没有遵守二次确认，也没有完整执行多动作提案

位置：`packages/market/src/client/components.tsx:305-310`、`packages/market/src/host/market-runtime.ts:378-399`。

发现两个独立问题：

1. UI 在调用 `aiConfirm()` 时，对 `remove/downgrade` 自动传 `riskConfirmed: true`。这会把“二次展示影响并再次确认”变成一次自动勾选，不符合已定产品规则。
2. Host 只执行 `proposal.actions[0]`。模型即使返回多个允许动作，后续动作会被静默忽略。

影响：AI 功能的权限边界和用户预期不可信。下一阶段应限制提案为单一动作，或实现按动作顺序的完整确认/执行/暂停；卸载/降级必须有独立的第二次 UI 确认卡。

### R03｜P1｜AI 执行的重试关联字段使用错误

位置：`packages/market/src/host/market-runtime.ts:397`、`packages/market/src/contracts/types.ts:348`。

代码把 `request.proposalId` 传给 `retryOfTaskId`。契约里的 `retryOfTaskId` 语义是任务 ID，不是 AI 提案 ID；当前任务管理器也只读取和保存该字段，没有真正把提案关联到任务。下一版必须明确 proposal → plan → task 的关联字段，不能用一个看似合理的字符串代替真实链路。

### R04｜P1｜启停和卸载绕过统一写入队列

位置：`packages/market/src/host/market-runtime.ts:298-320`。

`pluginSetEnabled()` / `pluginRemove()` 直接调用 Host，忽略 `expectedVersion`、`idempotencyKey` 和已确认计划；它们没有经过 `InstallTaskManager` 的串行写协调、幂等和终态保护。当前 AI 的 `enable/disable/remove` 也会走这两个入口。

影响：并发安装、重复点击、跨标签操作和外部修改仍可能产生不一致结果。下一阶段应把所有市场写操作纳入同一执行器，或明确将这两类操作标为受限人工操作并禁止 AI 执行。

### R05｜P1｜受控目录来源没有接入实际刷新路径

位置：`packages/market/src/host/market-runtime.ts:183-196`；来源实现位于 `packages/market/src/catalog/source.ts`、`catalog/store.ts:199`。

内容 Worker 实现了 `CatalogSourceRegistry` 和 `refreshWithSource()`，但 Host 的 `catalogRefresh()` 仍然直接对 `request.sourceUrl` 调 `safeFetch()`，没有读取登记来源、回退链或来源维护者信息。测试证明的是库层能力，不是 Host 真实刷新链。

影响：AUD-F14 只能算部分完成；“团队登记来源”和“HTTPS 地址”仍可能被混为一谈。

### R06｜P1｜安装错误诊断在普通启停/卸载结果中仍会丢失

位置：`packages/market/src/host/market-runtime.ts:48-58`、`:298-320`。

`resultFromOutcome()` 只把 `error` 和权限变化映射到 `PluginActionResult`，没有稳定保留 `errorCode` / `diagnostic`。AI 和 UI 只能拿到一个短错误字符串，无法解释真实失败阶段。需把错误码、脱敏诊断和日志引用作为统一结果的一部分。

### R07｜P2｜推荐机制只完成了 UI 骨架，未完成数据闭环

位置：`packages/market/src/client/MarketPage.tsx:800-842`、`packages/market/src/client/model.ts:348-363`；契约新增字段位于 `contracts/types.ts:80,153`。

当前“团队精选”仍把 `distribution === 'recommended'` 当作推荐，正文明确说没有独立团队理由字段；排序中的“兼容性优先/规则排序”也还没有使用 `releasedAt` 做真实版本更新时间。`CatalogSnapshot.recommendations` 和 `CatalogPlugin.releasedAt` 虽已加入契约，但 UI/数据生成没有完整消费。

影响：N01 只能记为部分完成；不能把现有 `recommended` 分发标记称为团队审核推荐。

### R08｜P2｜AI 的换源、升级和降级动作语义没有真正闭合

位置：`packages/market/src/host/market-runtime.ts:386-398`。

`retry-source` 没有使用 `sourceId`；`install/update/downgrade` 都从当前目录找匹配插件，无法表达“同一制品换镜像”或“目标版本不是当前目录版本”的完整关系。当前代码对无法找到精确目录制品会阻断，这是安全的，但已选 AI 范围还不能称完整实现。

### R09｜P2｜AI 提案只存在内存 Map 中

位置：`packages/market/src/host/market-runtime.ts:378`。

Host 重启后 `aiProposals` 丢失，无法进行持久确认、过期清理和重复执行审计。普通市场任务已有 JSON 持久层，AI 确认记录也应采用同等可恢复机制。

### R10｜P2｜真实官方插件页安装链尚未作为最终包验收

本轮通过 `pnpm add file:<tgz>` 将最终包放入隔离 profile，随后用 CDP 打开官方 Desktop 页面验证 UI；没有通过官方“添加插件”页面完成最终 tgz 的安装点击链。因此报告中的真实 UI 证据只能标作“最终包进入隔离 profile 后的页面加载/导航证据”，不能写成“官方插件页安装验收通过”。

## 4. 现有测试的覆盖边界

已通过的 110 个测试主要覆盖纯逻辑、受控合成服务、Client SSR/状态和目录/作者资料。它们没有覆盖：

- 真实 DSH `plugin_manager` 的最终包安装页面点击；
- 真实模型调用、模型取消/超时/异常 JSON 和输出工具调用；
- 真实 GitHub/Gitee 网络目录和第三方制品；
- 卸载/降级的第二次确认 UI；
- 两个标签、Host 重启后 AI 提案恢复；
- 全部 ACC-D 场景和最终官方 Desktop 交互矩阵。

`ACCEPTANCE-REGISTER.md` 中的 ACC 62 条是登记表，不是通过记录；当前批次只对其中一部分做受控回归。

## 5. 下一阶段接力规划

下一模型的职责是**独立审查并制定下一阶段实施计划**，不要直接把本报告的“已实现”当成验收结论。

### 5.1 审查顺序

1. 对照本报告 R01–R10 逐条读取当前源码，确认哪些是真缺陷、哪些只是文档过时。
2. 重跑 `pnpm.cmd check`、`pnpm.cmd test:catalog`、`npm pack --dry-run`，保存命令、退出码和最终包 SHA256。
3. 用真实代码检查 `diagnosticsExport`、`aiConfirm`、`pluginSetEnabled/pluginRemove`、`catalogRefresh`，不要只看测试结果。
4. 对照 `PRODUCT.md`、`AI-ASSIST-RULES.md`、`UPGRADE-PLAN-V2.md` 和 ACC 登记表，标记范围已完成/部分完成/未开始。
5. 只有在上述证据齐全后，才制定下一版实施计划和子智能体提示词。

### 5.2 建议的下一阶段顺序

| 顺序 | 任务 | 交付门槛 |
|---|---|---|
| 1 | 修 R01/R02/R03/R04/R05/R06 | AI 输入有真实脱敏证据；二次确认不能被自动跳过；启停卸载进入统一写队列；登记来源真正接入 Host |
| 2 | 补 R07/R08/R09 | 推荐理由、规则排序、来源切换、AI 提案持久化和动作语义完整 |
| 3 | 重新生成最终包 | 干净目录构建，包摘要、运行 schema、许可证和无测试默认数据检查 |
| 4 | 真实 Desktop QA | 官方插件页安装、浏览、安装失败重试、升级/降级、取消/重启、AI 确认、作者 ZIP 往返 |
| 5 | 独立 Reviewer | 只读核对代码、包、日志和验收证据，指出未覆盖边界 |
| 6 | 规划下一阶段 | 根据审查结果拆分新的 Worker 文件所有权、测试矩阵、风险和用户决策点 |

### 5.3 下一模型不应做的事

- 不要把 110 个测试、108 个打包文件或页面截图写成完整 MVP 通过。
- 不要恢复 Star、GitHub 登录、在线投稿/认领/发布或任意命令执行。
- 不要绕过官方安装模块，不要改官方源码、EAC 组织仓、真实用户 profile 或密钥。
- 不要删除旧包、失败现场、任务记录或未提交源码。
- 未获明确授权前不要 commit、push、建远端、发 PR、发评论或发布。

## 6. 当前交付索引

- 最新运行包：`D:/eac-market-verify/audit-20260928/ai-run-3/dsh-eac-market-0.1.0-mvp.0.tgz`
- SHA256：`A15C1A1AFA46197E71A8329ED513E6F8A128074DD274DF65CF3FAECE2CBE944C`
- 运行报告：`docs/handoff/RUN-REPORT-2026-09-28-ai-and-workers.md`
- 接力入口：`docs/handoff/START-HERE.md`
- 工作清单：`docs/handoff/WORK-QUEUE.md`
- 旧验收登记：`docs/handoff/ACCEPTANCE-REGISTER.md`
- 真实页面证据：`D:/eac-market-verify/audit-20260928/evidence/`

**最终判断：**基础工程和多个故障修复已有代码与受控测试证据，最终包能在隔离 profile 中显示官方 Desktop 市场页面；但 AI 诊断、AI 二次确认、统一写入队列、真实目录接入和完整官方安装验收仍未闭合。下一模型应先独立审查 R01–R10，再产出下一阶段计划，不应直接宣布 MVP 完成。
