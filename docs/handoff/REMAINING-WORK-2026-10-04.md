# 剩余任务与执行账本

2026-10-05当前收尾：[详细开发者交接](DEVELOPER-HANDOFF-2026-10-05.md)与[修改记录](MODIFICATION-RECORD-2026-10-05.md)为最新接手入口。两次正常合并均有逐文件取舍；最新mvp.19源码已完成全量1906/0/2既有pending、合成browser60/60及build/类型/lint/包边界；布局审计被中断，新官方字节及普通unknown迟到回执追账待验。主人已授权提交及推送GitHub当前分支，未授权npm/tag/Release。下文起点“不commit/push”及各批数字为当时历史状态，不覆盖当前收尾授权；实际远端交付应以普通push后的ref核对为准。

2026-10-05（Asia/Shanghai）最新补充：[管理业务闭环实录](MANAGEMENT-BUSINESS-IMPLEMENTATION-2026-10-05.md)记录本批Core/Client实现与官方rc.2管理验收；最终1866/0/2既有skipped、browser49/49、新安装191文件一致。RW-13当前实现范围完成；媒体/版本/退出历史/发行等门禁分别保留。[详细实现计划](NEXT-IMPLEMENTATION-PLAN-2026-10-05.md)已同步状态；下文旧批次测试数字不作为最新结论。

日期：2026-10-04（Asia/Shanghai）。分支 `refactor/market-core-adapter`，起点 HEAD `9c6a1d22aa6b6e666172c81e1f1fbdd3517b059b`。保留所有既有未提交修改；不 commit、push、发布或改官方安装。本文是后续执行清单，不把计划写成通过。

## 已有证据与不变边界

- 对应冷启动、作者脱敏/刷新、README 修复及官方 rc.2 实机结果见 [修复报告](OFFICIAL-DESKTOP-FIXES-2026-10-04.md)。1404 passed / 2 skipped 是上一批结果，不能代替本批回归。
- 核心版本只取官方 `getDshRuntimeVersion()`，不是 Desktop 发行号、market-core 或 Remote 版本。
- 后端只提供 API、兼容/目录/库存事实和耐久写入回执；默认选择、确认、loading、超时、轮询及 dirty 状态仍归前端。
- 不新增库或常驻任务系统，不削弱 SSRF、供应链、摘要、官方 `blockExoticSubdeps`、幂等和确认。不覆盖未知操作，不重放 b1 unknown。
- 本轮主控独占公共合同、Adapter 接线、文档和串行构建；Core worker 独占 Core 实现与对应测试；两个 Client worker 分别独占版本选择和 TaskDrawer。真实 Profile、官方源码/asar、组织仓不在写范围。

## 执行顺序

