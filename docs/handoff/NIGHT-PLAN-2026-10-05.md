# 今晚实施计划：宽松安装 + 上游草稿联调（2026-10-05 夜）

状态：已拍板，按推荐执行（拍板点 1 = 甲、拍板点 2 = X）。
目标：**今晚按阶段顺序完成全部功能**——每个任务块都是自包含提示词，可直接照做或交给协作者执行。
工作目录：`D:/eac-market`，分支 `refactor/market-core-adapter`。

---

## 决策锁定（执行中不得更改）

| 决策 | 结论 |
| --- | --- |
| 拍板点 1 | **甲**：快照新增只读纯展示字段 `previewPacks`（未解析整合包），Client 新增对应展示区，结构上无安装入口 |
| 拍板点 2 | **X**：先做 B1 安装日志 + B2 宽松化，再做供货读取骨架 |
| 日志 | **B 档**：独立安装日志文件 + 设置页导出 |
| 上游对接 | 草稿读取只写测试目录；正式入口等 receipt；方案乙直链不变 |
| 管理 | 照抄官方管理器，我们只加：下载指纹、撤回闸、日志 |

## 全程红线（每个任务都适用）

1. 不给 `installBundle` 传 URL；官方 pnpm 下载器不进我方链路。
2. 下载后 SHA-256 核对、撤回写前闸、`listings`/`previewPacks` 结构上进不了安装计划——**不许动**。
3. 不伪造成功：官方明确失败仍显示失败；"官方成功但我方核对存疑"改为 `已记日志的已安装`，日志必须写明哪项存疑。
4. 不提交他人改动：**禁止把以下文件混进本计划的提交**——`DESIGN.md`、`tests/client/_probe*.mjs`、以及 16 个现有修改（Client UI 的 storystream WIP）；本计划新增的 UI 改动只允许落在任务指定文件的指定位置，提交时用 `git add <精确路径>`。
5. 未执行的测试不得写"通过"；未到手的样本不得填反馈结果。
6. 协议只增不删：Remote 只新增方法，不改不删现有方法。

---

## 总路线图（顺序执行，T3 可与文件到达插队）

```text
T0 基线盘点(20min) → T1 安装日志(90min) → T2 宽松化(150min)
→ T3 供货草稿读取器(60min，文件到则立即换真样本) → T4 previewPacks 纯展示(90min)
→ T5 导入报告+反馈表(30min) → T6 全量验证与提交(40min)
```

---

## T0 · 基线盘点与隔离

### 【提示词】
在 `D:/eac-market` 执行基线盘点，**不改任何业务代码**：
1. `git status --short` 完整记录 25 个改动，按"本计划允许改 / 他人 WIP 禁止碰"两类列出清单；
2. 记录当前 HEAD（应为 `b8a977b`）、`market 0.1.0-mvp.18`、`core 0.1.6`；
3. 跑 `pnpm typecheck`、`pnpm lint`，记录基线结果；跑 `pnpm test 2>&1 | Tee-Object logs/night-baseline-test.txt`，**已知** `update-check-scheduler` 可能偶发 2 个超时——单跑该文件确认即可，不算新增失败；
4. 输出：允许改文件清单（应只有下表任务指定的文件）+ 基线测试结论。

**本计划允许新增/修改的文件全集**：
```text
packages/market-core/src/host/install-log.ts                    (新增)
packages/market-core/src/host/market-runtime.ts                 (接线)
packages/market-core/src/core/task-manager.ts                   (T2)
packages/market-core/src/adapters/dsh/host-port.ts              (T2)
packages/market-core/src/core/planner.ts                        (T2 兼容降级)
packages/market-core/src/contracts/types.ts                     (T4 增量字段)
packages/market-core/src/contracts/compatibility.ts / api.ts    (T1 增量方法)
packages/market-core/src/catalog/{validate,model,store}.ts      (T4)
packages/market-core/src/catalog/{supply-*.ts}                  (T3 新增)
packages/market-core/src/dsh.ts / packages/market/src/index.ts  (T1 增量 Remote)
packages/market/src/client/SettingsRemotePanel.tsx              (T1 导出按钮，叠加在 WIP 之上)
packages/market/src/client/MarketPage.tsx                       (T4 新展区，叠加在 WIP 之上)
tests/{core,adapter,catalog,supply}/**                          (测试)
scripts/supply-draft-import.mjs                                 (T5 新增)
docs/handoff/**                                                 (文档)
```
**验收**：基线结论成文；未改业务代码。

