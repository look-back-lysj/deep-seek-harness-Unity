# Mojobox 供货合作与 Core 决策总结（2026-10-05）

面向：后续 Core、供货对接、发行协作者
范围：本文覆盖 2026-10-04 至 10-05 本对话完成的调研、双方文件往返、设计审查与全部已拍板决策。
入口顺序：先读 `START-HERE.md` 与 `COLLABORATION-SUMMARY-2026-10-03.md`，再读本文。

---

## 1. 环境快照（本文写作时已核实）

| 项 | 值 |
| --- | --- |
| 工作目录 / 分支 | `D:/eac-market` · `refactor/market-core-adapter`（与 origin 同步） |
| 本地 HEAD | `b8a977b`（mvp.18 发布链：`f47174a` storystream 重设计 → `aa2ef09` 双通道包 → `b8a977b` 固定 URL） |
| 源码版本 | market `0.1.0-mvp.18` / core `0.1.6` |
| 本机官方 Desktop 已装 | `@dsh-eac/market 0.1.0-mvp.18-local.1`（来自 `D:/eac-market-user-trial/20261004-mvp18-local/`） |
| 工作区 | **25 个未提交改动**：16 修改（`DESIGN.md` + 14 个 Client 文件 + 4 个 client 测试）+ 9 未跟踪 |
| 未跟踪需处置 | `docs/MOJOBOX-SUPPLY-REQUIREMENTS-v1.md`、`docs/MOJOBOX-SUPPLY-CONSENSUS-v1.md`（本对话产出，尚未提交）；`235`/`430`/`920` 与 `releases/0.1.0-mvp.17-dual/stage*/`（历史打包残留）；`tests/client/_probe*.mjs`（临时探针） |
| Mojobox 仓本地克隆 | `D:/EAC-mojobox`（main=`db77414`，仅用户名改名杂务） |

> ⚠️ 本对话期间工作区出现 16 个 Client/测试修改（storystream/UI 方向），**不属于本对话的产出**，处理前先辨认归属，勿与供货工作混提交。

---

## 2. 本对话完成了什么（时间线）

### 2.1 掌握内核现状
- 读参考线程与 `COLLABORATION-SUMMARY-2026-10-03.md`，确认基线：core `0.1.6`、目标宿主 DeepSeek Harness `0.2.0-rc.1`、P0 = GitHub 通道真机全新安装验收仍欠。
- 讲清了"展示文件"链路：市场内容全部来自 `data/index.json`（≈1.4MB），运行期从登记的 Gitee/GitHub 两地址刷新，经六道安全关卡（HTTPS 白名单、内网拦截、跳转白名单、30s/8MiB、主备切换、SHA-256 防篡改落盘），缓存于 `C:/Users/刘沛伦/.dsh/profiles/desktop/eac-market/catalog/`。

### 2.2 Mojobox 供货合作（三份文件已进入对方仓库）
| 文件 | 位置 | 提交 |
| --- | --- | --- |
| 《EAC 市场供货目录接口要求 v1》（我方要货清单） | `docs/eac-supply-requirements-v1.md` | `d6f6031` |
| 《供货格式优化建议 v1》（对方回应存档） | `docs/eac-supply-format-proposal-v1.md` | `ad2c57d` |
| 《供货格式双方共识 v1》（含我方对 7 问的正式答复） | `docs/eac-supply-consensus-v1.md` | `8697f96` |

本方仓库同时留有未提交副本：`docs/MOJOBOX-SUPPLY-REQUIREMENTS-v1.md`、`docs/MOJOBOX-SUPPLY-CONSENSUS-v1.md`。

共识要点：6 类货（plugin/skin/skill/function-pack/appearance-pack/material）、公共字段与追加要求、`supply.eac/v1` 顶层（sourceId/sequence 严格递增）、两档展示（缺材料只展示不安装）、`supply-receipt` 发布说明机制、撤回不可自行恢复、一期"市场发布时导入"不做客户端多源订阅、skill 一期不收。