| 编号 | 优先级 / 状态 | 任务 | 完成证据与边界 |
| --- | --- | --- | --- |
| RW-01 | P0 / 源码实现与 focused 通过 | 冻结版本选择上下文到预检计划 | 单项选择绑定 environment、host/catalog/inventory revisions、metadata/artifact/release 身份和可信来源；服务器重新核对，不信 Client 自报；计划摘要覆盖绑定；变动发生于下载前时零下载/零写，下载后首次dispatch前变动零官方写；旧调用方新建计划也冻结事实，历史缺绑定不补造。 |
| RW-02 | P0 / API 实现与 focused 通过 | 原安装与管理意图的只读恢复 API | 复用原 plan/key、现有 task/management 回执；安装核对可信 caller；缺失不代表没执行；查询不调用安装/启停/卸载，不创建第二系统。管理页消费与维护完整结果另见 RW-13。 |
| RW-03 | P0 / 源码与真实 React 通过，官方待验 | 前端默认适配版本选择 | 50 项隔离 Edge：默认最高 selectable 的适配升级、有效手选、自动有界只读分页、不自动降级；未知/冲突/缺制品/历史不全分别解释，核心过旧附当前版本/最新包/范围；新版预检绑定与降级二次确认，旧 Host fallback；未知提交只读原身份恢复。 |
| RW-04 | P0 / 源码与真实 React 通过，官方待验 | TaskCard 在途锁与重新核对 | 35 项隔离 Edge：updatedAt 不解锁；原 Promise 未结束仍锁定，迟到回包丢弃；核对只读；MarketPage 目录核对只读 catalog，不重发指定来源refresh；原方案sourceId保留。 |
| RW-05 | P1 / 已修复，独立 tsc 通过 | 修复额外 Client 测试 tsconfig 的五类既有错误 | completed→applied 领域回执、三个 type imports 改走本仓 Client-safe 表面、policy fixture 明确 UpdatePolicySnapshot；不改变产品协议、不降低断言。 |
| RW-06 | P0 / 本批源码与隔离浏览器完成 | 本批最终源码/浏览器/包验证 | 最终 build、额外 Client tsc、lint、包检查、diff通过；全量1598 passed / 0 failed / 2 skipped，通用browser49/49；失败保留，官方本批新制品仍待验。 |
| RW-07 | 发布阻断 / 待授权与环境 | 正式双包渠道及整包升级/回退 | 核实公网 Core 真正可得与 Adapter 匹配；新版本新字节，不能覆盖既有版本；实际全新安装、mvp.9→双包升级、失败回退；任何发布/共享环境动作先请求授权。 |
| RW-08 | 历史失败未归因 / 本批一次正常退出通过 | 原指定官方 rc.1 与 rc.2 关闭竞态 | 媒体批次四进程残留与受控退出证据保留；管理批次Browser.close后code0/精确进程清零及冷启动通过，无受控终止。不以一次通过证明历史竞态已修复；原指定rc.1仍待可信载体。 |
| RW-09 | P1 / 待验 | 剩余产品功能矩阵 | 依 [矩阵](DESKTOP-FUNCTION-MATRIX-2026-10-03.md) 补真实升级/降级、多依赖/套餐、皮肤切换、错误/取消/重启恢复、AI 正向；AI 需明确模型/费用权限与无密钥日志，未授权先保留待验。 |
| RW-10 | P1 / 待验 | 无障碍与宿主视觉矩阵 | 真正读屏、forced-colors、键盘焦点、120%–200% 缩放/DPI、明暗主题、真实网络图片与长链路；截图/DOM/交互联合证据，合成不替代宿主。 |
| RW-11 | P1 / 已定位上游数据阻断 | 目录历史与来源完整性 | 公开索引18,375,959字节，原8MiB reader实际拒绝；已审计样本缺DSH范围/版本/制品/历史映射，两个公开ZIP未取得实际摘要。保留unknown，不擅自扩大门禁、造子集源或修改外部仓；详见本批source-audit。 |
| RW-12 | 收尾 / 本批交接完成，正式交付待授权 | 最终交接及交付整理 | 已更新入口、升级指南与协作者说明；失败保留。本批未打新官方制品、未commit/push/发布；后续真实制品摘要与实机证据另补，不提交 .pnpm-store、Profile、token 日志。 |
| RW-13 | 本批源码与rc.2管理范围完成 | 管理页的原操作恢复闭环 | 既有记录新增完整result/维护凭证并纳入execution锁；Client保留原身份/key且unknown只读核对。官方API4组、冷启动原结果3组及实际UI3组最终核实通过，真实卸载超时经只读恢复零重放。seeded跨重开指针不算自然断线cold-start；旧记录缺证据仍unknown。 |
| RW-14 | 部分恢复 / 真实制品长链路待验 | 公网主路径逐域复验 | VPN首轮仍保留地址拒绝；媒体候选初装/重开目录refresh和README均实际通过，Gitee已公网解析。API GitHub有间歇timeout、raw GitHub仍ENOENT，不宣称所有网络稳定或一概blocked；未改VPN/DNS/SSRF。继续真实版本选择、预检绑定、公开制品安装和原task恢复。 |
| RW-15 | media源码/API与隔离浏览器完成 / 官方图片正向待验 | Agent Forge完整媒体交付前端 | 公共可选media保留icon/previews/alt/theme，完整package为权威，后端只提供API，Client负责中间态；完整1796/0/2 skipped、专项198/0、browser49/49，新官方安装186文件一致。默认61插件/21listing没有media；取得真实已发布媒体源后在隔离Profile验证加载/失败/重试/放大，不用合成结果冒充。 |