---

## T1 · B1 安装日志（含设置页导出）

### 【提示词】
给市场加一份**独立安装日志**（B 档）：
1. 新增 `packages/market-core/src/host/install-log.ts`：
   - 目标文件 `<dataDirectory>/logs/install-log.jsonl`（每行一个 JSON，追加写，目录不存在则创建）；
   - 每条字段：`at`(ISO时间)、`action`(install/remove/enable/disable/update)、`packageName`、`version`、`artifactDigest`、`source`(交付来源 kind+ref 的 hash，**不写完整 URL 凭据**)、`officialResult`(官方 ChangeResult 的 kind/changed/error)、`postcheck`(每项核对 pass/fail+原因)、`taskId`、`hostVersion`；
   - 文本经过脱敏：不写绝对路径、不写令牌、复用既有 `redactDiagnostic` 思路；
   - 提供 `append(entry)` 与 `read(limit)`（读尾部 N 条，上限 500）。
2. 在 `market-runtime.ts` 构造处创建实例；在**官方结果返回点**（`task-manager` 的 `applyOutcome` 处）和 `host-port` 的装后核对处各写一条日志（T2 会把核对降级，T1 先把两个埋点打上）。
3. Remote 增量：`api.ts` 增 `installLogRead(request?: {limit?: number}): Promise<readonly InstallLogEntry[]>`；`dsh.ts` 门面转发；`packages/market/src/index.ts` 加 `@Remote` 方法。**不改** `ADAPTER_PROTOCOL_VERSION=2.0.0`、`REQUIRED_CORE_API_VERSION=1.0.0`。
4. Client：`SettingsRemotePanel.tsx` 在"诊断信息"区块旁加"导出安装日志"按钮——点击读取 500 条，拼成文本下载为 `install-log-<日期>.txt`；`remote.installLogRead === undefined` 时隐藏按钮（沿用现有降级套路）。
5. 测试：新增 `tests/core/install-log.test.ts`（写入→读取→脱敏断言→并发追加不损坏）。
**验收**：`pnpm typecheck && pnpm lint && pnpm exec vitest run tests/core/install-log.test.ts` 全过；本地真实跑一次写入再读出。
**禁止**：把日志写进任务事件之外的任何现有文件；日志失败不得影响安装流程（try/catch 后仅 console.error）。

---

## T2 · B2 宽松化（方案 1 核心）

### 【提示词】
把"核对类"从拦截器改成记录器，行为变化按下表**精确执行**：

| 场景 | 现行为 | 新行为 |
| --- | --- | --- |
| 官方返回 applied，装后三重核对（依赖 file:/字节/库存）任一不符 | 返回 `unknown`，errorCode `receipt/postcondition`，任务暂停 | **按已安装完成**，日志写明哪项存疑；任务继续 |
| 写后库存读取未安定 | 暂停"写入回执或写后库存尚未核定" | 完成该项 + 日志记录；**不设后续安装阻塞** |
| 官方调用抛异常（已 dispatch） | `unknown` + 暂停 | 状态仍显示"结果未知（已提交，见日志）"**但**：不暂停任务、不阻塞后续安装、启动恢复不再因此卡住 |
| `planner` 判定 `hard-incompatible` | 阻断 | **降级为警告**（继续生成方案；官方仍可能拒绝，拒绝结果照常日志）——用户已批准 |
| 下载后 SHA-256/身份不符 | 失败 | **不变（保持失败）** |
| 撤回 release | 写前拒绝 | **不变（保持拒绝）** |
| 官方明确返回 failed | 失败 | **不变（保持失败）** |