### 2.3 设计审查：12 处纰漏（4 严重）已修正
1. 发布链**已有** `scripts/catalog/assemble.ts` + `prepare-distribution.ts` + `catalog-source/distribution/`（git 跟踪 57 文件）——导入器必须**接入现有链**，不建平行流水线。
2. 发行记录 `releases.ts` 强制 `authorization.redistribution === true` + 40 位 commit + license——**无授权/commit:null 只能来源展示**（安装候选门槛高于公共 7 字段，需告知供货方）。
3. 无真实元数据的条目走 `listings`，禁止与 plugins 同 ID 混用；皮肤 `kind/skinId` 只能由真实 `package.json.dsh.skin`（apiVersion `dsh.ecosystem.ui-skin-loader/v1`）推导。
4. **未解析/被撤回组合在现格式无展示位**（MarketCollection 要求真实发行绑定；packs 属已冻结 legacy）——本轮对方指导已确认：需新增"下游纯展示模型"。
5-12（中低）：镜像上传无自动化脚本、供货直链 vs 镜像的分叉、presentation 由 `prepare-distribution` 统一重建、recommendations 每次清零、占位域名禁入生产目录、撤回传播连带集合、8MiB 体积预检、skill/未知类型按对方反例整批拒绝。

### 2.4 已拍板的供货技术决策
| 决策 | 结论 |
| --- | --- |
| 制品分发 | **方案乙：供货直链**（不镜像）。交付地址用供货方 `downloadUrl`；需改 `prepare-distribution.ts` 认"供货台账"替代上传回执；Core 运行时零改动（`registry-tarball/https-artifact` 本就支持） |
| 导入模式 | 一期**发布时导入**（世界 A），运行时只读我方 `index.json` |
| 展示/安装 | 两档：缺 artifact/commit:null/无授权 → `listings` 来源展示；齐备 → 安装候选 |
| 分工 | "Core 只做管理"：世界 A = 进货/发布（scripts），世界 B = Core 运行时（读/规划/执行/状态），供货与镜像都不属于 Core |

### 2.5 Core 四项调查结论
| # | 事项 | 结论 |
| --- | --- | --- |
| 1 | 每次重启读取 | ✅ 已实现：内嵌目录字节、缓存目录+撤回、中断任务恢复、官方库存、协议握手（`hello→catalog→inventory→tasks` + 环境一致性核对）；联网刷新按调度（默认 60 分钟、refreshFirst 先刷目录），**启动不等网络，不改** |
| 2 | 检验/装/卸/更/启停 | ✅ 全实现：目标范围预检 → 下载 `verifying` → 官方写入 → 五语义；卸载/启停走 `manage()` 目标核对；更新 = `checkUpdates` + 同一安装链，不自动装 |
| 3 | 皮肤管理器 | **非 Core**（Core 零皮肤代码）：管理器插件 `@dsh-eac/ui-skin-loader` 提供 `uiSkinLoader` 服务，Client 经可选注入桥接；本机静态核对**无不兼容**（管理器 1.1.0=目录 1.1.0，三皮肤版本逐一一致、`dsh.skin` 协议齐全）——"不兼容"疑点留待实机诊断，查明前不改代码 |
| 4 | Adapter 对接 | ✅ 清晰：Core 出 `MarketBackend` 合同（api.ts）+ `dsh.ts` 冻结门面（强制 callerId）；Adapter 出 37 个 `@Remote`、会话门、版本三件套握手、随包目录字节；Client 只消费 Remote |

### 2.6 上游读取 × 功能 2 深挖（对照官方组件）
- 官方对接实况：`installBundle(本地已验tgz, {enabled, requestId, approvedBuilds})`；`setBundleEnabled`/`removeBundle`/`cancelInstall`/`waitForInstall`；回执 `dispatched→received`；装后三查（依赖 `file:` 指向缓存 + 字节指纹 + 库存 `version/source=market-cache-file/enabled`）；官方锁不嵌套。
- **红线（4 条理由，勿改）**：官方内置 pnpm 下载链**不进我方链路**——①官方对目录摘要未形成强制验证链（PROTOCOL-EVIDENCE 行 98）；②违反供货协议逐字节核对承诺；③传 URL 会打断 `file:` 回执/后置条件证据链（必然 `receipt/postcondition` 未知）；④我方下载器有 SSRF 六关卡、多源轮换、断点续传、指纹缓存。
- 供货协议在运行链的 8 个落点全部核对通过（指纹三道、撤回写前闸、四档结构隔离、直链 URL 规则等）。