## 本轮第一批

先执行 RW-01～RW-05，再 RW-06。依赖顺序为公共合同冻结 → Core 与两条 Client 独占文件并行 → 主控接线与集成 → 串行验证。RW-07～RW-11 仍按可获得载体、外部授权和真实环境推进，不能为了清空清单而标完成。

### 公共合同

- `PlanSelection.releaseContext?` / `InstallPlanItem.releaseContext?`：`ReleaseSelectionContext` 包含列表 context、所选 `identity` 与 `sources`；后端校验输入并冻结重算结果，不让 checkedAt 替代 revision。
- 可选能力 `host-release-context` 与 `operation-recovery`；Client 基础最低协议要求不提高，旧 Host 缺能力走显式 fallback。
- `taskStartRecover(request, callerId)`：请求携带原 `planId/planDigest/idempotencyKey`；结果为原 task 或 not-found，缺失不能证明未写入。
- `pluginActionRecover(request)`：请求携带原 `packageName/expectedVersion/action/idempotencyKey`；结果为原管理 stage 与回执或 not-found，不能拿当前库存猜原操作成功。
- 管理恢复的 `receipt` 是原官方回执，`result` 是整个业务结果；旧管理记录没有维护保存回执时，业务结果保留 unknown，不把官方 applied 误报成市场维护已完成。
- 恢复结果无默认选择、UI 阶段、轮询频率；可信 caller 由 Adapter 连接读取，不接受客户端自报。

## 本批验证与结果

### 实现与合同事实

- Core 服务新增 `taskStartRecover` / `pluginActionRecover`，Backend 40 方法、Remote 41 descriptor；Client 最低 Core API1.0/Remote2.0 不提高，Provider 仍为当前未发布候选1.1/2.1。
- 计划摘要覆盖 public releaseContext，私有 bundleDigest 覆盖 host/catalog binding；时间戳 checkedAt 不作为授权或 revision。服务器重新计算来源与身份，客户端不能伪造。
- 库存 revision 原先仅按数量拼接，会漏掉同项数的版本/启停变化；本批改为完整库存内容摘要。首次 dispatch 前库存 revision 变化会要求重新预检（包括无关包真实变动），不是无关 unknown 的全局阻断；后续步骤的本任务真实库存变化不按旧 revision 误挡。应继续观察实际宿主是否过度失效，不提前放宽安全判断。
- 原计划已产生任务后，同 key 查询/开始返回原 task，不再用当前目录/库存变化否定历史事实。原调用归属缺失、摘要损坏或 key 内容冲突明确报错，不写成 not-found。
- 管理恢复只读取原记录。`receipt` 保留原官方 changed/error/permissionChanges，`result` 因没有耐久维护保存证明保持 unknown；不会用当前库存猜原请求成功。启停/卸载完整交互恢复仍是 RW-13。
- 版本选择仅从后端允许集合中选，不重做范围算法。明确降级必须手选及二次确认；“最新”仅为已接受目录中当前通道最高有效版。

### 已执行与保留的失败