具体改动：
1. `host-port.ts`：装后核对失败分支改为 `this.installLog.append({postcheck:...})` 后**返回 mapped(applied)**；保留写前 `artifact/integrity` 校验。
2. `task-manager.ts`：删除"写后未安定→pause"分支与该状态对后续任务的阻塞（`hasUncertainWrite` 对上述两类场景不再置位）；官方异常分支不再 `pause`，事件文案改为"已提交，结果未核实，详见安装日志"；**保留**取消、撤回、失败语义。
3. `planner.ts`：`hard-incompatible` 从 blockers 移到 warnings；`missing-artifact`/`hard-blocked` 仍阻断。
4. 状态机简化后，`taskResume`/`awaiting-resume` 路径保留接口但预期不再触发（协议不删）。
5. **测试改造（本任务一半工作量）**：先跑 `pnpm exec vitest run tests/adapter tests/core`，逐个把断言改为上表新行为；**禁止删除测试**；新增回归：
   - postcheck 不符 → completed + 日志含 fail 项；
   - 写后未安定 → 不暂停、后续 planCreate 可执行；
   - 撤回仍拒绝（原测试必须原样通过）；
   - 下载指纹不符仍失败（原测试原样通过）。
**验收**：`pnpm typecheck && pnpm lint && pnpm exec vitest run tests/adapter tests/core tests/catalog` 全绿；输出"行为变化对照表 vs 实际"自查清单。
**禁止**：改五语义枚举值；把 unknown 写成 success 文案；触碰 Client（UI 文案后续统一）。

---

## T3 · 供货草稿读取器（A1-A3 + A8 雏形）

### 【提示词】
在 `packages/market-core/src/catalog/` 新增三个纯函数模块（不联网、不碰正式目录）：
1. `supply-draft-read.ts`：入参本地路径 → 拒绝 >8 MiB → 读 UTF-8 原始字节 → `JSON.parse` → 返回 `{bytes, document}`；任何失败抛带中文原因的错误，**不产生半份输出**。
2. `supply-draft-validate.ts`：两层校验——
   - Schema 层（按共识已定字段先行：`schemaVersion==='supply.eac/v1'`、`sourceId`、`items[]`、类型白名单 `plugin|skin|material|function-pack|appearance-pack`，**未知类型整批拒绝**）；
   - 语义层：`packageName+version` 全局唯一、`version` 必须精确 SemVer 禁 `latest/*`、`material` 必须 `installable:false` 且禁带 `artifact/components/execution`、`requiresDsh:null` 必须配 `compatibilityBasis:'unknown'`、`execution.edges` 两端必须引用存在的组件 ID 且不得自环成环。
3. `supply-draft-classify.ts`：四档分类（安装候选/来源展示/资料/未解析组合），纯函数返回分类结果 + 拒绝原因列表。
4. 合成测试 `tests/supply/supply-draft.test.ts`：自造 1 合法（1 plugin 无 artifact + 1 material）、6 非法（未知类型、latest 版本、material 带 artifact、身份重复、requiresDsh 不配 basis、边引用不存在组件）。
**条件插队**：若此时 4 个试点文件已到——先 `Get-FileHash` 核对 3 个已知 SHA-256，再用真样本替换合成样本跑同一套校验，把结果记入 T5 报告。
**验收**：`pnpm exec vitest run tests/supply` 全绿；模块**不被任何运行时代码引用**（纯旁路）。
**禁止**：写 `data/index.json`；连接网络；假定对方 Schema 之外又自造"更严"的正式规则。

---

## T4 · previewPacks 纯展示模型（拍板点 1 = 甲）