### 2.7 Core 瘦身讨论（未开工）
- 体量调查：core ≈13,500 行；补充功能（作者工具 1524 / AgentForge+离线 ≈700 / 套餐选件 462 / AI / 更新调度）**全部有 UI 入口、永远全量装载**；冻结遗留 = 旧 Pack/Lock 校验 + 前端 05 套餐区（数据 0）。
- 曾评估方案 B（内核分层+按需装载）并列出 7 项损失（时间/回归风险/前半程无收益等）；**用户决定暂缓**。
- **最终拍板：方案 1（宽松安装 + 日志）**——核对类从"拦截器"降为"记录器"；保留 4 闸：下载指纹、撤回闸、listings 结构上进不了安装 API（补测试）、官方自带检查；日志用 **B 档**（独立安装日志文件 + 设置页导出）。**未施工**。

### 2.8 本轮实际任务：本地草稿联调（选 A，反馈优先）
- 对方交付《EAC 市场下游使用指导》：本轮只做**读取→校验→展示**，禁止安装、禁止进正式目录、禁止伪造 receipt；草稿入口与正式入口必须分开。
- 对方要求的反馈表 9 项（试点 2 条记录、来源展示关安装、资料全路径拒绝、完整样本 25 条、14 薄包字节核对、未解析组合展示、非法 fixture 拒绝等），反馈需附 Schema/样本/导入器版本与错误原文。
- **已核实：GitHub 全部远端分支均无交付物**（`feat/eac-supply-export` 未推送、`.cache` 被忽略、`main` 仅杂务提交）→ 已给用户一段**索要 4 个试点文件**的转发话术（含 3 个已知 SHA-256 指纹、"发文件勿粘贴正文"要求）。
- 收到文件后按对方第 5 节执行：8MiB 限长 → Schema → 语义校验 → 纯展示模型三分支（插件来源/资料/**未解析组合=需新增展示模型**）→ 只写测试目录 → 回 9 项反馈表。

---

## 3. 待办（按优先级）

1. **P0-联调**：收到 4 个试点文件 → 核对指纹 → 草稿读取器 + 展示模型 → 回对方 9 项反馈表（本轮唯一在等外部输入的任务）。
2. **P1-方案 1 施工**：先安装日志（B 档），后宽松化（task-manager/host-port + 改测试预期）；与联调互不冲突。
3. **挂起**：P0 真机验收（GitHub 通道全新安装，mvp.18）；皮肤管理器实机诊断（先截图/看提示文案）；正式供货导入器（receipt/序号状态机，联调通过后做）；Core 瘦身（方案 B，暂缓）；`update-check-scheduler` 测试波动（P1 老账）。

---

## 4. 不可破坏的红线（本轮新增部分加粗）

1. 五种结果语义不压成布尔；`unknown` 不自动重放（**方案 1 只把"核对异常"降为日志，不伪造成功**）。
2. 下载后指纹核对、撤回写前闸、官方唯一写入者——**方案 1 保留清单**。
3. **不给 `installBundle` 传 URL、官方 pnpm 下载器不进我方链路。**
4. **草稿联调结果只写测试目录；`supply.json` 无 draft 字段，不得凭 Schema 判正式资格；正式入口必须验 receipt。**
5. 资料/未解析组合**结构上**不得产生安装计划（不靠页面隐藏按钮）。
6. 供货身份唯一键 = `packageName + version`；供货方 `sourceId` 不替换我方 `publication.sourceId`。
7. 协议只增不删；Client 不得绕过 Core 写环境。
8. 未做真机验收不得写"通过"；未执行的安装测试不得填进反馈表。

---

## 5. 文件与提交索引

| 内容 | 路径/提交 |
| --- | --- |
| 要货清单 v1 | `D:/eac-market/docs/MOJOBOX-SUPPLY-REQUIREMENTS-v1.md`（未提交）↔ 对方仓 `docs/eac-supply-requirements-v1.md` `d6f6031` |
| 双方共识 v1 | `D:/eac-market/docs/MOJOBOX-SUPPLY-CONSENSUS-v1.md`（未提交）↔ 对方仓 `docs/eac-supply-consensus-v1.md` `8697f96` |
| 对方回应存档 | 对方仓 `docs/eac-supply-format-proposal-v1.md` `ad2c57d` |
| 下游使用指导 | 微信文件 `eac-downstream-usage-guide.md`（未入库，建议归档到 `docs/handoff/`） |
| 发布链工具 | `scripts/catalog/{assemble,prepare-distribution}.ts`、状态 `catalog-source/distribution/` |
| 官方对接证据 | `docs/host-capabilities.md`、`docs/PROTOCOL-EVIDENCE.md` |
| 环境备忘 | Mojobox 仓克隆 `D:/EAC-mojobox`；**GitHub 访问需绕过失效代理**：`git -C D:\EAC-mojobox -c "http.https://github.com/.proxy=" fetch` |

---

## 6. 下一位协作者的第一步

1. 读本文第 3 节，确认当前唯一阻塞是"4 个试点文件"；
2. `git status` 辨认 25 个未提交改动的归属（16 个 Client 修改≠供货工作），分开提交；
3. 文件到位后从"待办 1"开工，反馈格式严格按对方指导第 9 节；
4. 任何想跳过指纹/撤回/结构隔离的"简化"，先对照第 4 节红线再动手。
---

## 7. 今夜执行结果（2026-10-05 夜，按 `NIGHT-PLAN-2026-10-05.md` 执行）

### 7.1 逐任务结论

| 任务 | 结论 | 证据 |
| --- | --- | --- |
| T0 基线盘点 | ✅ | 起点 `b8a977b`、market `0.1.0-mvp.18`、core `0.1.6`；`pnpm typecheck` / `pnpm lint` 通过；基线 `pnpm test` = 76 文件 / 760 通过 + 2 跳过（`update-check-scheduler` 本轮未波动） |
| T1 B1 安装日志 | ✅ | 新增 `packages/market-core/src/host/install-log.ts`（JSONL 于 `<data>/logs/install-log.jsonl`，追加串行、脱敏、读尾 N 条上限 500）；Remote 只增 `installLogRead`；设置页新增“导出安装日志”；`tests/core/install-log.test.ts` 5 例（往返 / 脱敏 / 并发 510 条封顶 500 / 单行损坏 / 文件缺失） |
| T2 B2 宽松化 | ✅ | 见 7.2 对照表；新增 `tests/core/loose-install.test.ts` 3 例；`tests/adapter/receipt-recovery.test.ts` 装后核对用例按新行为改预期（未删测试） |
| T3 供货草稿读取器 | ✅ | `catalog/supply-draft-{read,validate,classify}.ts` 纯函数三件套；`tests/supply/supply-draft.test.ts` 13 例（1 合法 + 6 非法 + 8 MiB 上限 + 自环/成环 + **纯旁路守卫**：运行时代码零引用） |
| T4 previewPacks | ✅ | 步骤 3 先做兼容性验证：**旧 `validateMarketIndex` 忽略未知根字段 → 通过**，无需降级塞 listings；随后接入 `validate/model` 解析，`catalog()` 与 `catalogRefresh().current` 均带出；发现页新增“07 上游整合包（组件整理中）”无按钮展区；`tests/supply/preview-pack-gate.test.ts` 4 例（结构闸 + listings 回归 + coverage/重复组件/未知状态/越界边拒绝） |
| T5 导入报告 | ✅ | `scripts/supply-draft-import.mjs`（`supply-draft-v0.1.0`）；对合成样本跑通：**通过 3 / 失败 0 / 待文件 6**，`report.json` 写入 `catalog-source/supply-draft/<批次>/`；第 3 项明确写“安装路径拒绝=结构隔离验证于 T4 测试”；9 项未全绿 ⇒ 未生成 issue 评论稿 |
| T6 全量验证与提交 | ✅ | `pnpm check` 通过（79 文件 / 786 通过 + 2 跳过；`verify-package` 80 文件、Remote 描述符 38、结果 Schema 校验通过）；`node tests/client/browser-check.mjs` 最终 **0 失败、退出码 0**，见 7.4 |

### 7.2 行为变化对照表 vs 实际

| 场景 | 今夜实际行为 | 落点 |
| --- | --- | --- |
| 官方 `applied` 但装后核对不符 | **按已安装完成**，日志逐项写明哪项存疑 | `host-port.ts` 装后核对只写日志、不再降为 `unknown`；`task-manager.applyOutcome` 走 `postcheck/logged` 分支 |
| 写后库存读取未安定 | **完成该项 + 日志**，不为后续安装设阻 | `writeUncertain` 只在“官方明确 failed 且共享影响未知”时置位 |
| 官方调用抛异常（已派发） | 显示“结果未知（已提交，见日志）”，**不暂停、不阻塞后续安装、启动恢复不再卡住** | 事件文案改写；`reconcileInterrupted` 不再把 `needs-attention` 升级成 `interrupted` |
| `planner` 判 `hard-incompatible` | **降级为警告**，官方仍可拒绝 | `InstallPlanItem.warnings`；`taskStart` / `validateWrite` 只拦 `hard-blocked`；`missing-artifact` 仍阻断 |
| 下载后 SHA-256/身份不符 | **不变（失败）** | `artifact/integrity` 原样保留，原测试原样通过 |
| 撤回 release | **不变（写前拒绝）** | `assertReleaseActive` 未动，REV 撤回测试原样通过 |
| 官方明确返回 `failed` | **不变（失败）** | 五语义枚举未改 |

### 7.3 提交

```text
f6aef9f feat(core): 添加安装日志与宽松安装模式
ad53f2e feat(catalog): 供货草稿读取、四档分类与导入报告
e011b8b feat(catalog): previewPacks 纯展示模型与前端展区
（本文档随第四条 docs(handoff) 提交）
```

**与计划的两处偏差（已核实原因）**：
1. 计划列了 5 个提交，实际 4 个——T1 的埋点与 T2 的降级落在 `host-port.ts` / `task-manager.ts` 的**同一处改动**里，拆开会产生“不可编译的中间提交”，故合并为一条并在提交信息中体现。
2. `packages/market/src/client/{MarketPage,SettingsRemotePanel}.tsx` **未随本计划提交**：这两个文件属 16 个他人 WIP，本计划改动与其改动在同一 hunk 内交织，按红线 4 不混提交。做法是用 `HEAD + 本计划改动` 合成 blob 精确入 index，提交后工作区只剩他人 WIP（已用 `git diff` 验证残留 diff 不含本计划任何一行）。**这两处 UI 仍需 WIP 作者随其改动一并提交。**

### 7.4 browser-check：初测 2 项失败 → 非本计划引入，已被 WIP 作者修复

初测（18:02–18:13）失败项：`滚动：官方受限面板 1280px/480px 的折叠、滚轮与键盘`，报 `list grows out of the official clipped panel`（`rootH=760px`、`host.bottom=792 > innerHeight=760`）。

取证：临时 worktree 三组对照——
- 纯 `HEAD(b8a977b)`：**通过**
- `HEAD + 16 个他人 WIP 文件`（本计划改动为 0）：**同样失败**
- 当前工作区（WIP + 本计划）：同样失败

⇒ 根因在他人 WIP（`tests/client/browser-fixture.tsx` 注入的 `#root{min-height:100%}` 与 `#root.official-panel-fixture{height:calc(100dvh - 32px);margin-top:32px}` 互相抵消），**不属于本计划范围，本计划未修改这些文件**。对照用临时 worktree 已删除，junction 已逐个 `rmdir`，主仓库 `node_modules` 完好。

**结局**：WIP 作者于 18:14:36 在同一处补上 `min-height:0`，18:26 复跑 `node tests/client/browser-check.mjs` → **0 失败、退出码 0**。

### 7.5 issue #20 与待办

- **issue #20 未追加评论**：4 个试点文件仍未到手，T5 九项里 6 项 `PENDING(待文件)`；按红线“未到手的样本不得填反馈结果”。文件到手后跑：
  `node scripts/supply-draft-import.mjs <supply.json> --artifacts <字节目录> --illegal <非法样本>`
  全绿会自动产出 `report-comment.md`，**发评论前仍需用户确认**。
- 已知 3 个待核指纹：`eac-supply.schema.json` 8308B / `a8688d0f…`、`eac-supply-receipt.schema.json` 909B / `21f98f22…`、试点 `supply.json` 1238B / `9200353a…`。

### 7.6 明日 P0

1. 收到试点文件 → 核指纹 → 跑导入报告 → 用户确认后回 issue #20；
2. P0 真机验收（GitHub 通道全新安装 mvp.18）——**未做，不得写通过**；
3. 皮肤管理器实机诊断（先截图/看提示文案，再判断是否与 Client 桥接有关）；
4. 上面 2 处 UI 改动与 WIP 作者对齐，确保不被覆盖；
5. `browser-check` 的 2 项由 WIP 作者修复（根因见 7.4）。