- `node scripts/build.mjs` 及 `node node_modules/typescript/bin/tsc -p tests/client/tsconfig.json --pretty false` 通过；原五类测试配置错误已清零。初轮 Core TS7053、edit中未使用helper失败已修，不把开发中结果写成正式通过。
- `node scripts/lint.mjs` / `git diff --check` 通过；`node scripts/verify-package.mjs` 审批后通过：88包文件、41 Remote descriptors、两包分离与浏览器安全边界。首次 npm缓存 EPERM 保留，重跑未发布。
- 集成 focused `.verify/remaining-work-integrated-focused-20261004.json`：326 passed / 0 failed；其中版本选择50项、TaskCard35项是实际 React / 隔离无头 Edge，不是官方 Desktop。
- 完整首轮 `.verify/remaining-work-full-20261004.json`：1587 passed / 6 failed / 2 skipped。五项为新请求代次/预下载校验带来的旧源码/调用次数/错误文本断言；一项是真实管理分类回归：同 key 不同意图被 recovery catch 误作 dispatched 后标 unknown。已恢复明确 failed/changed:false，腐败记录仍 unknown，不放宽原写入断言。
- 三组旧断言纠正复验 `.verify/remaining-work-regression-corrected-20261004.json`：43 passed / 0 failed。目录冲突加强为 `release-context/stale` 且零下载/零官方写。
- 通用 browser-check 首轮 `.verify/remaining-work-browser-20261004/browser-results.json`：46 passed / 3 failed。两个合成 task 缺原 planId/digest，被新版身份核对正确拒绝；一个仍匹配已脱敏前的 revision 文案。已修合成身份并保留原稿/零保存/不伪报成功断言，未修改产品门槛。纠正复验 `.verify/remaining-work-browser-corrected-20261004/browser-results.json`：**49/49 通过**。人工查看480px组合预检截图，文本换行/滚动容器无明显横向溢出；不是新版本选择或官方原生DPI的视觉验收。
- 最终完整 `.verify/remaining-work-full-final-20261004.json`：**1598 passed / 0 failed / 2 skipped**；全部 worker 冻结后串行执行。最终再次 build、Client 测试 tsc、lint、88文件/41 Remote 包边界与 `git diff --check` 均通过。既有 CJS `import.meta` 警告仍存在，未为消警告越界修改官方读取逻辑。
- 主控与三个真实子智能体独占文件开发，公共合同/Adapter/文档、构建与最终回归由主控串行处理；全部子智能体已关闭。测试浏览器按自身CDP/child结束，未终止其他用户进程。既有工作区改动、.pnpm-store 和失败材料保留；未 commit、push、发布、更新memory或改官方安装/日常Profile。

### 真实宿主边界与下一批

第一批源码完成时尚未安装新制品；随后按用户要求已执行[版本上下文候选官方安装复验](OFFICIAL-DESKTOP-RELEASE-CONTEXT-2026-10-04.md)。该历史批次181文件/当前lib一致，冷启动、API、过时/未知界面和原管理回执查询通过；UI8/0/1 blocked、两阶段只读API各11/0/9 unknown、focused144/0，当时DNS保留地址使公网blocked。以上结果只属于该批制品；当前网络与媒体结果见下方，RW-03/04的完整官方验收不能因此关闭。

## 媒体与VPN重试执行批次

见[实施实录](AGENT-FORGE-MEDIA-IMPLEMENTATION-2026-10-04.md)：完整1796/0/2 skipped、媒体专项198/0、通用browser49/49；新隔离官方rc.2的186安装文件与制品/当前lib一致。完整Agent Forge媒体已经经过API提供给前端，后端没有新增中间态系统。初装/受控终止后重开目录refresh和README各两次真实通过，raw GitHub仍ENOENT，未改VPN或削弱安全。

正常退出首次失败，保留官方关闭等待与精确PID证据；强制清理本轮隔离进程后的重开恢复、库存/草稿/CSS、UI8/0/1 blocked和API11/0/9 unknown另记，不冒充正常退出通过。默认61插件/21listing无media，官方图片正向待验；仍无实际安装task或管理写回执。下一批按RW-15取得真实已发布媒体源、RW-14取得真实范围/历史/可安装制品补公网长链路、RW-08调查宿主关闭、RW-13补完整耐久管理恢复执行。发布、新发行号、日常Profile、网络配置与模型费用仍需相应授权。