### 【提示词】
让未解析整合包能被 adapter 完整展示、但结构上绝对装不了：
1. `contracts/types.ts` 增量：`PreviewPack = { id, version, name, summary, source:{url,commit|null}, requiresDsh: string|null, compatibilityBasis, components: [{id, ref, version?: string, resolved?: {packageName, version, sha256}|null}], artifact?: {format:'eac-feature-pack-v1', downloadUrl, sha256, size}, execution: {coverage:'unknown'|'partial', edges: [], reference?: string}, status:'active'|'withdrawn' }`；`CatalogSnapshot` 增 `previewPacks?: readonly PreviewPack[]`。
2. `catalog/validate.ts`：解析该字段（未知类型拒收、组件 ID 唯一、coverage 禁 `complete`——完整可装的组合未来走 MarketCollection，不走预览）；`model.ts` 投影带上。
3. **兼容性验证（先做）**：构造一个含 `previewPacks` 的 index，用**改动前的 validateMarketIndex** 跑一遍——若旧校验器忽略未知根字段则通过（预期）；若拒绝，立即停下改用"塞入 listings 文本"降级方案并记录。
4. `store.ts`/`dsh.ts` 出口：`catalog()` 与 `catalogRefresh().current` 都带 `previewPacks`。
5. Client：`MarketPage.tsx` 发现页在"06 市场组合"之后加"07 上游整合包（组件整理中）"展区：卡片显示名称/版本/组件 ref 清单/宿主要求/薄包大小与指纹（截断显示）/`coverage` 标签；**无任何按钮**，仅"查看来源"外链（协议白名单）。
6. 结构闸测试：`tests/supply/preview-pack-gate.test.ts`——把 `previewPacks` 的 id 伪装成 `planCreate` 输入 → 必须 `blocked`；`listings` 同样回归。
7. 文本安全：名称/摘要按纯文本渲染（沿用现有转义），外链只放行 http/https。
**验收**：`pnpm typecheck && pnpm lint && pnpm exec vitest run tests/supply tests/catalog tests/client` 全绿；`node tests/client/browser-check.mjs` 通过。
**禁止**：给 previewPacks 生成 delivery/releaseId/安装按钮；改动旧字段语义。

---

## T5 · 导入报告 + 反馈自动化（A8）

### 【提示词】
新增 `scripts/supply-draft-import.mjs`：
1. 用法：`node scripts/supply-draft-import.mjs <supply.json路径> [--report <输出目录>]`；
2. 内部按 T3 模块执行读取→校验→分类，输出 `report.json` + 控制台表格，内容对齐对方第 9 节九项：每项标 `PASS / FAIL / PENDING(待文件)`，附错误原文、样本 SHA-256、执行时间、导入器版本（用 `supply-draft-v0.1.0` 字符串常量）；
3. 输出目录固定 `catalog-source/supply-draft/<批次名>/`（**绝不写 `data/` 或 `catalog-source/distribution/`**）；
4. 若试点文件已到且校验完成：生成"可粘贴回 issue #20 的 Markdown 评论"到 `report-comment.md`。
**验收**：对 T3 的合成样本跑通；报告里 `material` 相关项明确写"安装路径拒绝=结构隔离验证于 T4 测试"。

---

## T6 · 全量验证、提交与交接

### 【提示词】
1. 跑 `pnpm check`（若仅 `update-check-scheduler` 偶发超时→单跑该文件记录，不算失败）；
2. 跑 `node tests/client/browser-check.mjs`；
3. 分 5 个提交（**只 add 本计划文件**）：
   ```text
   feat(host): 添加安装日志与设置页导出
   feat(core): 安装核对降级为日志的宽松模式
   feat(catalog): 供货草稿读取与四档分类
   feat(catalog): previewPacks 纯展示模型与前端展区
   docs(handoff): 记录 2026-10-05 夜计划执行结果
   ```
4. 更新 `docs/handoff/MOJOBOX-COOPERATION-SUMMARY-2026-10-05.md`：追加"今夜执行结果"小节（做了什么/测试结果/未做项/issue #20 状态）；
5. 输出交接块：每任务 ✅/⚠️、测试数字、遗留项、明日 P0 提示（真机验收 + 皮肤诊断 + 等文件）。
**验收**：提交历史干净（`git status` 只剩他人 WIP 与历史残留）；交接块完整。

---

## 条件轨道：试点文件今晚到达时

```text
到手 → Get-FileHash 核对 3 个已知指纹（不符先退回）
→ 插队执行 T3 真样本 + T5 报告
→ 若 9 项可测项全出结果：把 report-comment.md 内容作为评论追加到 issue #20
   （追加评论需用户确认后执行；未完成项照实写 PENDING）
```

## 今晚不做（防蔓延）

- 正式 receipt/批次状态机（等对方正式批次）
- 镜像上传、方案乙脚本改造（联调用不到）
- Core 分层瘦身方案 B、皮肤实机诊断、P0 真机全新安装（明日）
- 任何对他人 16 个 WIP 文件的功能性改动
